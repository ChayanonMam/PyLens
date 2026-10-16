// PyLens UI: editor, playback, memory view, call tree, stats, export.
const $ = id => document.getElementById(id);
let pyodide = null, trace = null, cur = 0, timer = null, editorMarks = {line:null};
let MAX_STEPS = 2000;
const notes = {};
let pendingStep = null, lastRunCode = null;

const cm = CodeMirror.fromTextArea($('code'), {
  mode:'python', theme:'material-darker', lineNumbers:true, indentUnit:4, tabSize:4,
  indentWithTabs:false, gutters:['CodeMirror-linenumbers','arrow-gutter','CodeMirror-foldgutter'],
  foldGutter:{rangeFinder: CodeMirror.fold.indent},
  foldOptions:{widget:(from, to)=>{ const s = document.createElement('span'); s.className = 'foldmark'; s.textContent = '… ซ่อน ' + (to.line - from.line) + ' บรรทัด'; return s; }},
  autoCloseBrackets:true, matchBrackets:true,
  extraKeys:{Tab:c=>c.somethingSelected()?c.indentSelection('add'):c.replaceSelection('    ')}
});
cm.setSize('100%','100%');
if(window.setupCompletion) setupCompletion(cm);

// examples
const sel = $('examples');
Object.keys(EXAMPLES).forEach(k=>{const o=document.createElement('option');o.textContent=k;sel.appendChild(o)});
sel.onchange = ()=>{cm.setValue(EXAMPLES[sel.value]); reset();};

// load code from share link
(function(){
  try{
    const md = location.hash.match(/d=([^&]+)/);
    if(md){
      const o = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(md[1])))));
      cm.setValue(o.c || '');
      lastRunCode = o.c || '';
      if(o.n) Object.keys(o.n).forEach(k=>{ notes[k] = o.n[k]; });
      if(o.s != null) pendingStep = o.s; else if(o.n) pendingStep = 0;
      return;
    }
    const m = location.hash.match(/code=([^&]+)/);
    if(m){ cm.setValue(decodeURIComponent(escape(atob(decodeURIComponent(m[1]))))); return; }
    const sv = localStorage.getItem('pl-code');
    if(sv){ cm.setValue(sv); return; }
  }catch(e){}
  cm.setValue(EXAMPLES["Loop & list"]);
})();

$('share').onclick = async ()=>{
  const o = {c: cm.getValue()};
  if(trace && cur > 0) o.s = cur;
  if(Object.keys(notes).length) o.n = notes;
  const enc = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(o)))));
  const url = location.href.split('#')[0] + '#d=' + enc;
  history.replaceState(null,'',url);
  try{ await navigator.clipboard.writeText(url); $('status').textContent = (o.s != null ? 'คัดลอกลิงก์แล้ว (ติดขั้นที่ '+(o.s+1)+')' : 'คัดลอกลิงก์แล้ว'); }catch(e){ $('status').textContent='link is in the address bar'; }
};

function setStatus(t){ $('status').textContent = t; }
function enableNav(on){
  ['first','prev','play','next','last','scrub','note'].forEach(id=>$(id).disabled=!on);
}

function reset(){
  stop(); clearHeat(); clearContext(); trace=null; cur=0; enableNav(false);
  clearMarks(); $('errBox').style.display='none';
  $('viz').innerHTML='<div class="welcome">กด <b>เริ่มวิเคราะห์</b> เพื่อดูโปรแกรมทำงานทีละบรรทัด</div>';
  $('out').textContent=''; $('plots').innerHTML=''; $('outCard').classList.remove('hasplots'); $('outCount').textContent=''; $('depthLabel').textContent=''; $('lineLabel').textContent='';
  $('stepinfo').innerHTML=''; $('dockline').textContent='กด เริ่มวิเคราะห์ เพื่อเริ่ม';$('explain').innerHTML='กด <b>เริ่มวิเคราะห์</b> เพื่อดูโปรแกรมทำงานทีละบรรทัด';
  $('scrub').max=0; $('scrub').value=0;
}
cm.on('change', ()=>{
  try{ localStorage.setItem('pl-code', cm.getValue()); }catch(e){}
  if(live) scheduleLive();
  else if(trace){ setStatus('แก้โค้ดแล้ว — กดเริ่มวิเคราะห์ใหม่'); }
});
let live = false, liveTimer = null;
function scheduleLive(){
  clearTimeout(liveTimer);
  liveTimer = setTimeout(()=>{ if(!workerReady) return; if(running) scheduleLive(); else run({live:true}); }, 700);
}
$('live').onchange = ()=>{ live = $('live').checked; if(live) scheduleLive(); };
$('limit').onchange = ()=>{ MAX_STEPS = +$('limit').value; };

const CDN_PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const VENDOR = null;   // (local library copies were removed; everything loads from the CDN)
let useCdn = true;
function pyodideBase(){ return (VENDOR && !useCdn) ? new URL(VENDOR.pyodide, location.href).href : CDN_PYODIDE; }
function wheelUrls(){ return (VENDOR && !useCdn) ? (VENDOR.wheels || []).map(x=>new URL(x, location.href).href) : []; }
let worker = null, workerReady = false, pending = null, runId = 0, running = false;
const seriesCache = new Map();

let initTimer = null;
let loadTarget = 0, lastProg = 0;
function paintLoad(){
  const p = Math.max(0, Math.min(100, loadTarget));
  const f = $('loadFill'), t = $('loadPct'), b = $('loadBar');
  if(f) f.style.width = p + '%';
  if(t) t.textContent = Math.round(p) + '%';
  if(b) b.setAttribute('aria-valuenow', String(Math.round(p)));
}
function setLoadProgress(pct, text){
  if(pct > loadTarget) loadTarget = pct;
  lastProg = Date.now();
  if(text) setLoadingText(text);
  paintLoad();
}
// between "Python started" and "ready" there are no byte counts: creep forward slowly so the bar never looks frozen
setInterval(()=>{
  if(workerReady || loadTarget < 76 || loadTarget >= 93 || Date.now() - lastProg < 700) return;
  loadTarget += 0.5; paintLoad();
}, 300);
function setLoadingText(t){ const el = $('loadingText'); if(el) el.textContent = t; }
function showLoadError(msg){
  clearTimeout(initTimer);
  $('loadSpin').style.display = 'none';
  $('loadingText').style.display = 'none';
  $('loadBar').style.display = 'none';
  $('loadPct').style.display = 'none';
  $('loadErr').style.display = 'flex';
  $('loadErrMsg').textContent = 'โหลดตัวรัน Python ไม่สำเร็จ' + (msg ? ' — ' + msg : '');
  const hints = [];
  if(location.protocol === 'file:') hints.push('คุณเปิดไฟล์โดยตรง (file://) ลองเปิดผ่านเซิร์ฟเวอร์: <code>python -m http.server 8765</code> แล้วเข้า <code>http://localhost:8765</code>');
  hints.push('ตรวจว่ามีอินเทอร์เน็ต เว็บนี้ต้องโหลดตัวรัน Python (~10 MB) จาก CDN ครั้งแรก');
  hints.push('ถ้ามีไฟร์วอลล์/ส่วนเสริมบล็อกสคริปต์ ลองปิดชั่วคราว แล้วกด "ลองใหม่"');
  $('loadErrHint').innerHTML = '<ul style="margin:0;padding-left:18px">' + hints.map(x=>'<li>' + x + '</li>').join('') + '</ul>';
  setStatus('โหลดตัวรัน Python ไม่สำเร็จ');
}
function initFailed(msg){
  clearTimeout(initTimer);
  try{ worker && worker.terminate(); }catch(e){}
  if(VENDOR && !useCdn){
    useCdn = true;
    setLoadingText('ไฟล์ในเครื่องโหลดไม่ได้ กำลังลองใช้ CDN แทน…');
    startWorker();
    return;
  }
  showLoadError(msg);
}
$('loadRetry').onclick = ()=>location.reload();
$('loadClose').onclick = ()=>{ $('loading').style.display = 'none'; };

function startWorker(){
  workerReady = false;
  loadTarget = 0; lastProg = Date.now(); paintLoad();
  setLoadingText(useCdn ? 'กำลังโหลดตัวรัน Python จากอินเทอร์เน็ต… ครั้งแรกประมาณ 10 MB' : 'กำลังโหลดตัวรัน Python จากไฟล์ในเครื่อง…');
  clearTimeout(initTimer);
  initTimer = setTimeout(()=>{ if(!workerReady) initFailed('ใช้เวลานานเกินไป'); }, useCdn ? 150000 : 45000);
  const src = '(' + workerMain.toString() + ')(' + JSON.stringify(PY) + ',' + JSON.stringify(pyodideBase()) + ',' + JSON.stringify(wheelUrls()) + ')';
  worker = new Worker(URL.createObjectURL(new Blob([src], {type:'text/javascript'})));
  worker.onmessage = ev=>{
    const m = ev.data;
    if(typeof m === 'string'){
      if(m.slice(0,2) === 'p:' && running) setStatus('กำลังวิเคราะห์… ' + Number(m.slice(2)).toLocaleString() + ' ขั้น');
      return;
    }
    if(m.type === 'progress'){ setLoadProgress(m.pct, m.text); return; }
    if(m.type === 'rpc'){
      const p = rpcPending.get(m.id);
      if(p){ rpcPending.delete(m.id); if(m.error) p.rej(new Error(m.error)); else p.res(m); }
      return;
    }
    if(m.type === 'ready'){
      workerReady = true; setLoadProgress(100, 'พร้อมแล้ว'); clearTimeout(initTimer); $('run').disabled = false; $('loading').style.display = 'none';
      setStatus('พร้อมใช้งาน · Ctrl+Enter');
      if(window.Mascot && !window.__greeted){ window.__greeted = true; Mascot.event('ready'); }
      if(pendingStep != null){ resumeAt = pendingStep; pendingStep = null; run(); }
    } else if(m.type === 'initfail'){
      console.error(m.error);
      initFailed(String(m.error || '').slice(0, 120));
    } else if(m.type === 'status'){
      if(running) setStatus(m.text);
    } else if(m.type === 'result'){
      if(pending && pending.id === m.id){ const pd = pending; pending = null; pd.resolve(m.data); }
    } else if(m.type === 'fail'){
      if(pending && pending.id === m.id){ const pd = pending; pending = null; pd.reject(new Error(m.error)); }
    }
  };
  worker.onerror = e=>{
    console.error(e);
    if(!workerReady) initFailed((e && e.message) || 'worker error');
    else setStatus('ตัวรันมีปัญหา');
  };
}
function callWorker(payload){
  return new Promise((resolve, reject)=>{
    const id = ++runId;
    pending = {id, resolve, reject};
    worker.postMessage(Object.assign({type:'run', id:id}, payload));
  });
}
function cancelRun(){
  if(!running) return;
  rpcPending.forEach(p=>p.rej(new Error('cancelled'))); rpcPending.clear();
  try{ worker.terminate(); }catch(e){}
  if(pending){ pending.reject(new Error('cancelled')); pending = null; }
  running = false; $('run').textContent = 'เริ่มวิเคราะห์'; $('run').disabled = true;
  setStatus('ยกเลิกแล้ว กำลังเตรียมตัวรัน Python ใหม่…');
  startWorker();
}

async function run(opts){
  opts = (opts && opts.live) ? opts : {};
  if(running){ cancelRun(); return; }
  if(!workerReady) return;
  stop();
  running = true; $('run').textContent = 'ยกเลิก'; setStatus('กำลังวิเคราะห์…');
  if(window.Mascot && !opts.live) Mascot.event('run');
  const prevTrace = trace;
  if(opts.live && prevTrace) resumeAt = cur;
  const codeNow = cm.getValue();
  if(lastRunCode !== null && codeNow !== lastRunCode){ Object.keys(notes).forEach(k=>delete notes[k]); }
  lastRunCode = codeNow;
  let res;
  try{
    res = await callWorker({code:cm.getValue(), stdin:$('stdin').value, max:MAX_STEPS, files:[...vfiles.entries()]});
  }catch(e){
    running = false; $('run').textContent = 'เริ่มวิเคราะห์';
    if(window.Mascot) Mascot.event('reset');
    if(e && e.message === 'cancelled') return;
    setStatus('เกิดข้อผิดพลาดภายใน'); console.error(e);
    $('errBox').style.display = 'block'; $('errBox').textContent = String((e && e.message) || e);
    return;
  }
  running = false; $('run').textContent = 'เริ่มวิเคราะห์';
  seriesCache.clear();
  const t = JSON.parse(res);
  trace = t;
  applyHeat();
  if(trace.error && !opts.live){
    const m = /FileNotFoundError[^']*'([^']+)'/.exec(trace.error.msg);
    if(m){ openFiles(m[1]); }
  }
  const waiting = trace.needs_input != null;
  if(!opts.live && trace.inputs && trace.inputs.length && !$('stdin').value.trim()) $('stdin').value = trace.inputs.join(String.fromCharCode(10));
  const n = trace.steps.length;
  if(!n && opts.live && prevTrace && prevTrace.steps.length){
    trace = prevTrace;
    showError(t);
    setStatus('กำลังแก้โค้ด — ' + (t.error ? t.error.msg : ''));
    return;
  }
  $('scrub').max = Math.max(0, n-1);
  cur = 0;
  $('inrow').style.display = waiting ? 'flex' : 'none';
  setStatus((waiting?'รอรับค่า input · ':'') + n.toLocaleString() + ' ขั้นตอน' + (trace.truncated ? ' (ถึงขีดจำกัด '+MAX_STEPS.toLocaleString()+' ขั้น)' : '') + (trace.error ? ' · error' : ''));
  if(window.Mascot && !opts.live){
    if(trace.error) Mascot.event('error', trace);
    else if(waiting) Mascot.event('input');
    else Mascot.event('done', trace);
  }
  if(!n){
    showError(trace);
    $('viz').innerHTML = '<div class="welcome">ไม่มีบรรทัดที่รันได้</div>';
    $('out').textContent = trace.out;
    return;
  }
  enableNav(true);
  let start = 0;
  if(resumeAt > 0) start = Math.min(resumeAt, n-1);
  else if(trace.error && !opts.live){ const e = errStepIndex(trace); if(e >= 0) start = e; }
  render(start);
  resumeAt = 0;
  if(waiting && !opts.live){
    if(window.matchMedia('(max-width: 900px)').matches) document.querySelector('#tabbar button[data-t=out]').click();   // phone: show the input box
    $('inval').value = ''; $('inval').focus();
  }
}
let resumeAt = 0;
$('inrow').onsubmit = e=>{
  e.preventDefault();
  if(!trace || trace.needs_input==null) return;
  const v=$('inval').value;
  const prev=trace.inputs||[];
  $('stdin').value = prev.concat([v]).join(String.fromCharCode(10));
  resumeAt = trace.steps.length-1;
  run();
};

const ERR_TH = [
  ['ZeroDivisionError', 'หารด้วยศูนย์ไม่ได้ — ตัวหารมีค่าเป็น 0 ลองเช็คค่าตัวหารก่อนหาร'],
  ['IndexError', 'อ้างตำแหน่ง (index) ที่ไม่มีอยู่ใน list/ข้อความ — ตำแหน่งเกินจำนวนสมาชิก จำไว้ว่า index เริ่มที่ 0 และตัวสุดท้ายคือ len(...) - 1'],
  ['KeyError', 'ไม่พบ key นี้ใน dict — ลองใช้ .get(key) หรือเช็คด้วย  key in dict  ก่อน'],
  ['NameError', 'ใช้ชื่อตัวแปรหรือฟังก์ชันที่ยังไม่ได้ประกาศ — เช็คตัวสะกด หรือประกาศ/กำหนดค่าให้ก่อนบรรทัดนี้'],
  ['UnboundLocalError', 'ใช้ตัวแปรในฟังก์ชันก่อนกำหนดค่า — หรือพยายามแก้ตัวแปรภายนอกโดยไม่ได้ประกาศ global'],
  ['TypeError', 'ชนิดข้อมูลไม่เข้ากับสิ่งที่ต้องการ เช่น เอาข้อความไปบวกกับตัวเลข หรือส่งอาร์กิวเมนต์ผิดจำนวน ลองแปลงด้วย int() / str() หรือเช็คชนิดตัวแปร'],
  ['ValueError', 'ชนิดข้อมูลถูกแต่ค่าไม่ถูก เช่น int("abc") แปลงข้อความที่ไม่ใช่ตัวเลข'],
  ['AttributeError', 'ออบเจกต์นี้ไม่มี attribute/เมธอดชื่อนั้น — เช็คตัวสะกด หรือตัวแปรอาจเป็น None / ชนิดผิด'],
  ['FileNotFoundError', 'ไม่พบไฟล์ — กดปุ่ม "ไฟล์" บนหัวเว็บ เพื่อเพิ่มไฟล์ให้โปรแกรมอ่าน'],
  ['IndentationError', 'การย่อหน้า (เว้นวรรคต้นบรรทัด) ไม่ถูกต้อง — บล็อกใน if/for/def ต้องเยื้องเท่ากัน'],
  ['SyntaxError', 'รูปแบบโค้ดผิด — เช็คเครื่องหมาย : วงเล็บ/เครื่องหมายคำพูดที่ไม่ปิด และสะกดคำสั่งให้ถูก'],
  ['RecursionError', 'ฟังก์ชันเรียกตัวเองซ้อนลึกเกินไป — น่าจะลืมเงื่อนไขหยุด (base case)'],
  ['ModuleNotFoundError', 'ไม่พบโมดูลที่ import — เช็คชื่อ หรือเป็นโมดูลที่ใช้ในเบราว์เซอร์ไม่ได้'],
  ['ImportError', 'import ไม่สำเร็จ — เช็คชื่อโมดูล/ชื่อที่ import'],
  ['StopIteration', 'ดึงค่าจาก iterator ที่หมดแล้ว'],
  ['OverflowError', 'ตัวเลขใหญ่เกินที่ชนิดข้อมูลนี้รับได้'],
  ['AssertionError', 'เงื่อนไข assert เป็นเท็จ'],
  ['EOFError', 'โปรแกรมต้องการค่า input แต่ไม่มีให้'],
  ['PermissionError', 'ไม่มีสิทธิ์ใช้ไฟล์/ทรัพยากรนี้ (ในเบราว์เซอร์จำกัดการเข้าถึงระบบ)'],
  ['OSError', 'เกิดปัญหากับระบบไฟล์/ระบบปฏิบัติการ (ในเบราว์เซอร์ใช้ได้เฉพาะไฟล์ที่เพิ่มไว้)']
];
function errInfo(msg){
  const t = (String(msg).split(':')[0] || '').trim();
  const hit = ERR_TH.find(x=>x[0] === t);
  return hit ? hit[1] : null;
}
function errStepIndex(t){
  t = t || trace;
  if(!t || !t.error || !t.error.line) return -1;
  if(t._ei !== undefined) return t._ei;
  let idx = -1;
  for(let k = t.steps.length - 1; k >= 0; k--){
    if(t.steps[k].ev === 'line' && t.steps[k].line === t.error.line){ idx = k; break; }
  }
  t._ei = idx;
  return idx;
}
function errContext(t){
  const idx = errStepIndex(t);
  if(idx < 0) return '';
  const st = t.steps[idx], f = st.stack[st.stack.length - 1];
  return f.vars.map(([n, v])=>n + ' = ' + fmt(v, st.heap)).join(',  ');
}
const AUTO_IMPORT = {};
'Dict List Tuple Set FrozenSet Optional Union Any Callable Iterable Iterator Sequence Mapping MutableMapping Deque DefaultDict Type TypeVar Generic Literal Final NamedTuple Generator'.split(' ')
  .forEach(n=>{ AUTO_IMPORT[n] = {from: 'typing'}; });
'defaultdict Counter deque OrderedDict namedtuple ChainMap'.split(' ').forEach(n=>{ AUTO_IMPORT[n] = {from: 'collections'}; });
'math random json re os sys time itertools functools heapq bisect string statistics copy datetime collections typing decimal fractions'.split(' ')
  .forEach(n=>{ AUTO_IMPORT[n] = {mod: true}; });
function missingImports(code){
  const have = new Set();
  code.split(String.fromCharCode(10)).forEach(l=>{
    let m = /^\s*from\s+[\w.]+\s+import\s+(.+)$/.exec(l);
    if(m) m[1].split(',').forEach(x=>have.add(x.trim().split(/\s+/).pop().replace(/[()]/g, '')));
    m = /^\s*import\s+(.+)$/.exec(l);
    if(m) m[1].split(',').forEach(x=>{ const p = x.trim().split(/\s+as\s+/); have.add((p[1] || p[0]).split('.')[0]); });
  });
  const groups = {}, mods = [];
  Object.keys(AUTO_IMPORT).forEach(n=>{
    if(have.has(n)) return;
    const info = AUTO_IMPORT[n];
    if(info.mod){ if(new RegExp('(^|[^\\w.])' + n + '\\.').test(code)) mods.push(n); }
    else if(new RegExp('(^|[^\\w.])' + n + '([^\\w]|$)').test(code)) (groups[info.from] = groups[info.from] || []).push(n);
  });
  const lines = [];
  Object.keys(groups).forEach(g=>lines.push('from ' + g + ' import ' + groups[g].join(', ')));
  mods.forEach(mn=>lines.push('import ' + mn));
  return lines;
}
function importFixFor(msg){
  const m = /NameError: name '(\w+)' is not defined/.exec(msg || '');
  if(!m || !AUTO_IMPORT[m[1]]) return null;
  const lines = missingImports(cm.getValue());
  if(!lines.length) return null;
  const info = AUTO_IMPORT[m[1]];
  return {name: m[1], line: info.mod ? 'import ' + m[1] : 'from ' + info.from + ' import ' + m[1], lines: lines};
}
function applyImportFix(){
  const fix = importFixFor(trace && trace.error && trace.error.msg);
  if(!fix) return;
  const ls = [];
  for(let k = 0; k < cm.lineCount(); k++){ if(/^\s*from\s+__future__\s+import/.test(cm.getLine(k))) ls.push(k); else if(ls.length || k > 0) break; }
  const at = ls.length ? ls[ls.length - 1] + 1 : 0;
  const first = cm.getLine(at) || '';
  const block = fix.lines.join(String.fromCharCode(10)) + String.fromCharCode(10) + (/^\s*(from|import)\s/.test(first) ? '' : String.fromCharCode(10));
  cm.replaceRange(block, {line: at, ch: 0});
  setStatus('เติมบรรทัด import แล้ว กำลังรันใหม่…');
  run();
}
$('errBox').addEventListener('click', e=>{ if(e.target.closest('.fixbtn')) applyImportFix(); });

function showError(t){
  t = t || trace;
  const eb = $('errBox');
  if(t && t.error){
    const e = t.error, th = errInfo(e.msg), ctx = errContext(t);
    eb.style.display = 'block';
    eb.innerHTML = '<b>' + esc(e.msg) + '</b>' + (e.line ? ' <span class="errln">(บรรทัด ' + e.line + ')</span>' : '')
      + (th ? '<div class="errth">' + esc(th) + '</div>' : '')
      + (ctx ? '<div class="errctx">ค่าตัวแปรตอนเกิดข้อผิดพลาด: ' + esc(ctx) + '</div>' : '')
      + (function(){ const fx = importFixFor(e.msg); return fx ? '<div class="errth">ชื่อ <b>' + esc(fx.name) + '</b> ต้อง import ก่อนใช้: <code>' + esc(fx.line) + '</code></div><button class="fixbtn" type="button">เติม import ให้ แล้วรันใหม่</button>' : ''; })();
  } else eb.style.display = 'none';
}

function clearMarks(){
  if(editorMarks.line!=null){
    cm.removeLineClass(editorMarks.line,'background','cur-line');
    cm.removeLineClass(editorMarks.line,'background','err-line');
    cm.setGutterMarker(editorMarks.line,'arrow-gutter',null);
    editorMarks.line=null;
  }
  if(editorMarks.prevLine!=null){
    cm.removeLineClass(editorMarks.prevLine,'background','prev-line');
    cm.setGutterMarker(editorMarks.prevLine,'arrow-gutter',null);
    editorMarks.prevLine=null;
  }
}

function fmt(v,heap,d=0){
  if(v.k==='p') return v.v;
  const o=heap[v.id]; if(!o||d>2) return '…';
  if(o.items){const lr=o.t==='list'?['[',']']:o.t==='tuple'?['(',')']:['{','}'];return lr[0]+o.items.map(x=>fmt(x,heap,d+1)).join(', ')+(o.more?', …':'')+lr[1];}
  if(o.pairs){ if(o.t==='dict') return '{'+o.pairs.map(([k,x])=>fmt(k,heap,d+1)+': '+fmt(x,heap,d+1)).join(', ')+'}'; return 'อ็อบเจกต์ '+o.cls; }
  if(o.t==='generator') return 'generator '+o.name;
  if(o.t==='function') return 'ฟังก์ชัน '+o.name;
  if(o.t==='class') return 'คลาส '+o.name;
  return o.repr||'…';
}
function explain(i){
  const st=trace.steps[i], prev=i>0?trace.steps[i-1]:null, last=i===trace.steps.length-1;
  const ch=[];
  if(prev){
    const pt=prev.stack[prev.stack.length-1], ct=st.stack[st.stack.length-1];
    const exitedTop = pt.cid!==undefined && !st.stack.some(f=>f.cid===pt.cid);
    const enteredTop = ct.cid!==undefined && !prev.stack.some(f=>f.cid===ct.cid);
    if(exitedTop && prev.stack.length>1){
      ch.push('ออกจากฟังก์ชัน <code>'+esc(prev.fn)+'()</code>'+(prev.ret?(prev.ev==='yield'?' และหยุดรอ (yield) ส่งค่า <b>':' และส่งค่ากลับ <b>')+esc(fmt(prev.ret,prev.heap))+'</b>':''));
    }
    if(enteredTop && st.stack.length>1){
      const f=st.stack[st.stack.length-1];
      ch.push('เข้าไปทำงานในฟังก์ชัน <code>'+esc(f.name)+'()</code>'+(f.vars.length?' โดยรับค่า '+f.vars.map(([n,v])=>esc(n)+' = '+esc(fmt(v,st.heap))).join(', '):''));
    }
    const n=Math.min(st.stack.length,prev.stack.length);
    for(let fi=0;fi<n;fi++){
      const a=prev.stack[fi], b=st.stack[fi]; if(a.name!==b.name || a.cid!==b.cid) continue;
      const old={}; a.vars.forEach(([k,v])=>old[k]=fmt(v,prev.heap));
      b.vars.forEach(([k,v])=>{
        const nv=fmt(v,st.heap);
        if(!(k in old)) ch.push('สร้างตัวแปร <code>'+esc(k)+'</code> = <b>'+esc(nv)+'</b>');
        else if(old[k]!==nv) ch.push('<code>'+esc(k)+'</code> เปลี่ยนจาก '+esc(old[k])+' เป็น <b>'+esc(nv)+'</b>');
      });
    }
    if(st.out>prev.out){
      const t=trace.out.slice(prev.out,st.out).trimEnd();
      ch.push('แสดงผลบนหน้าจอ: <b>'+esc(t)+'</b>');
    }
    if(!ch.length) ch.push('ไม่มีอะไรเปลี่ยน (เช่น เช็คเงื่อนไข หรือข้ามบรรทัดว่าง)');
  } else ch.push('โปรแกรมเริ่มทำงาน');
  const src=esc(cm.getLine(st.line-1).trim());
  let now;
  if(st.ev==='yield') now = 'กำลังจะ <code>yield</code> ค่า <b>'+(st.ret?esc(fmt(st.ret,st.heap)):'None')+'</b> ออกจาก <code>'+esc(st.fn)+'()</code> แล้วหยุดรอไว้ จนกว่าจะถูกขอค่าถัดไป';
  else if(st.ev==='return') now = last ? 'จบโปรแกรมแล้ว' : 'กำลังจะออกจากฟังก์ชัน <code>'+esc(st.fn)+'()</code>'+(st.ret?' ส่งค่ากลับ <b>'+esc(fmt(st.ret,st.heap))+'</b>':'');
  else now = 'ต่อไปจะทำ (บรรทัด '+st.line+'): <code>'+src+'</code>';
  if(st.ex && st.ex.length && st.ev==='line'){
    now += '<div class="exrows">'+st.ex.map(r=>'<span class="exr"><code>'+esc(r[0])+'</code> <i>=</i> <b>'+esc(r[1])+'</b></span>').join('')+'</div>';
  }
  now += substLine(st);
  if(st.un) now += '<div class="unroll"><div class="hint">comprehension บรรทัดนี้ เทียบเท่าลูปธรรมดา:</div><pre>'+esc(st.un)+'</pre></div>';
  let h='<b>เพิ่งเกิดขึ้น:</b>'+ch.map(c=>'<span class="ch">'+c+'</span>').join('')+'<div class="now">'+now+'</div>';
  if(last && trace.truncated) h+='<div class="now">โปรแกรมถูกหยุดเพราะถึงขีดจำกัดจำนวนขั้นตอน — เพิ่มได้จากเมนู “สูงสุด” ใต้แถบเลื่อน (หรือโค้ดอาจวนลูปไม่รู้จบ)</div>';
  if(last && trace.needs_input!=null) h+='<div class="now">โปรแกรมหยุดรอรับค่าจาก <code>input()</code> — พิมพ์ในช่อง “รอรับค่า” ใต้ผลลัพธ์ แล้วกด Enter</div>';
  if((last || i===errStepIndex(trace)) && trace.error){ const th=errInfo(trace.error.msg); h+='<div class="now" style="color:var(--red)">เกิดข้อผิดพลาด: '+esc(trace.error.msg)+(th?'<br><span style="color:var(--text)">'+esc(th)+'</span>':'')+'</div>'; }
  if(false) h+='<div class="now" style="color:var(--red)">เกิดข้อผิดพลาด: '+esc(trace.error.msg)+'</div>';
  if(notes[i]) h = '<div class="note"><b>โน้ต:</b> '+esc(notes[i])+'</div>' + h;
  return h;
}
// escape for text AND attribute values (quotes too): code and data from the user / a shared link end up in title="..." attributes
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

const TH={int:'จำนวนเต็ม',float:'ทศนิยม',str:'ข้อความ',bool:'จริง/เท็จ',NoneType:'ไม่มีค่า',list:'ลิสต์ (รายการ)',dict:'ดิกชันนารี (คู่ key:value)',tuple:'ทูเพิล (รายการแก้ไม่ได้)',set:'เซ็ต (ไม่ซ้ำ)',frozenset:'เซ็ต',function:'ฟังก์ชัน',class:'คลาส',instance:'อ็อบเจกต์ของคลาส',complex:'จำนวนเชิงซ้อน',bytes:'ไบต์'};
let curHeap={}, simple=true;
const watched=new Set();
function typeName(v,heap){ if(v.k==='p') return v.t; const o=heap[v.id]; if(!o) return '?'; return (o.t==='instance'||o.t==='other')?o.cls:o.t; }
function typeBadge(v,heap){
  const t=typeName(v,heap), o=v.k==='r'?heap[v.id]:null;
  const key=o&&o.t==='instance'?'instance':t;
  const mc = ['list','dict','set','instance'].indexOf(key)>=0 ? ' tb-m' : (['int','float','str','bool','NoneType','tuple','frozenset','bytes','complex','function','class'].indexOf(key)>=0 ? ' tb-i' : '');
  return '<span class="tb'+mc+'" title="'+esc((TH[key]||t)+(mc===' tb-m'?' · แก้ไขค่าได้ (mutable)':mc===' tb-i'?' · แก้ไขไม่ได้ (immutable)':''))+'">'+esc(t)+'</span>';
}
function valHTML(v){
  if(simple && v.k==='r') return '<span class="p-ref">'+esc(fmt(v,curHeap))+'</span>';
  if(v.k==='r') return '<span class="dot" data-to="'+v.id+'"></span>';
  return '<span class="p-'+v.t+'">'+esc(v.v)+'</span>';
}

function render(i){
  if(!trace||!trace.steps.length) return;
  i = Math.max(0, Math.min(trace.steps.length-1, i));
  cur = i;
  const st = trace.steps[i], prev = i>0 ? trace.steps[i-1] : null;
  curHeap = st.heap;
  $('scrub').value = i;
  $('scrub').style.setProperty('--p', (trace.steps.length>1 ? i/(trace.steps.length-1)*100 : 100)+'%');

  // editor highlight
  clearMarks();
  const ln = st.line-1;
  cm.findMarksAt({line:ln, ch:0}).forEach(m=>{ if(m.__isFold) m.clear(); });
  cm.addLineClass(ln,'background','cur-line');
  const mk = document.createElement('div'); mk.className='arrow-mark'; 
  cm.setGutterMarker(ln,'arrow-gutter',mk);
  editorMarks.line = ln;
  if(prev && prev.line-1!==ln){
    const g=document.createElement('div'); g.className='arrow-mark prev';
    cm.setGutterMarker(prev.line-1,'arrow-gutter',g);
    cm.addLineClass(prev.line-1,'background','prev-line');
    editorMarks.prevLine=prev.line-1;
  }
  cm.scrollIntoView({line:ln,ch:0},60);
  $('lineLabel').textContent = 'บรรทัด '+st.line;

  const last = i===trace.steps.length-1;
  const evText0 = st.ev==='return' ? ('returning from <b>'+esc(st.fn==='<module>'?'program':st.fn+'()')+'</b>') : 'about to run line <b>'+st.line+'</b>';
  const nn = Object.keys(notes).length;
  $('stepinfo').innerHTML = 'ขั้นที่ <b>'+(i+1)+'</b> / '+trace.steps.length+(nn?' · โน้ต '+nn+' รายการ':'');
  $('note').value = notes[i] || '';
  $('dockline').textContent = 'ขั้น ' + (i+1) + '/' + trace.steps.length + ' · บรรทัด ' + st.line + ': ' + (st.ev === 'return' ? 'ส่งค่ากลับ ' + st.fn + '()' : (cm.getLine(st.line-1) || '').trim());
  $('explain').innerHTML = explain(i);

  // output
  const outText = last && !trace.truncated ? trace.out : trace.out.slice(0, st.out);
  $('out').textContent = outText;
  $('out').scrollTop = $('out').scrollHeight;
  const ims=(trace.images||[]).filter(m=>Math.min(m.step,trace.steps.length-1)<=i);
  $('plots').innerHTML=ims.map(m=>'<img alt="plot" src="data:image/png;base64,'+m.img+'">').join('');
  $('outCard').classList.toggle('hasplots',ims.length>0);
  $('outCount').textContent = outText ? outText.split('\n').filter((x,k,a)=>k<a.length-1||x).length+' บรรทัด' : '';
  $('depthLabel').textContent = 'ซ้อนลึก '+st.stack.length+' ชั้น';

  // previous signature maps
  const prevVars = {}, prevHeap = {};
  if(prev){
    prev.stack.forEach((f,fi)=>f.vars.forEach(([n,v])=>prevVars[fi+'|'+f.name+'|'+n]=JSON.stringify(v)));
    Object.keys(prev.heap).forEach(k=>prevHeap[k]=JSON.stringify(prev.heap[k]));
  }

  // which variables point at the same object (is)
  const refNames = {};
  st.stack.forEach(f=>f.vars.forEach(([n,v])=>{
    if(v.k==='r') (refNames[v.id] = refNames[v.id] || []).push((f.mod?'':f.name+'.')+n);
  }));

  // frames
  let fhtml='';
  st.stack.forEach((f,fi)=>{
    const active = fi===st.stack.length-1;
    fhtml += '<div class="frame'+(active?' active':'')+'"><div class="fh"><span>'+esc(f.name)+(f.mod?'':'()')+'</span><small>'+(active?'กำลังทำงาน':'')+'</small></div>';
    if(!f.vars.length) fhtml += '<div class="empty">ยังไม่มีตัวแปร</div>';
    f.vars.forEach(([n,v])=>{
      const changed = prevVars[fi+'|'+f.name+'|'+n] !== JSON.stringify(v);
      const me = (f.mod?'':f.name+'.')+n;
      const al = v.k==='r' ? (refNames[v.id]||[]).filter(x=>x!==me) : [];
      const sb = (f.params && f.params.indexOf(n)>=0) ? ''
               : (f.free && f.free.indexOf(n)>=0 ? '<span class="sb cl" title="ค่านี้มาจากฟังก์ชันด้านนอก (closure)">closure</span>' : '');
      fhtml += '<div class="vrow'+(changed&&prev?' flash':'')+'"><span class="vname'+(watched.has(n)?' w-on':'')+((f.params&&f.params.indexOf(n)>=0)?' param':'')+'" data-w="'+esc(n)+'" title="'+((f.params&&f.params.indexOf(n)>=0)?'พารามิเตอร์ของฟังก์ชัน · ':'')+'คลิกเพื่อติดตามค่าตัวแปรนี้">'+esc(n)+'</span>'
        + typeBadge(v,st.heap) + sb
        + (al.length ? '<span class="alias" title="ชี้ไปที่ออบเจกต์เดียวกัน (is เป็น True)">= '+esc(al.join(', '))+'</span>' : '')
        + '<span class="vval">'+valHTML(v)+'</span></div>';
    });
    if(f.glob && f.glob.length) fhtml += '<div class="globuse">อ่านตัวแปร global: '+f.glob.map(g=>esc(g[0])+' = '+esc(g[1])).join(', ')+'</div>';
    if(active && st.ret) fhtml += '<div class="vrow ret"><span class="vname">ค่าที่ส่งกลับ</span><span class="vval">'+valHTML(st.ret)+'</span></div>';
    fhtml += '</div>';
  });
  if(prev && (prev.ev==='return' || prev.ev==='yield') && prev.stack.length>1 && !st.stack.some(f=>f.cid===prev.stack[prev.stack.length-1].cid)){
    const gf=prev.stack[prev.stack.length-1], saved=curHeap;
    curHeap=prev.heap;
    fhtml += '<div class="frame exited"><div class="fh"><span>'+esc(gf.name)+'()</span><small>'+(prev.ev==='yield'?'หยุดรอ (yield)':'จบแล้ว')+'</small></div>'
      + gf.vars.map(([n,v])=>'<div class="vrow"><span class="vname">'+esc(n)+'</span>'+typeBadge(v,prev.heap)+'<span class="vval">'+valHTML(v)+'</span></div>').join('')
      + (prev.ret?'<div class="vrow ret"><span class="vname">ค่าที่ส่งกลับ</span><span class="vval">'+valHTML(prev.ret)+'</span></div>':'')
      + '</div>';
    curHeap=saved;
  }

  // heap
  const refCount = {}, heapRef = {};   // heapRef: how many *objects* (not variables) point at an object
  st.stack.forEach(f=>f.vars.forEach(([n,v])=>{ if(v.k==='r') refCount[v.id] = (refCount[v.id]||0) + 1; }));
  Object.keys(st.heap).forEach(hid=>{
    const ho = st.heap[hid]; if(!ho) return;
    (ho.items||[]).forEach(v=>{ if(v.k==='r'){ refCount[v.id] = (refCount[v.id]||0) + 1; heapRef[v.id] = (heapRef[v.id]||0) + 1; } });
    (ho.pairs||[]).forEach(([k,v])=>{
      if(k.k==='r'){ refCount[k.id] = (refCount[k.id]||0) + 1; heapRef[k.id] = (heapRef[k.id]||0) + 1; }
      if(v.k==='r'){ refCount[v.id] = (refCount[v.id]||0) + 1; heapRef[v.id] = (heapRef[v.id]||0) + 1; }
    });
  });
  // a list whose rows are lists of plain values, and no other object points at those rows -> draw it as a table
  // (variables such as the loop variable of `for row in grid` may still point at a row: their arrow lands on that table row)
  const gridOf = {}, absorbed = new Set();
  Object.keys(st.heap).forEach(hid=>{
    const ho = st.heap[hid];
    if(!ho || !(ho.t === 'list' || ho.t === 'tuple') || !ho.items.length || ho.more) return;
    if(!ho.items.every(v=>v.k === 'r' && heapRef[v.id] === 1)) return;
    const inner = ho.items.map(v=>st.heap[v.id]);
    if(!inner.every(x=>x && (x.t === 'list' || x.t === 'tuple') && !x.more && x.items.every(cc=>cc.k === 'p'))) return;
    gridOf[hid] = true;
    ho.items.forEach(v=>absorbed.add(String(v.id)));
  });
  const activeCells = subscriptCells(st);
  lastRW = {reads: activeCells.reads, writes: activeCells.writes};
  let ohtml='';
  Object.keys(st.heap).sort((a,b)=>a-b).forEach(id=>{
    const o = st.heap[id]; if(!o) return;
    if(absorbed.has(String(id))) return;
    const changed = prev && prevHeap[id] !== JSON.stringify(o);
    let body='';
    if(gridOf[id]) body = gridHTML(id, o, st, prev, activeCells);
    else if(o.items){
      body = '<div class="cells">'+o.items.map((v,k)=>'<div class="cell'+curCls(activeCells,id+'|'+k)+'" data-oid="'+id+'" data-k="'+k+'"><i>'+(o.t==='set'||o.t==='frozenset'?'':k)+'</i><div class="cv">'+valHTML(v)+'</div></div>').join('')+'</div>';
      if(!o.items.length) body='<div class="more">empty</div>';
    } else if(o.pairs){
      body = '<div class="kv">'+o.pairs.map(([k,v],pi)=>'<div class="k" data-oid="'+id+'" data-k="'+pi+'">'+valHTML(k)+'</div><div data-oid="'+id+'" data-k="'+pi+'"'+(activeCells.has(id+'|'+pi)?' class="'+curCls(activeCells,id+'|'+pi).trim()+'"':'')+'>'+valHTML(v)+'</div>').join('')+'</div>';
      if(!o.pairs.length) body='<div class="more">empty</div>';
    } else if(o.t==='generator'){
      const stTh={GEN_CREATED:'ยังไม่เริ่มทำงาน',GEN_SUSPENDED:'หยุดรอ (suspended)',GEN_RUNNING:'กำลังทำงาน',GEN_CLOSED:'จบแล้ว'};
      body='<div class="more">generator '+esc(o.name)+'() — '+esc(stTh[o.state]||o.state||'')+(o.line?(o.state==='GEN_SUSPENDED'?' · หยุดรออยู่ที่บรรทัด ':' · อยู่ที่บรรทัด ')+o.line:'')+'</div>';
    } else if(o.t==='function') body='<div class="more">def '+esc(o.name)+'()</div>';
    else if(o.t==='class') body='<div class="more">class '+esc(o.name)+'</div>';
    else if(o.t==='module') body='<div class="more">module '+esc(o.name)+'</div>';
    else body='<div class="more">'+esc(o.repr||'')+'</div>';
    if(o.more) body += '<div class="more">… +'+o.more+' more</div>';
    const label = gridOf[id] ? 'list 2 มิติ · ' + o.items.length + '×' + Math.max.apply(null, o.items.map(v=>st.heap[v.id].items.length)) : (o.t==='instance' ? esc(o.cls)+' instance' : esc(o.t==='other'?o.cls:o.t));
    const mk = (o.t==='list'||o.t==='dict'||o.t==='set'||o.t==='instance') ? 'm' : ((o.t==='tuple'||o.t==='frozenset'||o.t==='function'||o.t==='class'||o.t==='module') ? 'i' : '');
    const nm = refNames[id] ? '<div class="oref">'+esc(refNames[id].join(', '))+'</div>' : '';
    ohtml += '<div class="obj'+(mk==='m'?' mut':mk==='i'?' imm':'')+(changed?(prevHeap[id]===undefined?' pop':' flash'):'')+'" id="obj-'+id+'" title="'+(mk==='m'?'แก้ไขค่าได้ (mutable)':mk==='i'?'แก้ไขไม่ได้ (immutable)':'')+'"><div class="ot"><span>'+label+'</span><span>#'+id+'</span></div>'+nm+body+'</div>';
  });

  $('viz').innerHTML = '<div class="inner'+(simple?' simple':'')+'" id="inner"><svg class="arrows" id="arrows"></svg>'
    + '<div><h3>ตัวแปรของแต่ละฟังก์ชัน</h3>'+fhtml+'</div>'
    + (simple ? '' : '<div><h3>ข้อมูลใน memory (ลูกศร = ตัวแปรชี้มาที่นี่)</h3><div class="objs">'+(ohtml||'<div class="empty">ยังไม่มีข้อมูล</div>')+'</div></div>')
    + '</div>';
  drawArrows();
  if(vizTab==='tree') renderTree(); else if(vizTab==='stats') renderStats(); else if(vizTab==='calls') renderCalls();
  renderWatch();
  renderContext(i);
  if(window.Mascot && last && !trace.error && trace.needs_input == null && trace.steps.length > 1) Mascot.event('end', trace.steps.length);
  showError2(last || i===errStepIndex(trace));
}

function showError2(last){
  const eb=$('errBox');
  if(last && trace.error){ showError(); const l=trace.error.line; if(l){ cm.addLineClass(l-1,'background','err-line'); } }
  else if(!last) eb.style.display='none';
}

function drawArrows(){
  const inner=$('inner'), svg=$('arrows'); if(!inner) return;
  const base=inner.getBoundingClientRect();
  const W=inner.scrollWidth, H=inner.scrollHeight;
  let p='<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#6ea8fe"/></marker><marker id="ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#fb923c"/></marker></defs>';
  const dots=inner.querySelectorAll('.dot[data-to]');
  dots.forEach((d,idx)=>{
    const t=document.getElementById('obj-'+d.dataset.to); if(!t) return;
    const a=d.getBoundingClientRect(), b=t.getBoundingClientRect();
    const x1=a.left+a.width/2-base.left, y1=a.top+a.height/2-base.top;
    let x2=b.left-base.left, y2=b.top+Math.min(14,b.height/2)-base.top;
    let c1x=x1+60, c2x=x2-60;
    if(x2<x1+10){ // target to the left/same column: come in from the top
      x2=b.left+b.width/2-base.left; y2=b.top-base.top; c1x=x1+50;
      p+='<path d="M'+x1+' '+y1+' C'+c1x+' '+y1+' '+x2+' '+(y2-50)+' '+x2+' '+y2+'" fill="none" stroke="#6ea8fe" stroke-width="1.8" marker-end="url(#ah)" opacity=".85" data-src="'+idx+'" data-to="'+d.dataset.to+'"/>';
      return;
    }
    p+='<path d="M'+x1+' '+y1+' C'+c1x+' '+y1+' '+c2x+' '+y2+' '+x2+' '+y2+'" fill="none" stroke="#6ea8fe" stroke-width="1.8" marker-end="url(#ah)" opacity=".85" data-src="'+idx+'" data-to="'+d.dataset.to+'"/>';
  });
  if(lastRW && lastRW.writes.length && lastRW.reads.length){
    const cellEl = o=>inner.querySelector('[data-oid="' + o.oid + '"][data-k="' + o.k + '"]');
    lastRW.writes.forEach(wc=>{
      const we = cellEl(wc); if(!we) return;
      const wb = we.getBoundingClientRect();
      lastRW.reads.slice(0, 6).forEach(rc=>{
        if(rc.oid === wc.oid && rc.k === wc.k) return;
        const re = cellEl(rc); if(!re) return;
        const rb = re.getBoundingClientRect();
        const x1 = rb.left + rb.width / 2 - base.left, y1 = rb.top + rb.height / 2 - base.top;
        const x2 = wb.left + wb.width / 2 - base.left, y2 = wb.top + wb.height / 2 - base.top;
        const mx = (x1 + x2) / 2, my = Math.min(y1, y2) - 22;
        p += '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' Q' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' ' + x2.toFixed(1) + ' ' + y2.toFixed(1)
          + '" fill="none" stroke="#fb923c" stroke-width="1.8" stroke-dasharray="5 4" marker-end="url(#ah2)" opacity=".9"/>';
      });
    });
  }
  svg.innerHTML=p;
  const clear=()=>{ svg.classList.remove('dim'); svg.querySelectorAll('.on').forEach(x=>x.classList.remove('on')); inner.querySelectorAll('.obj.hl').forEach(x=>x.classList.remove('hl')); };
  const on=(sel,id)=>{ clear(); svg.classList.add('dim'); svg.querySelectorAll(sel).forEach(x=>x.classList.add('on')); const t=document.getElementById('obj-'+id); if(t) t.classList.add('hl'); };
  dots.forEach((d,idx)=>{ d.onmouseenter=()=>on('path[data-src="'+idx+'"]',d.dataset.to); d.onmouseleave=clear; });
  inner.querySelectorAll('.obj').forEach(o=>{ const id=o.id.slice(4); o.onmouseenter=()=>on('path[data-to="'+id+'"]',id); o.onmouseleave=clear; });
}
window.addEventListener('resize',drawArrows);

// playback
function stop(){ if(timer){clearInterval(timer);timer=null;} $('play').textContent='เล่น'; }
function play(){
  if(!trace) return;
  if(cur>=trace.steps.length-1) render(0);
  $('play').textContent='หยุด';
  const ms = 1100 - $('speed').value*100;
  timer=setInterval(()=>{
    if(cur>=trace.steps.length-1){ stop(); return; }
    render(cur+1);
  }, ms);
}
$('play').onclick=()=>timer?stop():play();
$('speed').oninput=()=>{ if(timer){stop();play();} };
$('next').onclick=()=>{stop();render(cur+1)};
$('prev').onclick=()=>{stop();render(cur-1)};
$('first').onclick=()=>{stop();render(0)};
$('last').onclick=()=>{stop();render(trace.steps.length-1)};
$('scrub').oninput=e=>{stop();render(+e.target.value)};
$('run').onclick=run;
document.addEventListener('keydown',e=>{
  if(!trace || e.target.closest('.CodeMirror') || e.target.tagName==='TEXTAREA' || e.target.tagName==='SELECT') return;
  if(e.key==='ArrowRight' && !e.shiftKey){stop();render(cur+1);}
  else if(e.key==='ArrowLeft'){stop();render(cur-1);}
  else if(e.key==='Home'){stop();render(0);}
  else if(e.key==='End'){stop();render(trace.steps.length-1);}
  else if(e.key===' '){e.preventDefault();timer?stop():play();}
});
cm.addKeyMap({'Ctrl-Enter':run,'Cmd-Enter':run});

// click a line number -> jump to the next step on that line
cm.on('gutterClick',(c,n)=>{
  if(!trace||!trace.steps.length) return;
  const L=n+1, S=trace.steps; let idx=-1;
  for(let k=cur+1;k<S.length;k++) if(S[k].line===L&&S[k].ev==='line'){idx=k;break;}
  if(idx<0) for(let k=0;k<=cur;k++) if(S[k].line===L&&S[k].ev==='line'){idx=k;break;}
  if(idx>=0){ stop(); render(idx); }
});

// ---------- watch panel ----------
function seriesOf(name){
  const hitc=seriesCache.get(name);
  if(hitc && hitc.t===trace) return hitc.s;
  const S=trace.steps, out=[];
  for(let k=0;k<S.length;k++){
    const st=S[k]; let val=null;
    for(let f=st.stack.length-1;f>=0;f--){
      const e=st.stack[f].vars.find(x=>x[0]===name);
      if(e){ val=fmt(e[1],st.heap); break; }
    }
    out.push(val);
  }
  seriesCache.set(name,{t:trace,s:out});
  return out;
}
function renderWatch(){
  const el=$('watch'); if(!el) return;
  if(!trace||!watched.size){
    el.innerHTML=''; el.classList.add('empty');
    return;
  }
  const n=trace.steps.length; let h='';
  watched.forEach(name=>{
    const ser=seriesOf(name);
    const nums=ser.map(v=>(v!==null&&v!==''&&!isNaN(Number(v)))?Number(v):null);
    const have=nums.filter(x=>x!==null);
    const curv=ser[cur]===null?'(ยังไม่มีตัวแปรนี้)':String(ser[cur]).slice(0,60);
    let chart='';
    if(have.length>=2 && n>1){
      const W=220,H=38,lo=Math.min.apply(null,have),hi=Math.max.apply(null,have),rng=(hi-lo)||1;
      const pts=[];
      nums.forEach((v,k)=>{ if(v!==null) pts.push((k/(n-1)*W).toFixed(1)+','+(H-5-(v-lo)/rng*(H-10)).toFixed(1)); });
      const cx=(cur/(n-1)*W).toFixed(1);
      chart='<svg class="spark" data-n="'+n+'" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'
        +'<polyline points="'+pts.join(' ')+'" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round"/>'
        +'<line x1="'+cx+'" x2="'+cx+'" y1="0" y2="'+H+'" stroke="var(--accent2)" stroke-width="1.5"/></svg>'
        +'<div class="more">ต่ำสุด '+lo+' · สูงสุด '+hi+' (คลิกกราฟเพื่อกระโดดไปขั้นนั้น)</div>';
    }
    h+='<div class="wchip"><div class="wn"><span>'+esc(name)+'</span><button data-rm="'+esc(name)+'" title="เลิกติดตาม">ปิด</button></div>'
      +'<div class="wv">'+esc(curv)+'</div>'+chart+'</div>';
  });
  el.classList.remove('empty');
  el.innerHTML=h;
}
$('viz').addEventListener('click',e=>{
  const t=e.target.closest('.vname[data-w]'); if(!t) return;
  const n=t.dataset.w;
  if(watched.has(n)) watched.delete(n); else watched.add(n);
  if(trace) render(cur);
});
$('watch').addEventListener('click',e=>{
  const rm=e.target.closest('button[data-rm]');
  if(rm){ watched.delete(rm.dataset.rm); if(trace) render(cur); return; }
  const sv=e.target.closest('svg.spark');
  if(sv && trace){
    const r=sv.getBoundingClientRect(), n=+sv.dataset.n;
    const k=Math.round((e.clientX-r.left)/r.width*(n-1));
    stop(); render(Math.max(0,Math.min(n-1,k)));
  }
});

// ---------- viz tabs / call tree / stats ----------
let vizTab = 'mem', heatOn = false, heatLines = [];
function setVizTab(t){
  vizTab = t; $('vizCard').dataset.tab = t;
  document.querySelectorAll('#vtabs button').forEach(b=>b.classList.toggle('on', b.dataset.t===t));
  if(trace) render(cur); else drawArrows();
}
document.querySelectorAll('#vtabs button').forEach(b=>{ b.onclick = ()=>setVizTab(b.dataset.t); });

function buildTree(){
  if(trace._tree) return trace._tree;
  const S = trace.steps;
  const root = {name:'', children:[], start:0, end:S.length-1};
  const nodes = []; const stack = [root]; let prevC = [];
  for(let i=0;i<S.length;i++){
    const st = S[i], c = st.stack.map(f=>f.cid);
    let p = 0; while(p < c.length && p < prevC.length && c[p] === prevC[p]) p++;
    const keep = Math.max(p, 1);
    while(stack.length > keep){ const nd = stack.pop(); if(nd.end === null) nd.end = i-1; }
    for(let k=keep;k<c.length;k++){
      const f = st.stack[k];
      const np = (f.params||[]).length;
      const args = f.vars.slice(0,np).map(x=>fmt(x[1],st.heap)).join(', ');
      const nd = {name:f.name, args:args, start:i, end:null, ret:null, children:[]};
      nodes.push(nd); stack[stack.length-1].children.push(nd); stack.push(nd);
    }
    prevC = c;
    if((st.ev==='return' || st.ev==='yield') && c.length > 1){
      const nd = stack[stack.length-1];
      nd.ret = st.ret ? fmt(st.ret, st.heap) : 'None';
      nd.end = i;
    }
  }
  trace._tree = {root:root, nodes:nodes};
  return trace._tree;
}
function renderTree(){
  const T = buildTree(), el = $('treeView');
  if(!T.nodes.length){
    el.innerHTML = '<div class="welcome">โปรแกรมนี้ยังไม่มีการเรียกฟังก์ชัน<br>ลองตัวอย่าง “Recursion: factorial” หรือ “Binary search”</div>';
    return;
  }
  let count = 0;
  function html(nd){
    if(nd.start > cur) return '';
    if(++count > 400) return '';
    const done = nd.end!==null && nd.end < cur;
    const active = !done;
    const showRet = nd.ret!==null && nd.end <= cur;
    return '<div class="tn'+(active?' act':'')+(done?' done':'')+'" data-s="'+nd.start+'"><div class="tl">'
      + esc(nd.name)+'('+esc(nd.args)+')'+(showRet?' <span class="tret">→ '+esc(nd.ret)+'</span>':'')
      + '</div>' + nd.children.map(html).join('') + '</div>';
  }
  el.innerHTML = '<div class="thint">คลิกโหนดเพื่อกระโดดไปขั้นนั้น · กรอบสีฟ้า = กำลังทำงานอยู่ · จาง = จบแล้ว · → คือค่าที่ส่งกลับ</div>'
    + T.root.children.map(html).join('') + (count>400 ? '<div class="more">… แสดงสูงสุด 400 โหนด</div>' : '');
}
$('treeView').addEventListener('click', e=>{
  const n = e.target.closest('.tn'); if(!n || !trace) return;
  stop(); render(+n.dataset.s);
});

function renderCalls(){
  const T = buildTree(), el = $('callsView');
  if(!T.nodes.length){
    el.innerHTML = '<div class="welcome">โปรแกรมนี้ยังไม่มีการเรียกฟังก์ชัน</div>';
    return;
  }
  const rows = [];
  const walk = (n, d)=>{ rows.push({nd: n, d: d}); n.children.forEach(c=>walk(c, d + 1)); };
  T.root.children.forEach(nd=>walk(nd, 0));
  const shown = rows.filter(r=>!callsTopOnly || r.d === 0).slice(0, 300);
  const trunc = (s, n)=>s.length > n ? s.slice(0, n - 1) + '…' : s;
  let h = '<label class="toggle mini" style="margin:0 0 10px"><input type="checkbox" id="callsTop"' + (callsTopOnly ? ' checked' : '') + '> เฉพาะการเรียกระดับบนสุด</label>'
    + '<table class="calls"><tr><th>#</th><th>เรียก</th><th>ส่งค่ากลับ</th></tr>';
  shown.forEach((r, idx)=>{
    const nd = r.nd, done = nd.end !== null && nd.end < cur, active = nd.start <= cur && !done;
    const returned = nd.ret !== null && nd.end !== null && nd.end <= cur;
    const cls = (active ? 'act' : '') + (nd.start > cur ? ' future' : '');
    h += '<tr data-s="' + nd.start + '" class="' + cls.trim() + '"><td>' + (idx + 1) + '</td><td style="padding-left:' + (8 + r.d * 14) + 'px"><code title="' + esc(nd.name + '(' + nd.args + ')') + '">'
      + esc(nd.name) + '(' + esc(trunc(nd.args, 70)) + ')</code></td><td class="ret">' + (returned ? esc(trunc(nd.ret, 60)) : '<span style="color:var(--muted)">' + (nd.start > cur ? 'ยังไม่ถึง' : 'ยังทำงานอยู่') + '</span>') + '</td></tr>';
  });
  h += '</table>' + (rows.length > shown.length && !callsTopOnly ? '<div class="more">… แสดง ' + shown.length + ' จาก ' + rows.length + ' การเรียก</div>' : '');
  el.innerHTML = h;
}
$('callsView').addEventListener('click', e=>{
  const r = e.target.closest('tr[data-s]'); if(!r || !trace) return;
  stop(); render(+r.dataset.s);
});
$('callsView').addEventListener('change', e=>{
  if(e.target && e.target.id === 'callsTop'){ callsTopOnly = e.target.checked; renderCalls(); }
});

function computeStats(){
  if(trace._stats) return trace._stats;
  const S = trace.steps, lines = {}, first = {}, calls = {};
  let maxD = 1, ncalls = 0, prevC = [];
  S.forEach((st,i)=>{
    if(st.ev==='line'){ lines[st.line] = (lines[st.line]||0)+1; if(first[st.line]===undefined) first[st.line] = i; }
    const c = st.stack.map(f=>f.cid);
    if(c.length > maxD) maxD = c.length;
    let p = 0; while(p < c.length && p < prevC.length && c[p] === prevC[p]) p++;
    for(let k=Math.max(p,1);k<c.length;k++){ const nm = st.stack[k].name; calls[nm] = (calls[nm]||0)+1; ncalls++; }
    prevC = c;
  });
  const outLines = trace.out ? trace.out.split(String.fromCharCode(10)).filter(x=>x!=='').length : 0;
  trace._stats = {lines:lines, first:first, calls:calls, maxD:maxD, ncalls:ncalls, outLines:outLines};
  return trace._stats;
}
function renderStats(){
  const el = $('statsView'); if(!trace) return;
  const S = computeStats();
  const entries = Object.keys(S.lines).map(k=>[+k, S.lines[k]]).sort((a,b)=>b[1]-a[1]);
  const max = entries.length ? entries[0][1] : 1;
  let h = '<div class="stats"><div class="tiles">'
    + '<div class="tile"><b>'+trace.steps.length.toLocaleString()+'</b><span>ขั้นตอนทั้งหมด</span></div>'
    + '<div class="tile"><b>'+entries.length+'</b><span>บรรทัดที่ถูกรัน</span></div>'
    + '<div class="tile"><b>'+S.ncalls+'</b><span>ครั้งที่เรียกฟังก์ชัน</span></div>'
    + '<div class="tile"><b>'+S.maxD+'</b><span>ซ้อนลึกสุด (ชั้น)</span></div>'
    + '<div class="tile"><b>'+S.outLines+'</b><span>บรรทัดที่ print</span></div></div>'
    + '<label class="toggle" style="display:inline-flex;margin-bottom:12px"><input type="checkbox" id="heat"'+(heatOn?' checked':'')+'> แสดง heat map บนโค้ด (บรรทัดที่รันบ่อย = สีเข้ม)</label>'
    + '<h4>บรรทัดที่รันบ่อยที่สุด</h4><table class="stbl">'
    + entries.slice(0,10).map(([ln,c])=>'<tr data-s="'+S.first[ln]+'"><td>'+ln+'</td><td><code>'+esc(cm.getLine(ln-1).trim().slice(0,46))+'</code></td><td style="width:34%"><div class="sbar" style="width:'+Math.max(3,Math.round(c/max*100))+'%"></div></td><td>'+c+' ครั้ง</td></tr>').join('')
    + '</table>';
  const cn = Object.keys(S.calls).sort((a,b)=>S.calls[b]-S.calls[a]);
  if(cn.length) h += '<h4>ฟังก์ชันที่ถูกเรียก</h4><table class="stbl">'+cn.slice(0,10).map(n=>'<tr><td><code>'+esc(n)+'()</code></td><td>'+S.calls[n]+' ครั้ง</td></tr>').join('')+'</table>';
  el.innerHTML = h + '</div>';
  const hb = $('heat'); if(hb) hb.onchange = ()=>{ heatOn = hb.checked; applyHeat(); };
  applyHeat();
}
$('statsView').addEventListener('click', e=>{
  const r = e.target.closest('tr[data-s]'); if(!r || !trace) return;
  stop(); render(+r.dataset.s);
});
function clearHeat(){
  heatLines.forEach(([l,c])=>cm.removeLineClass(l,'wrap',c));
  heatLines = [];
}
function applyHeat(){
  clearHeat();
  if(!heatOn || !trace) return;
  const S = computeStats();
  const ks = Object.keys(S.lines); if(!ks.length) return;
  const max = Math.max.apply(null, ks.map(k=>S.lines[k]));
  ks.forEach(k=>{
    const lvl = Math.max(1, Math.ceil(S.lines[k]/max*5));
    const c = 'heat-'+lvl, l = +k-1;
    cm.addLineClass(l,'wrap',c); heatLines.push([l,c]);
  });
}

// ---------- notes ----------
$('note').oninput = ()=>{
  const v = $('note').value.trim();
  if(v) notes[cur] = v; else delete notes[cur];
};
$('note').onchange = ()=>{ if(trace) render(cur); };

// ---------- presentation mode ----------
function setPresent(on){
  document.body.classList.toggle('present', on);
  try{
    if(on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(()=>{});
    else if(!on && document.fullscreenElement) document.exitFullscreen();
  }catch(e){}
  setTimeout(()=>{ cm.refresh(); drawArrows(); }, 120);
}
$('present').onclick = ()=>setPresent(!document.body.classList.contains('present'));
$('presExit').onclick = ()=>setPresent(false);
document.addEventListener('fullscreenchange', ()=>{
  if(!document.fullscreenElement && document.body.classList.contains('present')) setPresent(false);
});
document.addEventListener('keydown', e=>{
  if(e.key==='Escape' && document.body.classList.contains('present')) setPresent(false);
});

// ---------- tools menu ----------
document.addEventListener('click', e=>{
  const t = $('tools'); if(!t || !t.open) return;
  if(!e.target.closest('#tools')){ t.open = false; return; }
  if(e.target.closest('.menupanel button')) t.open = false;
});
$('exp').addEventListener('change', ()=>{ $('tools').open = false; });

// ---------- virtual files ----------
const vfiles=new Map();
try{ const j=JSON.parse(localStorage.getItem('pl-files')||'{}'); Object.keys(j).forEach(k=>vfiles.set(k,j[k])); }catch(e){}
function saveFiles(){
  try{ const o={}; vfiles.forEach((v,k)=>{ if(typeof v==='string') o[k]=v; }); localStorage.setItem('pl-files',JSON.stringify(o)); }catch(e){}
}
function renderFiles(){
  const keys=[...vfiles.keys()];
  $('flist').innerHTML = keys.length ? keys.map(k=>{
    const v=vfiles.get(k);
    return '<div class="frow"><code>'+esc(k)+'</code><span>'+(typeof v==='string'?v.length+' ตัวอักษร':v.length+' ไบต์')+'</span><button type="button" data-del="'+esc(k)+'">ลบ</button></div>';
  }).join('') : '<div class="more">ยังไม่มีไฟล์</div>';
  $('fcount').textContent = keys.length ? '('+keys.length+')' : '';
}
function openFiles(name){
  renderFiles();
  if(name) $('fname').value=name;
  if(!$('fdlg').open) $('fdlg').showModal();
}
$('files').onclick=()=>openFiles();
$('fclose').onclick=()=>$('fdlg').close();
$('flist').addEventListener('click',e=>{
  const b=e.target.closest('button[data-del]'); if(!b) return;
  vfiles.delete(b.dataset.del); saveFiles(); renderFiles();
});
$('fup').onchange=async e=>{
  for(const f of e.target.files){
    const buf=new Uint8Array(await f.arrayBuffer());
    let txt=null;
    try{ txt=new TextDecoder('utf-8',{fatal:true}).decode(buf); }catch(_){}
    vfiles.set(f.name, txt!==null ? txt : buf);
  }
  e.target.value=''; saveFiles(); renderFiles();
};
$('fadd').onclick=()=>{
  const n=$('fname').value.trim(); if(!n) return;
  vfiles.set(n,$('ftext').value);
  $('fname').value=''; $('ftext').value='';
  saveFiles(); renderFiles();
};
renderFiles();

// ---------- mobile tabs ----------
document.querySelectorAll('#tabbar button').forEach(b=>{
  b.onclick=()=>{
    document.body.className='tab-'+b.dataset.t;
    document.querySelectorAll('#tabbar button').forEach(x=>x.classList.toggle('on',x===b));
    setTimeout(()=>{ cm.refresh(); drawArrows(); },30);
  };
});

// ---------- export ----------
function download(blob,name){
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}
// Export helpers. html2canvas does not know some of the features we use (closed <details>, styled range inputs,
// the phone layout that shows one tab at a time), so we prepare the page and the cloned copy before drawing.
let exportOpenBefore = false;
function exportBegin(){
  document.body.classList.add('exporting');
  if(window.matchMedia('(max-width: 900px)').matches){
    exportOpenBefore = $('ctrlCard').classList.contains('open');
    document.body.classList.add('export-all');      // phone: show code + memory + output + explanation together
    cm.refresh();
  }
  clearPathHl();
}
function exportEnd(){
  document.body.classList.remove('exporting');
  if(document.body.classList.contains('export-all')){
    document.body.classList.remove('export-all');
    $('ctrlCard').classList.toggle('open', exportOpenBefore);
    cm.refresh(); drawArrows();
  }
}
async function snap(scale){
  const cs = getComputedStyle(document.documentElement);
  const v = n=>cs.getPropertyValue(n).trim();
  const bg = v('--bg') || '#0a0d14';
  await new Promise(r=>setTimeout(r,50));
  // the left column scrolls on screen; the picture should contain all of it (code, controls, explanation, output)
  const mainEl = document.querySelector('main'), colEl = mainEl.querySelector('.col');
  const need = Math.max(mainEl.scrollHeight, mainEl.offsetHeight, colEl ? colEl.scrollHeight + 28 : 0);
  return html2canvas(mainEl, {
    scale: scale, backgroundColor: bg, logging: false, useCORS: true, height: need, windowHeight: need + 100,
    ignoreElements: el=>{
      if(!el.classList) return false;
      if(el.classList.contains('legend')) return true;      // the symbol legend (a <details>) is not useful in a picture
      return el.id === 'pathtip' || el.classList.contains('mascot');
    },
    onclone: doc=>{
      // the progress slider is drawn with a gradient trick that html2canvas cannot read: use plain boxes
      const sc = doc.getElementById('scrub');
      if(sc){
        const pct = parseFloat(sc.style.getPropertyValue('--p')) || 0;
        const track = doc.createElement('div');
        track.style.cssText = 'height:10px;border-radius:99px;overflow:hidden;background:' + v('--line');
        const fill = doc.createElement('div');
        fill.style.cssText = 'height:100%;width:' + pct + '%;border-radius:99px;background:linear-gradient(90deg,' + v('--accent') + ',' + v('--accent2') + ')';
        track.appendChild(fill);
        sc.replaceWith(track);
      }
      doc.querySelectorAll('.speed, #inrow').forEach(e=>e.remove());
      // show everything: no scroll boxes, no clipped explanation
      const st = doc.createElement('style');
      st.textContent = '.explain,.dockmore{max-height:none!important;overflow:visible!important}.col{overflow:visible!important}main{height:auto!important;overflow:visible!important}';
      doc.head.appendChild(st);
      const ed = doc.getElementById('editorCard');
      if(ed){ ed.style.flex = 'none'; ed.style.height = $('editorCard').offsetHeight + 'px'; }
    }
  });
}
async function exportPNG(){
  exportBegin();
  try{
    const c=await snap(2);
    c.toBlob(b=>download(b,'pylens-step-'+(cur+1)+'.png'));
    setStatus('บันทึกภาพแล้ว');
  } finally { exportEnd(); }
}
async function exportGIF(){
  const n=trace.steps.length, MAXF=60, stride=Math.max(1,Math.ceil(n/MAXF));
  const idx=[]; for(let k=0;k<n;k+=stride) idx.push(k); if(idx[idx.length-1]!==n-1) idx.push(n-1);
  const keep=cur; stop();
  exportBegin();
  try{
    const wr = await fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js');
    const code = await wr.text();
    const wurl=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
    const gif=new GIF({workers:2,quality:8,workerScript:wurl});
    const delay=Math.max(250,1100-$('speed').value*100);
    for(let j=0;j<idx.length;j++){
      setStatus('สร้าง GIF '+(j+1)+'/'+idx.length+'...');
      render(idx[j]);
      const c=await snap(0.7);
      gif.addFrame(c,{delay:j===idx.length-1?delay*3:delay,copy:true});
    }
    setStatus('กำลังรวมไฟล์ GIF...');
    await new Promise((res,rej)=>{ gif.on('finished',b=>{ download(b,'pylens.gif'); res(); }); gif.on('abort',rej); gif.render(); });
    setStatus('บันทึก GIF แล้ว ('+idx.length+' เฟรม)');
  } catch(err){ console.error(err); setStatus('สร้าง GIF ไม่สำเร็จ'); }
  finally { exportEnd(); render(keep); }
}
function exportPDF(){
  const S=trace.steps, n=S.length, stride=Math.max(1,Math.ceil(n/250));
  const keep=cur;
  let h='<h1>PyLens - รายงานการรันโปรแกรม</h1><div class="meta">ทั้งหมด '+n+' ขั้นตอน'+(stride>1?' (แสดงทุก '+stride+' ขั้น)':'')+'</div>';
  h+='<section><h4>โค้ดทั้งหมด</h4><pre>'+esc(cm.getValue())+'</pre></section>';
  for(let k=0;k<n;k+=stride){
    const st=S[k];
    h+='<section><h4>ขั้นที่ '+(k+1)+' (บรรทัด '+st.line+')</h4><pre>'+esc(cm.getLine(st.line-1))+'</pre><div class="explain">'+explain(k)+'</div>';
    const rows=[];
    st.stack.forEach(f=>f.vars.forEach(([nm,v])=>rows.push('<tr><td>'+esc(f.name)+'</td><td>'+esc(nm)+'</td><td>'+esc(fmt(v,st.heap))+'</td></tr>')));
    if(rows.length) h+='<table><tr><th>ที่</th><th>ตัวแปร</th><th>ค่า</th></tr>'+rows.join('')+'</table>';
    h+='</section>';
  }
  h+='<section><h4>ผลลัพธ์ของโปรแกรม</h4><pre>'+esc(trace.out)+'</pre></section>';
  if(trace.error) h+='<section><h4>ข้อผิดพลาด</h4><pre>'+esc(trace.error.msg)+'</pre></section>';
  $('report').innerHTML=h;
  setStatus('เลือก "บันทึกเป็น PDF" ในหน้าต่างพิมพ์');
  setTimeout(()=>{ window.print(); },60);
}
$('exp').onchange=async()=>{
  const v=$('exp').value; $('exp').value='';
  if(!v) return;
  if(!trace||!trace.steps.length){ setStatus('กดเริ่มวิเคราะห์ก่อนส่งออก'); return; }
  try{
    if(v==='png') await exportPNG();
    else if(v==='gif') await exportGIF();
    else if(v==='pdf') exportPDF();
  }catch(e){ console.error(e); setStatus('ส่งออกไม่สำเร็จ'); }
};

// ---------- PWA ----------
// Offline caching was removed: clean up any service worker / cache left by earlier versions.
if('serviceWorker' in navigator){
  navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())).catch(()=>{});
}
if(window.caches){
  caches.keys().then(ks=>ks.filter(k=>k.indexOf('pylens-') === 0).forEach(k=>caches.delete(k))).catch(()=>{});
}

// simple mode + theme
$('simple').onchange=()=>{ simple=$('simple').checked; if(trace) render(cur); };
function setTheme(t){
  document.documentElement.setAttribute('data-theme',t);
  applyCmTheme(t);
  try{localStorage.setItem('pl-theme',t)}catch(e){}
  drawArrows();
}
$('theme').onclick=()=>setTheme(document.documentElement.getAttribute('data-theme')==='light'?'dark':'light');
try{
  const t=localStorage.getItem('pl-theme'); if(t) setTheme(t);
  else if(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) setTheme('light');
}catch(e){}


// ---------- 2D tables, cells being touched, access path on hover, code folding ----------
function lookupVar(st, name){
  for(let fi = st.stack.length - 1; fi >= 0; fi--){
    const e = st.stack[fi].vars.find(x=>x[0] === name);
    if(e) return e[1];
  }
  return null;
}
function primIdx(v){
  if(!v || v.k !== 'p') return null;
  if(v.t === 'int') return {n: Number(v.v)};
  if(v.t === 'bool') return {n: v.v === 'True' ? 1 : 0};
  if(v.t === 'str') return {s: String(v.v).replace(/^['"]|['"]$/g, '')};
  return null;
}
function resolveIdx(st, ix){
  ix = ix.trim();
  if(/^-?\d+$/.test(ix)) return {n: parseInt(ix, 10)};
  let m = /^(['"])(.*)\1$/.exec(ix);
  if(m) return {s: m[2]};
  m = /^([A-Za-z_]\w*)$/.exec(ix);
  if(m) return primIdx(lookupVar(st, m[1]));
  m = /^([A-Za-z_]\w*)\s*([+-])\s*(\d+)$/.exec(ix);
  if(m){
    const r = primIdx(lookupVar(st, m[1]));
    if(r && r.n !== undefined) return {n: r.n + (m[2] === '+' ? 1 : -1) * parseInt(m[3], 10)};
  }
  return null;
}
// split "lhs = rhs" (or "lhs += rhs") at the assignment sign that is not inside brackets or quotes
function splitAssign(line){
  let depth = 0, q = null;
  for(let k = 0; k < line.length; k++){
    const ch = line[k];
    if(q){ if(ch === q) q = null; continue; }
    if(ch === '"' || ch === "'"){ q = ch; continue; }
    if(ch === '(' || ch === '[' || ch === '{') depth++;
    else if(ch === ')' || ch === ']' || ch === '}') depth--;
    else if(ch === '#' && depth === 0) break;
    else if(ch === '=' && depth === 0){
      const prev = line[k - 1] || '', next = line[k + 1] || '';
      const isCmp = next === '=' || (prev !== '' && '=!<>'.indexOf(prev) >= 0);
      if(isCmp){ if(next === '=') k++; continue; }
      let lhs = line.slice(0, k), op = '';
      const m = /[+\-*\/%@&|^<>]+$/.exec(lhs);
      if(m){ op = m[0]; lhs = lhs.slice(0, lhs.length - op.length); }
      return {lhs: lhs, op: op, rhs: line.slice(k + 1)};
    }
  }
  return null;
}
// the cells the current line is about to read ('r') or write ('w'), e.g. dp[i][j] = grid[i][j] + dp[i-1][j]
function subscriptCells(st){
  const map = new Map(), reads = [], writes = [];
  const line = cm.getLine(st.line - 1) || '';
  const sp = splitAssign(line);
  const parts = sp ? [{text: sp.lhs, w: true}, {text: sp.rhs, w: false}] : [{text: line, w: false}];
  parts.forEach(part=>{
    const re = /([A-Za-z_]\w*)((?:\[[^\[\]]+\])+)/g;
    let m;
    while((m = re.exec(part.text))){
      const root = lookupVar(st, m[1]);
      if(!root || root.k !== 'r') continue;
      const keys = [...m[2].matchAll(/\[([^\[\]]+)\]/g)].map(x=>resolveIdx(st, x[1]));
      let cur = root;
      for(let ki = 0; ki < keys.length; ki++){
        const o = (cur && cur.k === 'r') ? st.heap[cur.id] : null, key = keys[ki];
        if(!o || !key) break;
        let idx = -1, next = null;
        if(o.items && key.n !== undefined){
          idx = key.n < 0 ? o.items.length + key.n : key.n;
          if(idx < 0 || idx >= o.items.length) break;
          next = o.items[idx];
        } else if(o.pairs && o.t === 'dict'){
          const kk = key.s !== undefined ? key.s : String(key.n);
          idx = o.pairs.findIndex(p=>p[0].k === 'p' && String(p[0].v).replace(/^['"]|['"]$/g, '') === kk);
          if(idx < 0) break;
          next = o.pairs[idx][1];
        } else break;
        const last = ki === keys.length - 1;
        const type = (part.w && last) ? 'w' : 'r';
        const k2 = cur.id + '|' + idx;
        if(type === 'w' || !map.has(k2)) map.set(k2, type);
        if(last) (type === 'w' ? writes : reads).push({oid: cur.id, k: idx});
        cur = next;
      }
    }
  });
  map.reads = reads; map.writes = writes;
  return map;
}
function curCls(map, key){ return map.has(key) ? ' cur cur-' + map.get(key) : ''; }

// ---- the current line with the values put in:  dp[2][2] = 1 + min(7, 6)  ->  7 ----
const CHAIN_RE = /^[A-Za-z_]\w*(?:\.\w+|\[[^\[\]]+\])*$/;
const PRIM_RE = /^(-?\d+(\.\d+)?(e[+-]?\d+)?|'[^']*'|"[^"]*"|True|False|None)$/;
function substText(text, rows){
  const list = rows.filter(r=>CHAIN_RE.test(r[0]) && PRIM_RE.test(r[1])).sort((x, y)=>y[0].length - x[0].length);
  const slots = [], NUL = String.fromCharCode(0);
  let out = text;
  list.forEach(r=>{
    const e = r[0].replace(/[.*+?^${}()|[\]\\]/g, c=>String.fromCharCode(92) + c);
    const re = new RegExp('(?<![\\w.\\]])' + e + '(?![\\w(\\[])', 'g');
    out = out.replace(re, ()=>{ slots.push(r[1]); return NUL + (slots.length - 1) + NUL; });
  });
  return out.split(NUL).map((piece, idx)=>idx % 2 ? slots[+piece] : piece).join('');
}
function substLine(st){
  try{ return substLineRaw(st); }catch(e){ return ''; }
}
function substLineRaw(st){
  if(!st.ex || st.ev !== 'line') return '';
  const src = (cm.getLine(st.line - 1) || '').trim().replace(/:\s*(#.*)?$/, '').replace(/\s+#.*$/, '');
  const sp = splitAssign(src);
  const names = st.ex.filter(r=>/^[A-Za-z_]\w*$/.test(r[0]));
  const shown = sp ? substText(sp.lhs.trim(), names) + ' ' + sp.op + '= ' + substText(sp.rhs.trim(), st.ex) : substText(src, st.ex);
  if(shown === src) return '';
  return '<div class="subst"><span class="hint">แทนค่า</span><code>' + esc(shown) + '</code>'
    + (st.rt ? ' <i>→</i> <b>' + esc(st.rt[1]) + '</b>' : '') + '</div>';
}

function gridHTML(id, o, st, prev, cells){
  const rows = o.items.map(v=>({id: v.id, o: st.heap[v.id]}));
  const cols = Math.max.apply(null, rows.map(r=>r.o.items.length));
  let h = '<table class="grid"><tr><th></th>';
  for(let c = 0; c < cols; c++) h += '<th>' + c + '</th>';
  h += '</tr>';
  rows.forEach((r, ri)=>{
    h += '<tr id="obj-' + r.id + '"><th data-oid="' + id + '" data-k="' + ri + '"' + (cells.has(id + '|' + ri) ? ' class="' + curCls(cells, id + '|' + ri).trim() + '"' : '') + '>' + ri + '</th>';
    for(let c = 0; c < cols; c++){
      const cell = r.o.items[c];
      if(!cell){ h += '<td class="void"></td>'; continue; }
      const po = prev && prev.heap[r.id], pc = po && po.items && po.items[c];
      const changed = prev && (!pc || pc.v !== cell.v || pc.t !== cell.t);
      const cls = (changed ? 'flash ' : '') + curCls(cells, r.id + '|' + c).trim();
      h += '<td data-oid="' + r.id + '" data-k="' + c + '"' + (cls ? ' class="' + cls.trim() + '"' : '') + '>' + valHTML(cell) + '</td>';
    }
    h += '</tr>';
  });
  return h + '</table>';
}

// hover a cell: show how to reach it from a variable (grid[1][0]) and light up the objects on the way
function pathFor(st, oid, key){
  const q = [], seen = new Set();
  st.stack.forEach(f=>f.vars.forEach(([n, v])=>{
    if(v.k === 'r' && !seen.has(v.id)){ seen.add(v.id); q.push({id: v.id, path: n, ids: [v.id]}); }
  }));
  let found = null;
  while(q.length){
    const c = q.shift();
    if(String(c.id) === String(oid)){ found = c; break; }
    const o = st.heap[c.id]; if(!o) continue;
    if(o.items && (o.t === 'list' || o.t === 'tuple')) o.items.forEach((v, k)=>{
      if(v.k === 'r' && !seen.has(v.id)){ seen.add(v.id); q.push({id: v.id, path: c.path + '[' + k + ']', ids: c.ids.concat(v.id)}); }
    });
    if(o.pairs) o.pairs.forEach(([kv, v])=>{
      if(v.k === 'r' && !seen.has(v.id)){
        seen.add(v.id);
        const part = o.t === 'dict' ? '[' + (kv.k === 'p' ? kv.v : '…') + ']' : '.' + kv.v;
        q.push({id: v.id, path: c.path + part, ids: c.ids.concat(v.id)});
      }
    });
  }
  if(!found) return null;
  const o = st.heap[oid];
  let suffix = '', val = '';
  if(key != null && o){
    if(o.items && (o.t === 'list' || o.t === 'tuple')){ suffix = '[' + key + ']'; if(o.items[+key]) val = fmt(o.items[+key], st.heap); }
    else if(o.pairs && o.pairs[+key]){
      const p = o.pairs[+key];
      suffix = o.t === 'dict' ? '[' + (p[0].k === 'p' ? p[0].v : '…') + ']' : '.' + p[0].v;
      val = fmt(p[1], st.heap);
    }
  }
  return {text: found.path + suffix + (val !== '' ? '  =  ' + val : ''), ids: found.ids};
}
const pathTip = document.createElement('div');
pathTip.id = 'pathtip';
document.body.appendChild(pathTip);
let pathHl = [];
function clearPathHl(){
  pathTip.style.display = 'none';
  pathHl.forEach(el=>el.classList.remove('pathhl'));
  pathHl = [];
}
function placeTip(e){
  pathTip.style.left = Math.min(window.innerWidth - pathTip.offsetWidth - 8, e.clientX + 14) + 'px';
  pathTip.style.top = (e.clientY + 18) + 'px';
}
$('viz').addEventListener('mouseover', e=>{
  const c = e.target.closest('[data-oid]');
  if(!c || !trace || !trace.steps[cur]) return;
  const res = pathFor(trace.steps[cur], c.dataset.oid, c.dataset.k);
  clearPathHl();
  if(!res) return;
  pathTip.textContent = res.text;
  pathTip.style.display = 'block';
  placeTip(e);
  res.ids.forEach(id=>{ const el = document.getElementById('obj-' + id); if(el){ el.classList.add('pathhl'); pathHl.push(el); } });
});
$('viz').addEventListener('mousemove', e=>{ if(pathTip.style.display === 'block') placeTip(e); });
$('viz').addEventListener('mouseout', e=>{ if(e.target.closest('[data-oid]')) clearPathHl(); });

// code folding helpers
function foldInnerLoops(){
  const n = cm.lineCount(), stack = [], targets = [];
  for(let ln = 0; ln < n; ln++){
    const t = cm.getLine(ln);
    if(!/\S/.test(t) || /^\s*#/.test(t)) continue;
    const ind = t.match(/^\s*/)[0].length;
    while(stack.length && ind <= stack[stack.length - 1]) stack.pop();
    if(/^\s*(for|while)\b.*:\s*(#.*)?$/.test(t)){ if(stack.length) targets.push(ln); stack.push(ind); }
  }
  targets.forEach(ln=>cm.foldCode({line: ln, ch: 0}, {rangeFinder: CodeMirror.fold.indent, scanUp: false}));
  setStatus(targets.length ? 'พับลูปชั้นใน ' + targets.length + ' จุด' : 'ไม่พบลูปซ้อนกัน');
}
function unfoldAllCode(){ cm.getAllMarks().forEach(m=>{ if(m.__isFold) m.clear(); }); }
$('foldInner').onclick = foldInnerLoops;
$('foldAllBtn').onclick = ()=>cm.execCommand('foldAll');
$('unfoldAllBtn').onclick = unfoldAllCode;

// ---------- where am I? breadcrumb, loop counters, skip buttons ----------
const CTX_CP = 256;
let loopMarks = [];
let lastRW = null;
let callsTopOnly = false;

function ctxBlocks(){ return (trace && trace.blocks) || []; }

function buildCtx(){
  if(trace._ctx) return trace._ctx;
  const S = trace.steps, B = ctxBlocks();
  const headerAt = {}, desc = B.map(()=>[]);
  B.forEach((b, bi)=>{
    if(b.k === 'for' || b.k === 'while') (headerAt[b.l] = headerAt[b.l] || []).push(bi);
    let p = b.p; while(p >= 0){ desc[p].push(bi); p = B[p].p; }
  });
  const entries = {}, first = {}, checkpoints = [];

  function finalize(fs, cid, record){
    Object.keys(fs).forEach(bi=>{
      const s = fs[bi]; if(!s || s.c === 0) return;
      const e = entries[cid + '|' + bi + '|' + s.seq];
      if(record && e && e.open){ e.total = e.bodySeen ? null : e.execs - 1; e.open = false; }
      fs[bi] = {c:0, seq:s.seq, hs:s.hs};
    });
  }
  function apply(state, i, record){
    const st = S[i];
    if(record) st.stack.forEach(f=>{ if(first[f.cid] === undefined) first[f.cid] = i; });
    const top = st.stack[st.stack.length - 1]; if(!top || top.cid === undefined) return;
    const cid = top.cid, fs = state[cid] || (state[cid] = {});
    if(st.ev === 'return'){ finalize(fs, cid, record); return; }
    if(st.ev !== 'line') return;
    const L = st.line;
    // 1) loops this frame has just left (the line is outside the loop)
    Object.keys(fs).forEach(bi=>{
      const b = B[bi], s = fs[bi];
      if(!s || s.c === 0) return;
      if(L < b.l || L > b.e){
        const e = entries[cid + '|' + bi + '|' + s.seq];
        if(record && e && e.open){ e.total = e.bodySeen ? null : e.execs - 1; e.open = false; }
        fs[bi] = {c:0, seq:s.seq, hs:s.hs};
      }
    });
    // 2) a loop header runs: next iteration (or a new entry into the loop)
    (headerAt[L] || []).forEach(bi=>{
      let s = fs[bi];
      if(!s || s.c === 0){ s = fs[bi] = {c:0, seq:(s ? s.seq : 0) + 1, hs:i}; }
      s.c++; s.hs = i;
      if(record){
        const key = cid + '|' + bi + '|' + s.seq;
        const e = entries[key] || (entries[key] = {execs:0, total:null, bodySeen:false, open:true});
        e.execs++; e.bodySeen = false;
      }
      desc[bi].forEach(d=>{ if(fs[d]) fs[d] = {c:0, seq:fs[d].seq, hs:fs[d].hs}; });
    });
    // 3) a body line ran inside a loop: this iteration did not just end at the header check
    if(record) Object.keys(fs).forEach(bi=>{
      const b = B[bi], s = fs[bi];
      if(!s || s.c === 0) return;
      if(L > b.l && L <= b.e){ const e = entries[cid + '|' + bi + '|' + s.seq]; if(e) e.bodySeen = true; }
    });
  }
  function copy(state){
    const o = {};
    Object.keys(state).forEach(cid=>{ o[cid] = {}; Object.keys(state[cid]).forEach(bi=>{ o[cid][bi] = Object.assign({}, state[cid][bi]); }); });
    return o;
  }
  const state = {};
  for(let i = 0; i < S.length; i++){
    if(i % CTX_CP === 0) checkpoints.push(copy(state));
    apply(state, i, true);
  }
  const ctx = {
    entries: entries, first: first,
    stateAt(i){
      const st = copy(checkpoints[Math.floor(i / CTX_CP)]);
      for(let j = Math.floor(i / CTX_CP) * CTX_CP; j <= i; j++) apply(st, j, false);
      return st;
    }
  };
  trace._ctx = ctx;
  return ctx;
}

// loops / branches that contain line L (outer -> inner)
function enclosing(L){
  const B = ctxBlocks();
  let best = -1;
  B.forEach((b, bi)=>{ if(L >= b.l && L <= b.e && (best < 0 || b.l > B[best].l || (b.l === B[best].l && b.e <= B[best].e))) best = bi; });
  const chain = [];
  for(let bi = best; bi >= 0; bi = B[bi].p) chain.push(bi);
  return chain.reverse();
}

function contextAt(i){
  const S = trace.steps, B = ctxBlocks(), C = buildCtx(), st = S[i], state = C.stateAt(i);
  const crumbs = [];
  st.stack.forEach((f, fi)=>{
    const top = fi === st.stack.length - 1;
    const L = top ? st.line : f.ln;
    crumbs.push({t:'f', text: fi === 0 ? 'โปรแกรมหลัก' : f.name + '()', step: C.first[f.cid], top: top && false, cid: f.cid, fi: fi});
    enclosing(L).forEach(bi=>{
      const b = B[bi];
      if(b.k === 'for' || b.k === 'while'){
        const s = state[f.cid] && state[f.cid][bi];
        if(!s || s.c === 0) return;
        const e = C.entries[f.cid + '|' + bi + '|' + s.seq];
        const total = e ? e.total : null;
        crumbs.push({t:'l', text: b.t, k: s.c, total: total, step: s.hs, bi: bi, cid: f.cid, line: b.l});
      } else {
        if(L >= b.bs && L <= b.be) crumbs.push({t:'i', text: b.t, bi: bi});
        else if(b.os && L >= b.os && L <= b.oe && !b.elif) crumbs.push({t:'i', text: 'else', bi: bi});
      }
    });
  });
  if(crumbs.length) crumbs[crumbs.length - 1].top = true;
  return crumbs;
}

function loopLabel(c){
  if(c.total != null){
    if(c.k > c.total) return {text:'ตรวจครั้งสุดท้าย → จบลูป', end:true};
    return {text:'รอบที่ ' + c.k + '/' + c.total, end:false};
  }
  return {text:'รอบที่ ' + c.k, end:false};
}

function clearContext(){
  loopMarks.forEach(m=>m.clear()); loopMarks = [];
  const el = $('crumbs'); if(el){ el.innerHTML = ''; el.classList.remove('on'); }
  ['bIter','bLoop','bFunc'].forEach(id=>{ const b = $(id); if(b) b.disabled = true; });
  const sr = $('skiprow'); if(sr) sr.style.display = 'none';
}

function renderContext(i){
  loopMarks.forEach(m=>m.clear()); loopMarks = [];
  const el = $('crumbs');
  if(!trace || !trace.steps.length || !el) return;
  const crumbs = contextAt(i);
  // collapse a very long path
  let shown = crumbs;
  if(crumbs.length > 9) shown = crumbs.slice(0, 2).concat([{t:'gap'}], crumbs.slice(-6));
  el.innerHTML = shown.map((c, idx)=>{
    const sep = idx ? '<span class="sep">›</span>' : '';
    if(c.t === 'gap') return sep + '<span class="sep">…</span>';
    const cls = 'cr' + (c.top ? ' top' : '') + (c.t === 'f' ? ' fn' : '');
    const step = (c.step !== undefined && c.step !== null) ? ' data-step="' + c.step + '"' : '';
    if(c.t === 'l'){
      const lb = loopLabel(c);
      return sep + '<span class="' + cls + '"' + step + ' title="' + esc(c.text) + '">' + esc(c.text) + '<span class="k' + (lb.end ? ' end' : '') + '">' + esc(lb.text) + '</span></span>';
    }
    return sep + '<span class="' + cls + '"' + step + ' title="' + esc(c.text) + '">' + esc(c.text) + '</span>';
  }).join('');
  el.classList.add('on');

  // counters right on the loop header lines (the innermost frame wins when a function recurses)
  const byLine = {};
  crumbs.forEach(c=>{ if(c.t === 'l') byLine[c.line] = c; });
  Object.keys(byLine).forEach(L=>{
    const lb = loopLabel(byLine[L]);
    const ln = +L - 1;
    if(ln < 0 || ln >= cm.lineCount()) return;
    const node = document.createElement('span');
    node.className = 'loopbadge' + (lb.end ? ' end' : '');
    node.textContent = lb.text;
    loopMarks.push(cm.setBookmark({line: ln, ch: cm.getLine(ln).length}, {widget: node, insertLeft: true}));
  });

  // skip buttons
  const top = trace.steps[i].stack[trace.steps[i].stack.length - 1];
  const loops = crumbs.filter(c=>c.t === 'l' && c.cid === top.cid);
  if(trace._hasLoops === undefined){
    trace._hasLoops = ctxBlocks().some(b=>b.k === 'for' || b.k === 'while');
    trace._hasCalls = trace.steps.some(s=>s.stack.length > 1);
  }
  // the skip buttons only appear when the program actually has a loop (or function calls)
  $('skiprow').style.display = (trace._hasLoops || trace._hasCalls) ? 'flex' : 'none';
  $('bIter').style.display = $('bLoop').style.display = trace._hasLoops ? '' : 'none';
  $('bFunc').style.display = trace._hasCalls ? '' : 'none';
  $('bIter').disabled = !loops.length;
  $('bLoop').disabled = !loops.length;
  $('bFunc').disabled = trace.steps[i].stack.length < 2;
}

function lastStepIndex(){ return trace.steps.length - 1; }
function innermostLoop(i){
  const top = trace.steps[i].stack[trace.steps[i].stack.length - 1];
  const loops = contextAt(i).filter(c=>c.t === 'l' && c.cid === top.cid);
  return loops.length ? {loop: loops[loops.length - 1], cid: top.cid} : null;
}
function jumpTo(j){ stop(); render(j == null ? lastStepIndex() : Math.min(j, lastStepIndex())); }

$('bLoop').onclick = ()=>{
  if(!trace) return;
  const il = innermostLoop(cur); if(!il) return;
  const b = ctxBlocks()[il.loop.bi], S = trace.steps;
  for(let j = cur + 1; j < S.length; j++){
    const sj = S[j], tj = sj.stack[sj.stack.length - 1];
    if(!sj.stack.some(f=>f.cid === il.cid)) return jumpTo(j);
    if(tj.cid === il.cid && (sj.ev === 'return' || (sj.ev === 'line' && (sj.line < b.l || sj.line > b.e)))) return jumpTo(j);
  }
  jumpTo(null);
};
$('bIter').onclick = ()=>{
  if(!trace) return;
  const il = innermostLoop(cur); if(!il) return;
  const b = ctxBlocks()[il.loop.bi], S = trace.steps;
  for(let j = cur + 1; j < S.length; j++){
    const sj = S[j], tj = sj.stack[sj.stack.length - 1];
    if(!sj.stack.some(f=>f.cid === il.cid)) return jumpTo(j);
    if(tj.cid === il.cid && sj.ev === 'line' && sj.line === b.l) return jumpTo(j);
    if(tj.cid === il.cid && (sj.ev === 'return' || (sj.ev === 'line' && (sj.line < b.l || sj.line > b.e)))) return jumpTo(j);
  }
  jumpTo(null);
};
$('bFunc').onclick = ()=>{
  if(!trace) return;
  const S = trace.steps, top = S[cur].stack[S[cur].stack.length - 1];
  if(S[cur].stack.length < 2) return;
  for(let j = cur + 1; j < S.length; j++){
    if(!S[j].stack.some(f=>f.cid === top.cid)) return jumpTo(j);
  }
  jumpTo(null);
};
$('crumbs').addEventListener('click', e=>{
  const c = e.target.closest('.cr[data-step]'); if(!c || !trace) return;
  jumpTo(+c.dataset.step);
});
document.addEventListener('keydown', e=>{
  if(!trace || e.target.closest('.CodeMirror') || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if(e.key === 'ArrowRight' && e.shiftKey){ e.preventDefault(); if(!$('bLoop').disabled) $('bLoop').click(); }
});

// ---------- worker RPC (syntax check, formatting) ----------
var cmThemeChoice = 'auto';
const rpcPending = new Map();
let rpcId = 0;
function rpc(type, payload){
  return new Promise((res, rej)=>{
    if(!workerReady || !worker){ rej(new Error('not ready')); return; }
    const id = ++rpcId;
    rpcPending.set(id, {res, rej});
    worker.postMessage(Object.assign({type:type, id:id}, payload));
  });
}

// ---------- live syntax check ----------
let synMark = null, synTimer = null;
function clearSyn(){
  if(synMark){ synMark.clear(); synMark = null; }
  $('synMsg').style.display = 'none';
}
function scheduleSyntax(){
  clearTimeout(synTimer);
  synTimer = setTimeout(doSyntax, 600);
}
async function doSyntax(){
  if(!workerReady || running){ synTimer = setTimeout(doSyntax, 800); return; }
  const code = cm.getValue();
  let r;
  try{ r = await rpc('check', {code:code}); }catch(e){ return; }
  if(cm.getValue() !== code) return;           // edited meanwhile
  const e = JSON.parse(r.data);
  clearSyn();
  if(!e || !e.line) return;
  const last = cm.lineCount() - 1;
  const ln = Math.max(0, Math.min(last, e.line - 1));
  const text = cm.getLine(ln);
  let from = Math.max(0, (e.col || 1) - 1);
  let to = (e.endline === e.line && e.endcol) ? Math.max(from + 1, e.endcol - 1) : text.length;
  if(from >= text.length) from = Math.max(0, text.length - 1);
  if(to <= from) to = Math.min(text.length, from + 1);
  if(text.length === 0){ from = 0; to = 0; }
  if(window.Mascot) Mascot.event('syntax', e);
  synMark = cm.markText({line:ln, ch:from}, {line:ln, ch:Math.max(to, from)}, {className:'syn-err', title:e.msg});
  const th = errInfo(e.msg);
  $('synMsg').innerHTML = '<b>บรรทัด ' + (ln + 1) + ':</b> ' + esc(e.msg) + (th ? '<div class="th">' + esc(th) + '</div>' : '');
  $('synMsg').style.display = 'block';
}
cm.on('change', scheduleSyntax);

// ---------- parameter hints ----------
const SIGS = {
  'print':'print(*values, sep, end)|แสดงผลออกทางหน้าจอ', 'input':'input(prompt)|รับข้อความจากผู้ใช้',
  'len':'len(obj)|จำนวนสมาชิก', 'range':'range(start, stop, step)|ถ้าให้ค่าเดียว = range(stop)',
  'int':'int(x, base)|แปลงเป็นจำนวนเต็ม', 'float':'float(x)|แปลงเป็นทศนิยม', 'str':'str(obj)|แปลงเป็นข้อความ',
  'bool':'bool(x)|แปลงเป็นจริง/เท็จ', 'list':'list(iterable)|สร้างลิสต์', 'dict':'dict(**kwargs)|สร้างดิกชันนารี',
  'set':'set(iterable)|สร้างเซ็ต', 'tuple':'tuple(iterable)|สร้างทูเพิล', 'sum':'sum(iterable, start)|ผลรวม',
  'min':'min(iterable, key)|ค่าน้อยสุด', 'max':'max(iterable, key)|ค่ามากสุด', 'abs':'abs(x)|ค่าสัมบูรณ์',
  'round':'round(number, ndigits)|ปัดเศษ', 'sorted':'sorted(iterable, key, reverse)|เรียงลำดับ (ได้ลิสต์ใหม่)',
  'reversed':'reversed(seq)|กลับลำดับ', 'enumerate':'enumerate(iterable, start)|ได้ (ลำดับ, ค่า)',
  'zip':'zip(*iterables)|จับคู่หลายลิสต์', 'map':'map(function, iterable)|ใช้ฟังก์ชันกับทุกตัว',
  'filter':'filter(function, iterable)|กรองสมาชิก', 'open':'open(file, mode, encoding)|เปิดไฟล์',
  'isinstance':'isinstance(obj, class)|ตรวจชนิด', 'type':'type(obj)|ชนิดของข้อมูล', 'pow':'pow(base, exp)|ยกกำลัง',
  'divmod':'divmod(a, b)|ผลหารและเศษ', 'chr':'chr(i)|รหัส → อักษร', 'ord':'ord(c)|อักษร → รหัส',
  'any':'any(iterable)|มีตัวไหนเป็นจริง', 'all':'all(iterable)|ทุกตัวเป็นจริง', 'format':'format(value, spec)|จัดรูปแบบ',
  '.append':'append(x)|เพิ่มท้ายลิสต์', '.extend':'extend(iterable)|ต่อลิสต์', '.insert':'insert(index, x)|แทรกที่ตำแหน่ง',
  '.remove':'remove(x)|ลบตัวแรกที่เจอ', '.pop':'pop(index)|ลบและคืนค่า', '.sort':'sort(key, reverse)|เรียงลำดับในที่เดิม',
  '.index':'index(x)|ตำแหน่งแรก', '.count':'count(x)|นับจำนวน', '.get':'get(key, default)|อ่านค่าอย่างปลอดภัย',
  '.update':'update(other)|รวมดิกชันนารี', '.join':'join(iterable)|ต่อข้อความ', '.split':'split(sep, maxsplit)|แยกข้อความ',
  '.replace':'replace(old, new, count)|แทนที่ข้อความ', '.strip':'strip(chars)|ตัดช่องว่างหัวท้าย',
  '.startswith':'startswith(prefix)|ขึ้นต้นด้วย', '.endswith':'endswith(suffix)|ลงท้ายด้วย', '.find':'find(sub)|ตำแหน่งที่พบ',
  '.format':'format(*args, **kwargs)|จัดรูปแบบข้อความ', '.items':'items()|คู่ (key, value)', '.keys':'keys()|รายการ key',
  '.values':'values()|รายการ value', '.upper':'upper()|ตัวพิมพ์ใหญ่', '.lower':'lower()|ตัวพิมพ์เล็ก',
  'math.sqrt':'sqrt(x)|รากที่สอง', 'math.pow':'pow(x, y)|ยกกำลัง', 'math.floor':'floor(x)|ปัดลง', 'math.ceil':'ceil(x)|ปัดขึ้น',
  'math.log':'log(x, base)|ลอการิทึม', 'random.randint':'randint(a, b)|สุ่มจำนวนเต็ม a ถึง b', 'random.choice':'choice(seq)|สุ่มเลือก 1 ตัว',
  'random.uniform':'uniform(a, b)|สุ่มทศนิยม', 'random.shuffle':'shuffle(x)|สลับลำดับในที่เดิม', 'random.sample':'sample(population, k)|สุ่ม k ตัวไม่ซ้ำ',
  'random.randrange':'randrange(start, stop, step)|สุ่มจากช่วง', 'time.sleep':'sleep(seconds)|หยุดรอ (ในเว็บนี้ถูกข้าม)',
  'json.dumps':'dumps(obj, indent)|แปลงเป็นข้อความ JSON', 'json.loads':'loads(s)|แปลงข้อความ JSON',
  're.search':'search(pattern, string)|หา pattern', 're.sub':'sub(pattern, repl, string)|แทนที่ด้วย regex',
  're.findall':'findall(pattern, string)|หาทุกที่ที่ตรง'
};
function parseSig(str, display){
  const parts = str.split('|');
  const m = /^([\w.]+)\((.*)\)$/.exec(parts[0]);
  if(!m) return null;
  return {name: display || m[1], params: m[2] ? m[2].split(',').map(x=>x.trim()) : [], desc: parts[1] || ''};
}
function lookupSig(name){
  const doc = cm.getValue();
  const dot = name.lastIndexOf('.');
  const last = dot >= 0 ? name.slice(dot + 1) : name;
  const obj = dot >= 0 ? name.slice(0, dot) : '';
  const fromDef = re=>{
    const m = re.exec(doc); if(!m) return null;
    const params = m[1].split(',').map(x=>x.trim()).filter(x=>x && x !== 'self' && x !== 'cls');
    return {name: last, params: params, desc: 'ฟังก์ชันที่คุณเขียนเอง'};
  };
  const esc2 = s => s.replace(/[.*+?^${}()|[\]\\]/g, c=>String.fromCharCode(92)+c);
  if(!obj){
    const d = fromDef(new RegExp('^\\s*def\\s+' + esc2(last) + '\\s*\\(([^)]*)\\)', 'm'));
    if(d) return d;
    const k = new RegExp('^\\s*class\\s+' + esc2(last) + '\\b[\\s\\S]*?def\\s+__init__\\s*\\(([^)]*)\\)', 'm');
    const c = fromDef(k); if(c){ c.desc = 'สร้างอ็อบเจกต์ของคลาส ' + last; return c; }
    return SIGS[last] ? parseSig(SIGS[last], last) : null;
  }
  const mods = window.pyImportedModules ? window.pyImportedModules(doc) : {};
  const mod = mods[obj] || obj;
  if(SIGS[mod + '.' + last]) return parseSig(SIGS[mod + '.' + last], last);
  const m = fromDef(new RegExp('^\\s*def\\s+' + esc2(last) + '\\s*\\(([^)]*)\\)', 'm'));
  if(m) return m;
  return SIGS['.' + last] ? parseSig(SIGS['.' + last], last) : null;
}
function callContext(){
  const cur = cm.getCursor();
  let depth = 0, commas = 0;
  for(let ln = cur.line; ln >= Math.max(0, cur.line - 3); ln--){
    const line = cm.getLine(ln);
    for(let i = (ln === cur.line ? cur.ch : line.length) - 1; i >= 0; i--){
      const tt = cm.getTokenTypeAt({line:ln, ch:i + 1}) || '';
      if(/string|comment/.test(tt)) continue;
      const c = line.charAt(i);
      if(c === ')' || c === ']' || c === '}') depth++;
      else if(c === '(' || c === '[' || c === '{'){
        if(depth === 0){
          if(c !== '(') return null;
          const m = /([A-Za-z_][\w.]*)\s*$/.exec(line.slice(0, i));
          return m ? {name: m[1], argIndex: commas} : null;
        }
        depth--;
      } else if(c === ',' && depth === 0) commas++;
    }
  }
  return null;
}
let sigEl = null;
function hideSig(){ if(sigEl){ sigEl.remove(); sigEl = null; } }
function showSig(){
  if(cm.state.completionActive){ hideSig(); return; }
  const ctx = callContext();
  const sig = ctx && lookupSig(ctx.name);
  if(!sig){ hideSig(); return; }
  const pi = Math.min(ctx.argIndex, Math.max(0, sig.params.length - 1));
  const html = esc(sig.name) + '(' + sig.params.map((p, i)=> i === pi ? '<b>' + esc(p) + '</b>' : esc(p)).join(', ') + ')'
    + (sig.desc ? '<span class="sd">' + esc(sig.desc) + '</span>' : '');
  hideSig();
  sigEl = document.createElement('div');
  sigEl.className = 'sigtip';
  sigEl.innerHTML = html;
  cm.addWidget(cm.getCursor(), sigEl, false);
}
cm.on('cursorActivity', showSig);
cm.on('blur', hideSig);

// ---------- formatter ----------
async function formatCode(){
  if(!workerReady){ setStatus('รอตัวรัน Python ให้พร้อมก่อน'); return; }
  setStatus('กำลังจัดรูปโค้ด…');
  try{
    const code = cm.getValue();
    const r = await rpc('format', {code:code});
    if(cm.getValue() !== code){ setStatus('โค้ดถูกแก้ระหว่างจัดรูป — ยกเลิก'); return; }
    const out = r.data;
    if(out !== code){
      const last = cm.lastLine();
      cm.operation(()=>{ cm.replaceRange(out, {line:0, ch:0}, {line:last, ch:cm.getLine(last).length}); });
    }
    setStatus(r.via === 'autopep8' ? 'จัดรูปโค้ดแล้ว (autopep8)' : 'จัดรูปแบบพื้นฐานแล้ว (ต้องใช้เน็ตครั้งแรกเพื่อโหลด autopep8)');
  }catch(e){
    console.error(e);
    setStatus('จัดรูปโค้ดไม่สำเร็จ');
  }
}
$('fmtbtn').onclick = formatCode;
cm.addKeyMap({'Shift-Alt-F': formatCode});

// ---------- editor font size + code theme ----------
let cmSize = 13.5;
function setCmSize(v){
  cmSize = Math.max(11, Math.min(24, v));
  document.documentElement.style.setProperty('--cm-size', cmSize + 'px');
  try{ localStorage.setItem('pl-fs', String(cmSize)); }catch(e){}
  cm.refresh();
  drawArrows();
}
$('fsm').onclick = ()=>setCmSize(cmSize - 1);
$('fsp').onclick = ()=>setCmSize(cmSize + 1);
function applyCmTheme(webTheme){
  const choice = cmThemeChoice || 'auto';
  const t = choice === 'auto' ? (webTheme === 'light' ? 'default' : 'material-darker') : choice;
  cm.setOption('theme', t);
  $('editorCard').classList.toggle('custom', choice !== 'auto');
}
$('cmtheme').onchange = ()=>{
  cmThemeChoice = $('cmtheme').value;
  try{ localStorage.setItem('pl-cmtheme', cmThemeChoice); }catch(e){}
  applyCmTheme(document.documentElement.getAttribute('data-theme') || 'dark');
};
try{
  const fs = parseFloat(localStorage.getItem('pl-fs'));
  if(fs) setCmSize(fs);
  const ct = localStorage.getItem('pl-cmtheme');
  if(ct){ cmThemeChoice = ct; $('cmtheme').value = ct; applyCmTheme(document.documentElement.getAttribute('data-theme') || 'dark'); }
}catch(e){}

startWorker();

// mascot on/off
(function(){
  const cb = document.getElementById('mascotToggle');
  if(!cb) return;
  try{ if(localStorage.getItem('pl-mascot') === '0') cb.checked = false; }catch(e){}
  cb.onchange = ()=>{ if(window.Mascot) Mascot.setEnabled(cb.checked); };
})();

(function(){
  const b = document.getElementById('mascotReset');
  if(b) b.onclick = ()=>{ if(window.Mascot) Mascot.resetPosition(); };
})();

// show / hide the step explanation box
(function(){
  const cb = $('explainOn');
  if(!cb) return;
  function apply(){ $('explain').style.display = cb.checked ? '' : 'none'; }
  try{ if(localStorage.getItem('pl-explain') === '0') cb.checked = false; }catch(e){}
  cb.onchange = ()=>{ try{ localStorage.setItem('pl-explain', cb.checked ? '1' : '0'); }catch(e){} apply(); };
  apply();
})();

// ---------- mobile dock ----------
(function(){
  const dock = $('ctrlCard'), handle = $('dockHandle');
  if(!dock || !handle) return;
  handle.onclick = ()=>dock.classList.toggle('open');
  const root = document.documentElement;
  function setH(){ root.style.setProperty('--dock-h', Math.ceil(dock.getBoundingClientRect().height) + 'px'); }
  if(window.ResizeObserver) new ResizeObserver(setH).observe(dock); else setInterval(setH, 600);
  window.addEventListener('resize', setH);
  setH();
  // the mobile copy of the speed slider
  const sm = $('speedM'), sp = $('speed');
  sm.oninput = ()=>{ sp.value = sm.value; if(sp.oninput) sp.oninput(); };
  sp.addEventListener('input', ()=>{ sm.value = sp.value; });
  // on touch screens there is no hover: tap a cell to see its access path for a moment
  let tapTimer = null;
  $('viz').addEventListener('click', e=>{
    if(!window.matchMedia('(hover: none)').matches) return;
    const c = e.target.closest('[data-oid]');
    if(!c) return;
    c.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, clientX: e.clientX, clientY: e.clientY}));
    clearTimeout(tapTimer);
    tapTimer = setTimeout(()=>c.dispatchEvent(new MouseEvent('mouseout', {bubbles: true})), 3200);
  });
})();
