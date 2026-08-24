@echo off
setlocal EnableDelayedExpansion
title osu! Map Editor Fast Packager

rem ============================================================
rem  osu! Map Editor FAST packager (skip-download edition)
rem  - no npm install / Electron binary checks - run the full
rem    packager bat once first so deps + caches exist
rem  - electron-builder uses node_modules\electron\dist directly
rem    (-c.electronDist), skipping the Electron zip download;
rem    winCodeSign/NSIS come from the local electron-builder cache
rem  - build staged in a short ASCII dir: electron-builder EPERM
rem    on paths containing '!' or non-ASCII chars; result copied
rem    back to release\
rem  - usage: double-click, or pass a custom stage dir as %1
rem  - NOTE: keep this file pure ASCII - cmd reads .bat in the
rem    system ANSI codepage, UTF-8 Chinese breaks parsing
rem ============================================================

set "STAGE=%~1"
if "%STAGE%"=="" set "STAGE=%TEMP%\osu-editor-eb"

cd /d "%~dp0" 2>nul

if not exist node_modules\electron\dist\electron.exe (
  echo [ERR] dependencies missing. Run the full packager bat once first.
  pause
  exit /b 1
)

echo [..] building frontend...
call npm run build
if errorlevel 1 (echo [ERR] build failed & pause & exit /b 1)

echo [..] packaging portable exe (stage dir: %STAGE%)...
if exist "%STAGE%" rmdir /s /q "%STAGE%"
set "RETRY=0"
:eb_retry
call npx electron-builder --win portable -c.directories.output="%STAGE%" -c.electronDist=node_modules\electron\dist
if not errorlevel 1 goto eb_ok
set /a RETRY+=1
if !RETRY! geq 3 (echo [ERR] electron-builder failed after 3 attempts & pause & exit /b 1)
echo [..] electron-builder failed, retrying in 5s... ^(attempt !RETRY!/3^)
timeout /t 5 /nobreak >nul
goto eb_retry
:eb_ok

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
