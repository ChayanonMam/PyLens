#!/usr/bin/env python3
"""Download third-party files into ./vendor so PyLens can run without any CDN.

Usage (from the project folder):
    python tools/vendor.py                 # download everything
    python tools/vendor.py --dry           # only print what would be downloaded and the total size
    python tools/vendor.py --no-packages   # skip numpy/pandas/matplotlib (smaller, ~12 MB)
    python tools/vendor.py --packages numpy matplotlib   # choose Pyodide packages

Writes vendor/config.js, which tells the app to use the local copies.
Delete vendor/ (or vendor/config.js) to go back to the CDNs.
"""
import argparse, json, os, re, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.path.join(ROOT, 'vendor')

PYODIDE_VERSION = '0.26.4'
PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v%s/full/' % PYODIDE_VERSION
CM = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/'
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/124.0 Safari/537.36')

STATIC = {
    # local path (under vendor/)                   : source URL
    'codemirror/codemirror.min.js':                  CM + 'codemirror.min.js',
    'codemirror/codemirror.min.css':                 CM + 'codemirror.min.css',
    'codemirror/mode/python.min.js':                 CM + 'mode/python/python.min.js',
    'codemirror/addon/show-hint.min.js':             CM + 'addon/hint/show-hint.min.js',
    'codemirror/addon/show-hint.min.css':            CM + 'addon/hint/show-hint.min.css',
    'codemirror/addon/closebrackets.min.js':         CM + 'addon/edit/closebrackets.min.js',
    'codemirror/addon/matchbrackets.min.js':         CM + 'addon/edit/matchbrackets.min.js',
    'codemirror/theme/material-darker.min.css':      CM + 'theme/material-darker.min.css',
    'codemirror/theme/dracula.min.css':              CM + 'theme/dracula.min.css',
    'codemirror/theme/monokai.min.css':              CM + 'theme/monokai.min.css',
    'codemirror/theme/solarized.min.css':            CM + 'theme/solarized.min.css',
    'html2canvas/html2canvas.min.js':                'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'gifjs/gif.js':                                  'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js',
    'gifjs/gif.worker.js':                           'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js',
}
PYODIDE_CORE = ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
WHEELS = ['autopep8', 'pycodestyle']          # installed by micropip when formatting code
FONT_CSS = ('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700'
            '&family=JetBrains+Mono:wght@400;600&display=swap')


def get(url, binary=True):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    return data if binary else data.decode('utf-8')


def head_size(url):
    req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return int(r.headers.get('Content-Length') or 0)
    except Exception:
        return 0


def save(rel, data):
    path = os.path.join(VENDOR, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)


def human(n):
    for u in ('B', 'KB', 'MB', 'GB'):
        if n < 1024 or u == 'GB':
            return '%.1f %s' % (n, u)
        n /= 1024.0


def closure(lock, names):
    pk = lock['packages']
    by_name = {k.lower().replace('_', '-'): k for k in pk}
    out, todo = [], list(names)
    while todo:
        n = todo.pop()
        key = by_name.get(n.lower().replace('_', '-'))
        if key is None:
            print('  ! package not in Pyodide lock file:', n)
            continue
        if key in out:
            continue
        out.append(key)
        todo.extend(pk[key].get('depends', []))
    return out


def pypi_wheel(name):
    meta = json.loads(get('https://pypi.org/pypi/%s/json' % name, binary=False))
    for f in meta['urls']:
        if f['packagetype'] == 'bdist_wheel' and f['filename'].endswith('py3-none-any.whl'):
            return f['filename'], f['url']
    raise RuntimeError('no universal wheel for ' + name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--no-packages', action='store_true')
    ap.add_argument('--packages', nargs='*', default=['micropip', 'numpy', 'pandas', 'matplotlib'])
    a = ap.parse_args()
    pkgs = ['micropip'] if a.no_packages else a.packages
    if 'micropip' not in pkgs:
        pkgs.append('micropip')

    jobs = []            # (relative path, url)
    for rel, url in STATIC.items():
        jobs.append((rel, url))

    # fonts: rewrite the Google Fonts css to point at local woff2 files
    css = get(FONT_CSS, binary=False)
    font_css, n = [], 0
    def repl(m):
        nonlocal n
        n += 1
        fname = 'fonts/f%02d.woff2' % n
        jobs.append((fname, m.group(1)))
        return 'url(%s)' % ('../' + 'vendor/' + fname)
    font_css = re.sub(r'url\((https://[^)]+\.woff2)\)', repl, css)

    # pyodide core + chosen packages
    lock = json.loads(get(PYODIDE_CDN + 'pyodide-lock.json', binary=False))
    chosen = closure(lock, pkgs)
    files = list(PYODIDE_CORE)
    for k in chosen:
        files.append(lock['packages'][k]['file_name'])
    for f in files:
        jobs.append(('pyodide/' + f, PYODIDE_CDN + f))

    # wheels for the formatter
    wheel_files = []
    for w in WHEELS:
        fname, url = pypi_wheel(w)
        jobs.append(('wheels/' + fname, url))
        wheel_files.append(fname)

    total = 0
    for rel, url in jobs:
        total += head_size(url) if a.dry else 0
    if a.dry:
        print('%d files, about %s' % (len(jobs), human(total)))
        print('pyodide packages:', ', '.join(chosen))
        return

    done = 0
    for rel, url in jobs:
        dest = os.path.join(VENDOR, rel)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            done += 1
            continue
        try:
            data = get(url)
        except (urllib.error.URLError, OSError) as e:
            print('FAILED', rel, e)
            sys.exit(1)
        save(rel, data)
        done += 1
        print('[%d/%d] %s (%s)' % (done, len(jobs), rel, human(len(data))))

    save('../css/fonts.css', font_css.encode('utf-8'))
    cfg = {
        'pyodide': 'vendor/pyodide/',
        'wheels': ['vendor/wheels/' + w for w in wheel_files],
        'version': PYODIDE_VERSION,
        'packages': chosen,
    }
    save('config.js', ('window.PYLENS_VENDOR = ' + json.dumps(cfg, indent=2) + ';\n').encode('utf-8'))
    print('done. vendor/config.js written; css/fonts.css written')


if __name__ == '__main__':
    main()
