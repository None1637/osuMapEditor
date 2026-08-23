@echo off
setlocal EnableDelayedExpansion
title osu! Map Editor Packager

rem ============================================================
rem  osu! Map Editor packager
rem  - npm install (first run) + Electron binary check
rem  - vite build -> electron-builder portable exe
rem  - build staged in a short ASCII dir: electron-builder EPERM
rem    on paths containing '!' or non-ASCII chars (see
rem    DEVELOPMENT.md section 8); result copied back to release\
rem  - usage: double-click, or pass a custom stage dir as %1
rem ============================================================

set "STAGE=%~1"
if "%STAGE%"=="" set "STAGE=%TEMP%\osu-editor-eb"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

cd /d "%~dp0" 2>nul

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

rem Electron binary may be missing if the postinstall download failed
if not exist node_modules\electron\dist\electron.exe (
  echo [..] downloading Electron binary via mirror...
  node node_modules\electron\install.js
  if errorlevel 1 (echo [ERR] Electron binary download failed & pause & exit /b 1)
)

echo [..] building frontend...
call npm run build
if errorlevel 1 (echo [ERR] build failed & pause & exit /b 1)

echo [..] packaging portable exe (stage dir: %STAGE%)...
if exist "%STAGE%" rmdir /s /q "%STAGE%"
call npx electron-builder --win portable -c.directories.output="%STAGE%"
if errorlevel 1 (echo [ERR] electron-builder failed & pause & exit /b 1)

rem close running instances so the exe in release\ can be replaced
powershell -Command "Get-Process | Where-Object { $_.Name -like 'osu! Map Editor*' } | Stop-Process -Force" >nul 2>nul

if not exist release mkdir release
del /q release\*.exe 2>nul
rem NOTE: no "for %%f" copy here - delayed expansion eats the '!' in the exe name
xcopy "%STAGE%\*.exe" "release\" /Y /Q >nul
if errorlevel 1 (echo [ERR] copy from stage dir failed & pause & exit /b 1)
rmdir /s /q "%STAGE%" 2>nul

echo.
echo [OK] packaging done:
dir /b release\*.exe
endlocal
pause
