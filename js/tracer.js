// Python-side tracer (runs inside Pyodide in a Web Worker).
const PY = String.raw`
import sys, json, io, builtins, types, ast, dis, inspect

class _StepLimit(Exception): pass
class _NeedInput(BaseException): pass

def __viz_missing(code):
    import ast, importlib.util
    try: tree = ast.parse(code)
    except Exception: return []
    mods = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            for a in n.names: mods.add(a.name.split('.')[0])
        elif isinstance(n, ast.ImportFrom) and n.module and n.level == 0:
            mods.add(n.module.split('.')[0])
    out = []
    for m in mods:
        try:
            if importlib.util.find_spec(m) is None: out.append(m)
        except Exception: out.append(m)
    return out

def __viz_check(code):
    try:
        compile(code, '<user>', 'exec')
        return json.dumps(None)
    except SyntaxError as e:
        return json.dumps({'line': e.lineno, 'col': e.offset, 'endline': getattr(e, 'end_lineno', None),
                           'endcol': getattr(e, 'end_offset', None), 'msg': type(e).__name__ + ': ' + str(e.msg)})
    except Exception as e:
        return json.dumps(None)

def __viz_format(code, use_autopep8):
    if use_autopep8:
        try:
            import autopep8
            return autopep8.fix_code(code, options={'aggressive': 1, 'max_line_length': 100})
        except Exception:
            pass
    lines = [ln.expandtabs(4).rstrip() for ln in code.split(chr(10))]
    return chr(10).join(lines).rstrip(chr(10)) + chr(10)

def __viz_run(code, stdin_text, max_steps):
    ids = {}; keep = []
    def oid(o):
        k = id(o)
        if k not in ids:
            ids[k] = len(ids) + 1; keep.append(o)
        return ids[k]
    def short(s, n=60):
        s = str(s)
        return s if len(s) <= n else s[:n-1] + '…'
    def rep(v):
        try: return repr(v)
        except Exception: return '<unrepresentable>'
    PRIM = (type(None), bool, int, float, complex, str, bytes)
    def enc(v, heap, depth=0):
        if isinstance(v, PRIM) and type(v) in PRIM:
            return {'k': 'p', 't': type(v).__name__, 'v': short(rep(v), 80)}
        if depth > 10:
            return {'k': 'p', 't': 'other', 'v': '…'}
        i = oid(v)
        if i not in heap:
            heap[i] = None
            heap[i] = build(v, heap, depth)
        return {'k': 'r', 'id': i}
    def build(v, heap, depth):
        t = type(v).__name__
        if isinstance(v, (list, tuple, set, frozenset)):
            seq = list(v)
            return {'t': t, 'items': [enc(x, heap, depth + 1) for x in seq[:40]], 'more': max(0, len(seq) - 40)}
        if isinstance(v, dict):
            seq = list(v.items())
            return {'t': 'dict', 'pairs': [[enc(k, heap, depth + 1), enc(x, heap, depth + 1)] for k, x in seq[:40]], 'more': max(0, len(seq) - 40)}
        if isinstance(v, types.GeneratorType):
            try: stt = inspect.getgeneratorstate(v)
            except Exception: stt = ''
            return {'t': 'generator', 'name': v.__name__, 'state': stt, 'line': (v.gi_frame.f_lineno if v.gi_frame else None)}
        if isinstance(v, types.FunctionType):
            return {'t': 'function', 'name': v.__name__}
        if isinstance(v, type):
            return {'t': 'class', 'name': v.__name__}
        if isinstance(v, types.ModuleType):
            return {'t': 'module', 'name': v.__name__}
        if hasattr(v, '__dict__'):
            return {'t': 'instance', 'cls': t, 'pairs': [[{'k': 'p', 't': 'str', 'v': k}, enc(x, heap, depth + 1)] for k, x in list(vars(v).items())[:40]]}
        return {'t': 'other', 'cls': t, 'repr': short(rep(v), 100)}

    # ---- statement analysis (expression breakdown, comprehension unrolling) ----
    try: tree = ast.parse(code)
    except Exception: tree = None
    stmt_at = {}
    if tree is not None:
        for _n in ast.walk(tree):
            if isinstance(_n, ast.stmt) and _n.lineno not in stmt_at:
                stmt_at[_n.lineno] = _n
    src_lines = code.split(chr(10))
    SAFE_CALLS = {'len','abs','min','max','sum','int','float','str','bool','round','sorted','list','tuple',
                  'set','dict','range','ord','chr','type','isinstance','repr','divmod','pow','any','all',
                  'reversed','enumerate','zip'}
    BAD = (ast.Lambda, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp, ast.NamedExpr,
           ast.Await, ast.Yield, ast.YieldFrom)
    SKIP = (ast.Constant, ast.Tuple, ast.List, ast.Dict, ast.Set, ast.Slice, ast.JoinedStr,
            ast.FormattedValue, ast.Starred)
    COMPS = (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)
    seg_cache = {}
    code_cache = {}
    busy = [False]
    cids = {}
    ncall = [0]
    devnull = io.StringIO()

    def seg(n):
        k = id(n)
        r = seg_cache.get(k)
        if r is None:
            try:
                if n.lineno == n.end_lineno:
                    r = src_lines[n.lineno - 1].encode('utf-8')[n.col_offset:n.end_col_offset].decode('utf-8')
                else:
                    r = ast.unparse(n)
            except Exception:
                r = ''
            seg_cache[k] = r
        return r

    def safe(node, g, l):
        for n in ast.walk(node):
            if isinstance(n, BAD): return False
            if isinstance(n, ast.Call):
                f = n.func
                if not (isinstance(f, ast.Name) and f.id in SAFE_CALLS and f.id not in l and f.id not in g):
                    return False
        return True

    def head_exprs(n):
        if isinstance(n, (ast.Assign, ast.AugAssign)): return [n.value]
        if isinstance(n, ast.AnnAssign): return [n.value] if n.value is not None else []
        if isinstance(n, (ast.Expr, ast.Return)): return [n.value] if n.value is not None else []
        if isinstance(n, (ast.If, ast.While, ast.Assert)): return [n.test]
        if isinstance(n, ast.For): return [n.iter]
        if isinstance(n, ast.With): return [i.context_expr for i in n.items]
        if isinstance(n, ast.Raise): return [n.exc] if n.exc is not None else []
        return []

    def unroll(n):
        if isinstance(n, ast.ListComp): init, add = 'result = []', 'result.append(%s)' % ast.unparse(n.elt)
        elif isinstance(n, ast.SetComp): init, add = 'result = set()', 'result.add(%s)' % ast.unparse(n.elt)
        elif isinstance(n, ast.DictComp): init, add = 'result = {}', 'result[%s] = %s' % (ast.unparse(n.key), ast.unparse(n.value))
        else: init, add = None, 'yield %s' % ast.unparse(n.elt)
        out = [init] if init else []
        ind = 0
        for g in n.generators:
            out.append('    ' * ind + 'for %s in %s:' % (ast.unparse(g.target), ast.unparse(g.iter)))
            ind += 1
            for c in g.ifs:
                out.append('    ' * ind + 'if %s:' % ast.unparse(c))
                ind += 1
        out.append('    ' * ind + add)
        return chr(10).join(out)

    def compiled(n, key):
        c = code_cache.get(key)
        if c is None:
            c = compile(ast.Expression(body=n), '<expr>', 'eval')
            code_cache[key] = c
        return c

    def breakdown(stmt, frame):
        g = frame.f_globals
        l = dict(frame.f_locals)
        rows = []; seen = set(); un = [None]
        roots = [e for e in head_exprs(stmt) if e is not None]
        root_ids = set(id(e) for e in roots)
        def walk(n, parent=None, in_idx=False):
            for c in ast.iter_child_nodes(n):
                walk(c, n, in_idx or (isinstance(n, ast.Subscript) and c is n.slice))
            if isinstance(n, COMPS) and un[0] is None: un[0] = unroll(n)
            # keep the rows short: skip the container in grid[i][j] (grid, grid[i]) and index arithmetic like i-1
            if isinstance(parent, (ast.Subscript, ast.Attribute)) and getattr(parent, 'value', None) is n: return
            if in_idx and not isinstance(n, ast.Name): return
            if not isinstance(n, ast.expr) or isinstance(n, SKIP) or (len(rows) >= 8 and id(n) not in root_ids): return
            if isinstance(n, ast.Name) and not isinstance(n.ctx, ast.Load): return
            if not safe(n, g, l): return
            src = seg(n)
            if not src or src in seen: return
            seen.add(src)
            try:
                val = eval(compiled(n, id(n)), g, l)
            except Exception:
                return
            if isinstance(n, ast.Name) and (callable(val) or isinstance(val, types.ModuleType)): return
            vs = short(rep(val), 48)
            if vs == src: return
            rows.append([src, vs])
        for e in head_exprs(stmt):
            if e is not None: walk(e)
        if isinstance(stmt, ast.AugAssign) and isinstance(stmt.target, ast.Name) and safe(stmt.value, g, l):
            try:
                key = ('aug', id(stmt))
                c = code_cache.get(key)
                if c is None:
                    be = ast.BinOp(left=ast.Name(id=stmt.target.id, ctx=ast.Load()), op=stmt.op, right=stmt.value)
                    ast.fix_missing_locations(be)
                    c = (compile(ast.Expression(body=be), '<expr>', 'eval'), ast.unparse(be))
                    code_cache[key] = c
                val = eval(c[0], g, l)
                rows.append([c[1], short(rep(val), 48)])
            except Exception:
                pass
        rt = None
        if roots:
            rs = seg(roots[0])
            for r in rows:
                if r[0] == rs: rt = r; break
        return rows, un[0], rt

    def _evname(frame, event):
        if event == 'return' and frame.f_code.co_flags & 0x20:
            try:
                if dis.opname[frame.f_code.co_code[frame.f_lasti]] == 'YIELD_VALUE': return 'yield'
            except Exception:
                pass
        return event

    glob_cache = {}
    def _globnames(co):
        r = glob_cache.get(co)
        if r is None:
            r = []
            try:
                for ins in dis.get_instructions(co):
                    if ins.opname == 'LOAD_GLOBAL' and ins.argval not in r: r.append(ins.argval)
            except Exception:
                pass
            glob_cache[co] = r
        return r

    def _fmeta(fr, is_mod):
        if is_mod: return {}
        co = fr.f_code
        npar = co.co_argcount + co.co_kwonlyargcount + (1 if co.co_flags & 4 else 0) + (1 if co.co_flags & 8 else 0)
        gl = []
        try:
            loc = fr.f_locals
            for nm in _globnames(co):
                if nm in fr.f_globals and nm not in loc:
                    v = fr.f_globals[nm]
                    if callable(v) or isinstance(v, types.ModuleType): continue
                    gl.append([nm, short(rep(v), 30)])
                    if len(gl) >= 6: break
        except Exception:
            pass
        return {'params': list(co.co_varnames[:npar]), 'free': list(co.co_freevars), 'glob': gl}

    # ---- block structure (loops / if) for the breadcrumb and loop counters ----
    blocks = []
    def collect(node, parent):
        for ch in ast.iter_child_nodes(node):
            idx = parent
            if isinstance(ch, (ast.For, ast.AsyncFor, ast.While, ast.If)):
                hdr = src_lines[ch.lineno - 1].strip()
                if hdr.endswith(':'): hdr = hdr[:-1]
                if len(hdr) > 42: hdr = hdr[:40] + '…'
                kind = 'while' if isinstance(ch, ast.While) else ('if' if isinstance(ch, ast.If) else 'for')
                d = {'k': kind, 'l': ch.lineno, 'e': ch.end_lineno, 'p': parent, 't': hdr}
                if isinstance(ch, ast.If):
                    d['bs'] = ch.body[0].lineno
                    d['be'] = ch.body[-1].end_lineno
                    if ch.orelse:
                        d['os'] = ch.orelse[0].lineno
                        d['oe'] = ch.orelse[-1].end_lineno
                        d['elif'] = src_lines[ch.orelse[0].lineno - 1].lstrip().startswith('elif')
                blocks.append(d)
                idx = len(blocks) - 1
            elif isinstance(ch, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
                idx = -1
            collect(ch, idx)
    if tree is not None:
        try: collect(tree, -1)
        except Exception: blocks = []

    buf = io.StringIO()
    lines = stdin_text.split('\n') if stdin_text else []
    used = []
    need = {}
    def fake_input(prompt=''):
        buf.write(str(prompt))
        if not lines:
            need['prompt'] = str(prompt)
            raise _NeedInput()
        s = lines.pop(0)
        used.append(s)
        buf.write(s + '\n'); return s

    try:
        import js as _js
        _post = _js.postMessage
    except Exception:
        _post = None
    steps = []
    def snapshot(frame, event, arg):
        heap = {}
        frames = []
        f = frame
        while f is not None:
            if f.f_code.co_filename == '<user>': frames.append(f)
            f = f.f_back
        frames.reverse()
        stack = []
        for fr in frames:
            is_mod = fr.f_code.co_name == '<module>'
            vs = []
            for k, v in list(fr.f_locals.items()):
                if k.startswith('__'): continue
                vs.append([k, enc(v, heap)])
            fd = {'name': 'Global frame' if is_mod else fr.f_code.co_name, 'mod': is_mod, 'vars': vs}
            fd.update(_fmeta(fr, is_mod))
            fd['cid'] = cids.get(id(fr))
            fd['ln'] = fr.f_lineno
            stack.append(fd)
        s = {'line': frame.f_lineno, 'ev': _evname(frame, event), 'fn': frame.f_code.co_name, 'stack': stack, 'heap': heap, 'out': len(buf.getvalue())}
        if event == 'return' and frame.f_code.co_name != '<module>':
            s['ret'] = enc(arg, heap)
        return s

    def tracer(frame, event, arg):
        if busy[0] or frame.f_code.co_filename != '<user>': return None
        if event == 'call':
            ncall[0] += 1
            cids[id(frame)] = ncall[0]
            return tracer
        if event in ('line', 'return'):
            if len(steps) >= max_steps: raise _StepLimit()
            if _post is not None and len(steps) % 500 == 0:
                try: _post('p:' + str(len(steps)))
                except Exception: pass
            s = snapshot(frame, event, arg)
            if event == 'line' and len(steps) < 6000 and tree is not None:
                busy[0] = True
                so = sys.stdout; sys.stdout = devnull
                try:
                    st0 = stmt_at.get(frame.f_lineno)
                    if st0 is not None:
                        rows, un, rt = breakdown(st0, frame)
                        if rows: s['ex'] = rows
                        if un: s['un'] = un
                        if rt: s['rt'] = rt
                except Exception:
                    pass
                finally:
                    sys.stdout = so; busy[0] = False
                    if devnull.tell() > 100000: devnull.seek(0); devnull.truncate()
            steps.append(s)
        return tracer

    images = []
    plt = None
    if 'matplotlib' in code:
        try:
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt
            import base64
            def _flush():
                for n in plt.get_fignums():
                    fig = plt.figure(n)
                    b = io.BytesIO()
                    fig.savefig(b, format='png', dpi=110, bbox_inches='tight')
                    images.append({'step': len(steps), 'img': base64.b64encode(b.getvalue()).decode()})
                    plt.close(n)
            plt.show = lambda *a, **k: _flush()
        except Exception:
            plt = None

    err = None; truncated = False
    import time as _t
    old_sleep = _t.sleep; _t.sleep = lambda s=0: None
    old_out, old_in = sys.stdout, builtins.input
    sys.stdout = buf; builtins.input = fake_input
    g = {'__name__': '__main__', '__builtins__': builtins}
    try:
        co = compile(code, '<user>', 'exec')
        sys.settrace(tracer)
        exec(co, g)
    except _StepLimit:
        truncated = True
    except _NeedInput:
        pass
    except BaseException as e:
        ln = getattr(e, 'lineno', None) if isinstance(e, SyntaxError) else None
        tb = e.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == '<user>': ln = tb.tb_lineno
            tb = tb.tb_next
        err = {'msg': type(e).__name__ + ': ' + str(e), 'line': ln}
    finally:
        sys.settrace(None)
        if plt is not None:
            try: _flush()
            except Exception: pass
        sys.stdout = old_out; builtins.input = old_in; _t.sleep = old_sleep
    return json.dumps({'steps': steps, 'out': buf.getvalue(), 'error': err, 'truncated': truncated, 'inputs': used, 'images': images, 'needs_input': need.get('prompt'), 'blocks': blocks})
`;
