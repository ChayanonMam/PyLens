// PyLens service worker: makes the app work offline after the first visit.
const CACHE = 'pylens-v8';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'icon.svg',
  'css/style.css', 'css/fonts.css',
  'js/examples.js', 'js/tracer.js', 'js/worker.js', 'js/app.js', 'js/complete.js', 'js/mascot.js',
  'assets/mascot.webp', 'assets/mascot-blink.webp', 'assets/mascot-happy.webp',
  'assets/logo.webp', 'assets/icon-192.png', 'assets/icon-512.png',
  'vendor/config.js',
  'vendor/codemirror/codemirror.min.js', 'vendor/codemirror/codemirror.min.css',
  'vendor/codemirror/mode/python.min.js',
  'vendor/codemirror/addon/show-hint.min.js', 'vendor/codemirror/addon/show-hint.min.css',
  'vendor/codemirror/addon/closebrackets.min.js', 'vendor/codemirror/addon/matchbrackets.min.js',
  'vendor/codemirror/theme/material-darker.min.css', 'vendor/codemirror/theme/dracula.min.css',
  'vendor/codemirror/theme/monokai.min.css', 'vendor/codemirror/theme/solarized.min.css',
  'vendor/html2canvas/html2canvas.min.js', 'vendor/gifjs/gif.js', 'vendor/gifjs/gif.worker.js',
  // Python runtime core (large files are cached on install so the first offline start works)
  'vendor/pyodide/pyodide.js', 'vendor/pyodide/pyodide.asm.js', 'vendor/pyodide/pyodide.asm.wasm',
  'vendor/pyodide/python_stdlib.zip', 'vendor/pyodide/pyodide-lock.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  e.respondWith(caches.open(CACHE).then(async cache => {
    if (sameOrigin) {
      // our own files: network first, so edits show up; cache is the offline fallback
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return (await cache.match(req)) || (await cache.match('index.html'));
      }
    }
    // CDN files (Pyodide, CodeMirror, fonts...): cache first, refresh in background
    const hit = await cache.match(req);
    const net = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
