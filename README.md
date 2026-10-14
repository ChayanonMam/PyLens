# PyLens

**Live demo: https://chayanonmam.github.io/PyLens/**

A step-by-step Python visualizer. Paste or write Python code and watch it run one line at a time: variables,
reference arrows in memory, function calls and output. It runs entirely in the browser (Pyodide) — no backend,
no account, no API key.

## Features

- **Step through code**: forward / back / autoplay, a scrubber, and click a line number to jump to the step that runs it
- **Memory view**: a frame per function call, heap objects (lists, dicts, instances), reference arrows, mutable / immutable markers
- **Explanations at every step** (Thai): expressions broken down piece by piece, list comprehensions unrolled into plain loops
- **Call tree** (great for recursion), **statistics** with a heat map over the code, and **variable watch** with charts
- **Real Python** (CPython 3.12 via Pyodide): `input()`, data files, numpy / pandas / matplotlib
- **Editing help**: autocomplete, parameter hints, live syntax errors, code formatter, editor themes and font size
- **Share and export**: links that open at a given step with notes, PNG, GIF, PDF, presentation mode
- A friendly mascot

## Running it

An internet connection is required: the Python runtime (~10 MB on first load) and the libraries come from CDNs.

| How | Steps |
|---|---|
| **Windows** | Double-click `start.bat` (needs Python installed) |
| **Command line** | `python -m http.server 8765`, then open http://localhost:8765/index.html |
| **Open the file** | Double-click `index.html` (works, but some browsers restrict a few features on `file://`) |

## Project layout

| Path | What it is |
|---|---|
| `index.html` | Page markup |
| `css/style.css` | All styles (dark / light themes, mobile layout) |
| `js/app.js` | UI: playback, memory view, call tree, statistics, export |
| `js/tracer.js` | Python tracer source (runs inside Pyodide in a Web Worker) |
| `js/worker.js` | Web Worker: package loading, file system, running code |
| `js/complete.js` | Editor autocomplete |
| `js/mascot.js` | The mascot (poses, dragging, sleeping) |
| `js/examples.js` | Example programs |
| `assets/` | Mascot image, logo, icons |
| `tests/` | Test suite (tracer cases + layout checks) |
| `start.bat` | Starts a local server and opens the site (Windows) |
| `.github/workflows/pages.yml` | Deploys to GitHub Pages automatically |
| `netlify.toml` | Netlify settings |
| `DEPLOY.md` | How to publish the site |

## Tests

Start a local server as above, then open:

- http://localhost:8765/tests/index.html — tracer cases and layout checks at 4 screen sizes
- http://localhost:8765/tests/index.html?slow — also runs the matplotlib case

The tab title becomes `PASS n` or `FAIL n`; failing rows show what was expected.
The tests back up and restore your `localStorage` (saved code / files / theme).

- Changed `js/tracer.js`? Add a case to `tests/cases.js`.
- Changed CSS or layout? The layout checks catch covered menus, overflow and collapsed editors.

## Publishing

See [`DEPLOY.md`](DEPLOY.md) (GitHub Pages, Netlify, Cloudflare Pages) — all have free plans that are enough.

## Limitations

- Python in the browser cannot use real networking (`requests`), `tkinter`, `subprocess` or `threading`
- A run records at most 2,000 / 10,000 / 30,000 steps (set in the Tools menu)
- Needs an internet connection; offline use is not supported

## Third-party components (loaded from CDNs)

Pyodide (MPL-2.0), CodeMirror 5 (MIT), html2canvas (MIT), gif.js (MIT),
Noto Sans Thai and JetBrains Mono (SIL OFL), autopep8 / pycodestyle (MIT)

The mascot image in `assets/` belongs to its author — make sure you have the right to publish it.
