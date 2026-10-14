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
