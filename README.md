# PyLens

Step-by-step Python visualizer that runs entirely in the browser (Pyodide). No server-side code.

## Run

Serve the folder over HTTP (needed for the service worker / PWA) and open `index.html`:

```bash
python -m http.server 8765
```

Then open http://localhost:8765/index.html

## Layout

| Path | What it is |
|---|---|
| `index.html` | Markup only |
| `css/style.css` | All styles (dark/light themes, mobile rules) |
| `js/app.js` | UI: editor, playback, memory view, call tree, stats, export |
| `js/tracer.js` | Python tracer source (runs inside Pyodide in a Web Worker) |
| `js/worker.js` | Web Worker entry (package loading, file system, run) |
| `js/examples.js` | Example programs |
| `sw.js`, `manifest.webmanifest`, `icon.svg`, `assets/` | Offline / install support, mascot and icons |
| `vendor/` | Local copies of Pyodide, CodeMirror, html2canvas, gif.js, fonts (created by `tools/vendor.py`) |
| `tools/vendor.py` | Downloads everything into `vendor/` so no CDN is needed |
| `DEPLOY.md` | How to put the site online (GitHub Pages / Netlify) and use it offline |
| `tests/` | Regression tests (tracer cases + layout checks) |

## Tests

Start the server as above and open:

- http://localhost:8765/tests/index.html — tracer cases and layout checks at 4 screen sizes
- http://localhost:8765/tests/index.html?slow — also runs the matplotlib case

The page title becomes `PASS n` or `FAIL n`; failing rows list what was expected.
Tests keep your saved code/files/theme (they back up and restore `localStorage`).

When you change `js/tracer.js`, add a case to `tests/cases.js`.
When you change CSS/layout, the layout checks catch overflow, covered menus and collapsed editors.
