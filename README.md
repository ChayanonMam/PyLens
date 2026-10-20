# PyLens

**Live demo: https://chayanonmam.github.io/PyLens/**

A step-by-step Python visualizer. Write or paste Python code and watch it run one line at a time: variables,
reference arrows in memory, function calls, loops and output. It runs entirely in the browser (Pyodide) — no backend,
no account, no API key.

## Features

**Follow the program**
- Step forward / back / autoplay, a scrubber, and click a line number to jump to the step that runs it
- **Where am I?** A breadcrumb (`main › for i › for j › if`), loop counters such as `round 2/5` shown on the loop lines,
  and buttons to jump to the next round, skip a loop, or leave the current function
- Explanations at every step (Thai) with the current line broken into parts and shown with its values put in,
  e.g. `dp[2][2] = 1 + min(6, 8) → 7`; list comprehensions are unrolled into plain loops

**See the data**
- Memory view: a frame per function call, heap objects, reference arrows, mutable / immutable markers
- 2D lists are drawn as tables; cells that the current line **reads** (blue) and **writes** (orange) are highlighted, with
  arrows between them; hover a cell to see how to reach it (`grid[1][0]`)
- Call tree (recursion), call log (what was called, with which arguments, what it returned), statistics with a heat map,
  and variable watch with charts

**Real Python**
- CPython 3.12 via Pyodide: `input()`, data files, numpy / pandas / matplotlib
- Friendly errors in Thai, with a one-click fix for a forgotten `import` (e.g. `Dict`, `math`)

**Writing help**
- Autocomplete, parameter hints, live syntax errors, code formatter, code folding, editor themes and font size

**Share and export**
- Links that open at a given step with notes, PNG, GIF, PDF report, presentation mode
- Works on phones: controls dock at the bottom, three tabs (code / memory / output), tap targets sized for fingers
- A friendly mascot

## Using it

Open the live demo, or run it locally. An internet connection is required: the Python runtime (~10 MB on first load)
and the libraries are loaded from CDNs.

```bash
python -m http.server 8765
```

Then open http://localhost:8765/index.html (opening `index.html` directly also works, but some browsers restrict a few
features on `file://`).

## Project layout

| Path | What it is |
|---|---|
| `index.html` | Page markup |
| `css/style.css` | All styles (dark / light themes, phone layout) |
| `js/app.js` | UI: playback, memory view, call tree, statistics, export |
| `js/tracer.js` | Python tracer source (runs inside Pyodide in a Web Worker) |
| `js/worker.js` | Web Worker: package loading, file system, running code |
| `js/complete.js` | Editor autocomplete |
| `js/mascot.js` | The mascot (poses, dragging, sleeping) |
| `js/examples.js` | Example programs |
| `assets/` | Mascot images, logo, icons |
| `DEPLOY.md` | How to publish the site |

## Limitations

- Python in the browser cannot use real networking (`requests`), `tkinter`, `subprocess` or `threading`
- A run records at most 2,000 / 10,000 / 30,000 steps (set in the Tools menu)
- Needs an internet connection; offline use is not supported

## Third-party components (loaded from CDNs)

Pyodide (MPL-2.0), CodeMirror 5 (MIT), html2canvas (MIT), gif.js (MIT),
Noto Sans Thai and JetBrains Mono (SIL OFL), autopep8 / pycodestyle (MIT)

The mascot image in `assets/` belongs to its author — make sure you have the right to publish it.
