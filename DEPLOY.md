# Putting PyLens online (and keeping it offline-capable)

PyLens is a static site: no server code, no database, no API keys. Any static host works and the free plans are enough.

## 0. What runs where

| Mode | What it needs |
|---|---|
| **Online (CDN)** | Nothing extra. If `vendor/config.js` is missing, the app loads CodeMirror/Pyodide from public CDNs. |
| **Online + self-contained** | Run `python tools/vendor.py` once. Everything is served from your own host (about 72 MB). |
| **Offline** | Open the site once while online. The service worker caches the app and the Python runtime, so later visits work with no internet. |

## 1. Prepare (once, optional but recommended)

```bash
python tools/vendor.py            # ~72 MB: Python runtime + numpy/pandas/matplotlib + libraries + fonts
python tools/vendor.py --dry      # only show what would be downloaded
python tools/vendor.py --no-packages   # smaller (~12 MB): no numpy/pandas/matplotlib
```

This creates `vendor/`, `vendor/config.js` and `css/fonts.css`.

## 2. Check locally

```bash
python -m http.server 8765
```

Open http://localhost:8765/index.html and http://localhost:8765/tests/index.html (title should say `PASS ...`).

## 3. Publish (pick one)

### GitHub Pages (free)

1. Create a repository and push this folder (`vendor/` can be committed, or left out: the workflow downloads it).
2. Settings -> Pages -> **Source: GitHub Actions**.
3. Push to `main`. The workflow `.github/workflows/pages.yml` publishes the site at `https://<user>.github.io/<repo>/`.

### Netlify / Cloudflare Pages / Vercel (free)

1. Create a new site from the repository (or drag the folder into Netlify "Deploy manually").
2. Build command: none. Publish directory: `.`
3. `netlify.toml` already sets sensible cache headers.

### Any other static host

Upload the whole folder (keep the structure). Needs HTTPS for the offline/installable (PWA) features; `localhost` also works.

## 4. After publishing

- Open the site once; the status bar says "ready". After that it also works offline.
- Share links created with the **Share** button contain the code in the URL (`#d=...`), so they work on any host.
- To update: deploy again. The service worker uses network-first for your own files, so users get the new version on the next online visit (cache name is in `sw.js`; bump it when you change the file list).

## Notes

- Total size is dominated by `vendor/pyodide` (numpy 11 MB, pandas 23 MB, matplotlib ~12 MB). Use `--no-packages` or `--packages numpy` to shrink it. Packages that are not vendored are still loaded from the CDN when the code imports them (online only).
- The formatter (`autopep8`) is vendored as wheels in `vendor/wheels`, so it works offline too.
- Licenses: Pyodide (MPL-2.0), CodeMirror 5 (MIT), html2canvas (MIT), gif.js (MIT), Noto Sans Thai and JetBrains Mono (SIL OFL), autopep8/pycodestyle (MIT). Keep their license notices if you redistribute `vendor/`.
- The mascot image is yours; make sure you have the right to publish it.
