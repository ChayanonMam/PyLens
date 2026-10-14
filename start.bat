@echo off
rem Starts a tiny local web server for PyLens and opens it in the default browser.
cd /d "%~dp0"
set PORT=8765
where python >nul 2>nul
if %errorlevel%==0 (set PY=python) else (set PY=py)
start "" http://localhost:%PORT%/index.html
echo PyLens is running at http://localhost:%PORT%/index.html
echo Close this window to stop the server.
%PY% -m http.server %PORT%
