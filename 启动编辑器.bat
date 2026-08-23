@echo off
setlocal EnableDelayedExpansion
title osu! Map Editor Launcher

rem ============================================================
rem  osu! Map Editor launcher
rem  - starts the dev server on port 7100 if not already running
rem  - opens Edge/Chrome (full File System Access API support,
rem    directory picker works, no embedded-webview SecurityError)
rem  - keep the URL http://localhost:7100/ unchanged: saved
rem    songs/skin directory handles are bound to this origin
rem ============================================================

set PORT=7100
set URL=http://localhost:%PORT%/

cd /d "%~dp0" 2>nul

rem ---- 1) server already running? just open the browser ----
curl -s -o nul --max-time 2 %URL%
if !errorlevel!==0 (
  echo [OK] dev server already running at %URL%
  goto :open
)

rem ---- 2) start dev server (minimized window; closing it stops the server) ----
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERR] npm not found. Please install Node.js first: https://nodejs.org/
  pause
  exit /b 1
)

if not exist node_modules (
  echo [..] first run, installing dependencies...
  call npm install
  if errorlevel 1 (echo [ERR] npm install failed & pause & exit /b 1)
)

echo [..] starting dev server, please wait...
start "osu-editor-dev (close this window to stop the server)" /min cmd /c "npm run dev -- --port %PORT% --strictPort"

rem ---- 3) wait until server is ready (up to 60s) ----
set /a TRIES=0
:wait
curl -s -o nul --max-time 2 %URL%
if !errorlevel!==0 goto :ready
set /a TRIES+=1
if !TRIES! geq 30 (
  echo [ERR] server not ready within 60s. Check the minimized osu-editor-dev window for errors.
  pause
  exit /b 1
)
timeout /t 2 /nobreak >nul 2>&1 || ping 127.0.0.1 -n 3 >nul
goto :wait

:ready
echo [OK] dev server is ready

:open
rem prefer Edge, then Chrome, then default browser
set "EDGE1=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
set "EDGE2=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
set "CHROME1=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "CHROME2=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

if exist "%EDGE1%" (start "" "%EDGE1%" %URL% & goto :done)
if exist "%EDGE2%" (start "" "%EDGE2%" %URL% & goto :done)
if exist "%CHROME1%" (start "" "%CHROME1%" %URL% & goto :done)
if exist "%CHROME2%" (start "" "%CHROME2%" %URL% & goto :done)
echo [WARN] Edge/Chrome not found, using default browser (must support File System Access API)
start "" %URL%

:done
echo.
echo Notes:
echo  1. In the browser, pick your Songs/skin folder ONE more time (the memory
echo     saved inside the embedded webview cannot be carried over; each browser
echo     stores it separately). It will auto-restore from then on.
echo  2. Always launch via this script and keep %URL% unchanged.
echo  3. The minimized osu-editor-dev window is the server; closing it stops the editor.
endlocal
