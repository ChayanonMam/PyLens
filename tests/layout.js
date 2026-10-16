// Layout checks: load the real app in iframes of several sizes and assert on the DOM.

const SIZES = [
  {name: 'phone 375x812',   w: 375,  h: 812},
  {name: 'tablet 768x1024', w: 768,  h: 1024},
  {name: 'laptop 1366x768', w: 1366, h: 768},
  {name: 'desktop 1920x1080', w: 1920, h: 1080}
];

const wait = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, timeout = 90000, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (fn()) return true; } catch (e) {}
    await wait(step);
  }
  return false;
}

async function checkSize(size, host) {
  const out = [];
  const add = (ok, msg) => out.push([ok, msg]);

  const frame = document.createElement('iframe');
  frame.width = size.w; frame.height = size.h;
  frame.style.cssText = 'border:1px solid #888;background:#fff';
  frame.src = '../index.html?layout-test';
  host.appendChild(frame);
  await new Promise(r => frame.addEventListener('load', r, {once: true}));
  const win = frame.contentWindow, doc = frame.contentDocument;

  const ready = await waitFor(() => win.eval('workerReady'));
  add(ready, 'Python runtime becomes ready');
  if (!ready) { frame.remove(); return out; }

  // Run a program with objects, then show a middle step in full (non-simple) mode.
  win.eval("document.getElementById('examples').value='Class & linked list'; document.getElementById('examples').onchange();");
  win.eval("document.getElementById('simple').checked=false; document.getElementById('simple').onchange();");
  win.eval("document.getElementById('run').click();");
  const traced = await waitFor(() => win.eval('trace && trace.steps.length > 0 && !running'), 60000);
  add(traced, 'example runs and produces a trace');
  if (!traced) { frame.remove(); return out; }
  win.eval('render(25)');
  const mobile = size.w <= 900;
  if (mobile) win.eval("document.querySelector('#tabbar button[data-t=viz]').click()");
  await wait(500);

  const root = doc.documentElement;
  add(root.scrollWidth <= size.w + 1, `no horizontal page scroll (scrollWidth ${root.scrollWidth} <= ${size.w})`);

  const header = doc.querySelector('header');
  const maxHeader = mobile ? 135 : 80;
  add(header.offsetHeight <= maxHeader, `header height ${header.offsetHeight}px <= ${maxHeader}px`);

  // Nothing (outside scroll containers) should stick out of the viewport on the right.
  const offenders = [];
  doc.querySelectorAll('body *').forEach(el => {
    if (el.closest('svg') && el.tagName !== 'svg') return;
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') return;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) return;
    if (b.right <= size.w + 1) return;
    // inside a horizontally scrollable ancestor -> allowed
    let p = el.parentElement, scrolls = false;
    while (p && p !== doc.body) {
      const o = win.getComputedStyle(p).overflowX;
      if (/(auto|scroll|hidden)/.test(o)) { scrolls = true; break; }
      p = p.parentElement;
    }
    if (!scrolls) offenders.push((el.id || el.className || el.tagName).toString().slice(0, 40));
  });
  add(offenders.length === 0, 'no element overflows the viewport' + (offenders.length ? ': ' + offenders.slice(0, 4).join(', ') : ''));

  // Memory view shows frames and the objects column without needless horizontal scroll.
  const viz = doc.getElementById('viz');
  if (!mobile) {
    add(viz.scrollWidth <= viz.clientWidth + 1, `memory view has no needless horizontal scroll (${viz.scrollWidth} <= ${viz.clientWidth})`);
  }
  add(doc.querySelectorAll('#viz .frame').length >= 1, 'frames are rendered');
  add(doc.querySelectorAll('#viz .obj').length >= 1, 'objects are rendered');
  add(doc.querySelectorAll('#arrows path').length >= 1, 'reference arrows are drawn');

  // Code tab (mobile) / left column (desktop): editor must stay usable.
  if (mobile) win.eval("document.querySelector('#tabbar button[data-t=code]').click()");
  await wait(300);
  const ed = doc.getElementById('editorCard').getBoundingClientRect();
  add(ed.height >= 200, `editor height ${Math.round(ed.height)}px >= 200px`);

  // Controls and scrubber visible and not overlapped.
  const nxt = doc.getElementById('next').getBoundingClientRect();
  add(nxt.width > 20 && nxt.height > 20, 'Next button has a usable size');

  // Where-am-I helpers: breadcrumb, loop counters (nested loops with their own totals)
  win.eval("document.getElementById('examples').value='Bubble sort'; document.getElementById('examples').onchange(); document.getElementById('run').click();");
  const traced2 = await waitFor(() => win.eval("trace && trace.blocks && trace.steps.length > 0 && !running && trace.out.indexOf('[1, 2, 5, 7, 9]') >= 0"), 60000);
  add(traced2, 'bubble sort example runs');
  if(traced2){
    const labels = win.eval("(()=>{ const S=trace.steps; const k=S.findIndex(s=>s.line===5&&s.ev==='line'); render(k); return contextAt(k).filter(c=>c.t==='l').map(c=>c.text+' | '+loopLabel(c).text); })()");
    add(labels.length === 2 && labels[0].indexOf('1/5') > 0 && labels[1].indexOf('1/4') > 0, 'nested loop counters 1/5 and 1/4 (' + labels.join(' ; ') + ')');
    await wait(300);
    add(doc.querySelectorAll('#crumbs .cr').length >= 3, 'breadcrumb shows program > loops');
    add(win.eval('loopMarks.length') === 2, 'loop counters are placed on the header lines');
    const skipped = win.eval("(()=>{ document.getElementById('bLoop').click(); return trace.steps[cur].line; })()");
    add(skipped === 3, 'skip-loop jumps to the next iteration of the outer loop (line 3)');
  }

  // 2D list as a table, active cells, access path on hover, folding
  win.eval("document.getElementById('examples').value='2D list (grid)'; document.getElementById('examples').onchange(); document.getElementById('run').click();");
  const traced3 = await waitFor(() => win.eval("trace && trace.steps.length > 0 && !running && trace.out.indexOf('36') >= 0"), 60000);
  add(traced3, '2D list example runs');
  if(traced3){
    win.eval("(()=>{ const S=trace.steps; const iv=(s,n)=>{ const f=s.stack[0].vars.find(v=>v[0]===n); return f?f[1].v:null; }; render(S.findIndex(s=>s.line===4&&s.ev==='line'&&iv(s,'r')==='1'&&iv(s,'c')==='2')); })()");
    await wait(300);
    add(doc.querySelectorAll('#viz table.grid').length === 1, '2D list is drawn as a table');
    add(doc.querySelectorAll('#viz table.grid .cur').length >= 2, 'the cell grid[r][c] about to change is highlighted');
    const tip = win.eval("(()=>{ const td=document.querySelector('#viz table.grid td[data-k=\"2\"]'); td.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:100,clientY:100})); const t=document.getElementById('pathtip').textContent; td.dispatchEvent(new MouseEvent('mouseout',{bubbles:true})); return t; })()");
    add(/^grid\[\d\]\[2\]/.test(tip), 'hovering a cell shows its access path (' + tip + ')');
    win.eval("document.getElementById('examples').value='Nested loops: multiplication table'; document.getElementById('examples').onchange(); foldInnerLoops();");
    await wait(200);
    add(win.eval("cm.getAllMarks().filter(m=>m.__isFold).length") === 1, 'inner loop can be folded');
    win.eval("unfoldAllCode()");
  }

  // DP example: read / write cells, substituted line, call log, import fix
  const dpCode = ['def f(grid):','    n = len(grid)','    dp = [[0] * n for _ in range(n)]','    dp[0][0] = grid[0][0]','    for i in range(1, n):','        for j in range(1, n):','            dp[i][j] = grid[i][j] + min(dp[i-1][j], dp[i][j-1])','    return dp[n-1][n-1]','print(f([[1, 3, 1], [1, 5, 1], [4, 2, 1]]))', 'print(f([[5, 5], [5, 5]]))'].join(String.fromCharCode(10));
  win.eval('cm.setValue(' + JSON.stringify(dpCode) + '); document.getElementById("run").click();');
  const tracedDp = await waitFor(() => win.eval("trace && trace.steps.length > 0 && !running && !trace.error && trace.out.length > 0"), 60000);
  add(tracedDp, 'DP-style program runs');
  if(tracedDp){
    win.eval("(()=>{ const S=trace.steps; const gv=(s,n)=>{ const f=s.stack[s.stack.length-1].vars.find(v=>v[0]==='n'?false:v[0]===n); return f?f[1].v:null; }; render(S.findIndex(s=>s.line===7&&s.ev==='line'&&gv(s,'i')==='2'&&gv(s,'j')==='2')); })()");
    await wait(400);
    add(doc.querySelectorAll('#viz .cur-w').length === 1, 'exactly one cell is marked as written (orange)');
    add(doc.querySelectorAll('#viz .cur-r').length >= 3, 'cells that are read are marked (blue)');
    add(doc.querySelectorAll('#arrows path[stroke-dasharray]').length >= 3, 'dashed arrows go from the read cells to the written cell');
    const sub = (doc.querySelector('#explain .subst') || {}).textContent || '';
    add(/dp\[2\]\[2\] = 1 \+ min\(\d+, \d+\)/.test(sub), 'the line is shown with its values put in (' + sub.replace('แทนค่า', '').trim() + ')');
    win.eval("setVizTab('calls')");
    await wait(300);
    add(doc.querySelectorAll('#callsView tr[data-s]').length === 2, 'call log lists both calls of f');
    win.eval("setVizTab('mem')");
    win.eval('cm.setValue("def g(x: Dict[str, int]):" + String.fromCharCode(10) + "    return x" + String.fromCharCode(10) + "print(g({}))"); document.getElementById("run").click();');
    const gotErr = await waitFor(() => win.eval("trace && trace.error && !running && !!document.querySelector('#errBox .fixbtn')"), 30000);
    add(gotErr, 'NameError for a typing name offers a one-click import fix');
    if(gotErr){
      win.eval("document.querySelector('#errBox .fixbtn').click()");
      const fixed = await waitFor(() => win.eval("cm.getValue().indexOf('from typing import Dict') === 0 && trace && !trace.error && !running && trace.out.indexOf('{}') >= 0"), 30000);
      add(fixed, 'the fix adds the import and the program runs');
    }
  }

  // Export: the picture covers the whole layout and the page is left as it was
  const shot = await Promise.race([new Promise(r => setTimeout(() => r(null), 25000)), win.eval("(async()=>{ const cls0 = document.body.className; const mh = document.querySelector('main').scrollHeight; exportBegin(); const c = await snap(1); exportEnd(); return {w:c.width, h:c.height, mh:mh, same: document.body.className === cls0}; })()")]);
  if(!shot){ add(false, 'PNG export did not finish within 25 s'); win.eval('exportEnd()'); }
  else {
    add(shot.w >= size.w - 40 && shot.h >= shot.mh - 2, 'PNG export covers the full layout (' + shot.w + 'x' + shot.h + ')');
    add(shot.same, 'export leaves the page layout unchanged');
  }
  const pdfOk = win.eval("(()=>{ window.print = ()=>{}; exportPDF(); const t = document.getElementById('report').innerText; return t.length > 200 && !/undefined|\\[object/.test(t) && document.querySelectorAll('#report section').length > 3; })()");
  add(pdfOk, 'PDF report is built from the steps (no undefined / [object])');

  // Security: text from the program (or a shared link) must never break out of an HTML attribute
  const evil = 'for c in ' + String.fromCharCode(39) + 'a' + String.fromCharCode(34) + ' onmouseover=' + String.fromCharCode(34) + 'window.__pwn=1' + String.fromCharCode(34) + ' x=' + String.fromCharCode(34) + String.fromCharCode(39) + ':' + String.fromCharCode(10) + '    pass';
  win.eval('cm.setValue(' + JSON.stringify(evil) + '); document.getElementById("run").click();');
  const tracedEvil = await waitFor(() => win.eval("trace && trace.steps.length > 0 && !running && trace.steps.length > 3"), 40000);
  if(tracedEvil){
    win.eval('render(2)');
    await wait(200);
    add(doc.querySelectorAll('#crumbs [onmouseover], #viz [onmouseover], #explain [onmouseover]').length === 0, 'quotes in program text cannot inject HTML attributes');
  } else add(false, 'security check program did not run');

  // Touch-friendly layout: on narrow screens the controls are a dock fixed to the bottom edge
  const dock = doc.getElementById('ctrlCard');
  if(mobile){
    const dr = dock.getBoundingClientRect();
    add(win.getComputedStyle(dock).position === 'fixed' && Math.round(dr.bottom) === size.h, 'controls dock is fixed to the bottom edge');
    const btnH = doc.getElementById('next').getBoundingClientRect().height;
    add(btnH >= 44, 'main buttons are tall enough to tap (' + Math.round(btnH) + 'px >= 44px)');
    add(doc.querySelectorAll('#tabbar button').length === 3, 'three tabs: code / memory / output');
    const more = doc.querySelector('.dockmore');
    const hidden0 = win.getComputedStyle(more).display === 'none';
    win.eval("document.getElementById('dockHandle').click()");
    await wait(150);
    add(hidden0 && win.getComputedStyle(more).display !== 'none', 'tap the handle to open the details sheet');
    win.eval("document.getElementById('dockHandle').click()");
    const main = doc.querySelector('main');
    add(parseFloat(win.getComputedStyle(main).paddingBottom) >= dr.height, 'content leaves room for the dock');
  } else {
    add(win.getComputedStyle(doc.getElementById('dockHandle')).display === 'none', 'desktop has no dock handle');
  }

  // Tools menu: opens above the content and every entry is clickable (not covered).
  win.eval("document.getElementById('tools').open = true");
  await wait(200);
  const panel = doc.querySelector('.menupanel');
  const covered = [];
  panel.querySelectorAll('button, select, label').forEach(el => {
    const b = el.getBoundingClientRect();
    if (b.width === 0) return;
    const hit = doc.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    if (!hit || !panel.contains(hit)) covered.push((el.id || el.textContent.trim()).slice(0, 20));
  });
  add(covered.length === 0, 'tools menu entries are not covered' + (covered.length ? ': ' + covered.join(', ') : ''));
  const pr = panel.getBoundingClientRect();
  add(pr.right <= size.w + 1 && pr.left >= -1, `tools menu fits the viewport (${Math.round(pr.left)}..${Math.round(pr.right)})`);
  win.eval("document.getElementById('tools').open = false");

  frame.remove();
  return out;
}

async function runLayoutTests(host, onResult) {
  const results = [];
  for (const size of SIZES) {
    const checks = await checkSize(size, host);
    results.push({name: size.name, checks});
    onResult(size.name, checks);
  }
  return results;
}
