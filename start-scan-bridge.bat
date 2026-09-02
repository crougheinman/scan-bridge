@echo off
REM ===== Magic Ops Scan Bridge - one-click start =====
REM Pass /auto (used by the scheduled task) to skip the "pause" prompts so the
REM task can relaunch the bridge cleanly if the window is ever closed.
cd /d "%~dp0"
title Scan Bridge

set "AUTO="
if /I "%~1"=="/auto" set "AUTO=1"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [X] Node.js is not installed. Install the LTS version from https://nodejs.org,
  echo     then run this file again.
  echo.
  if not defined AUTO pause
  exit /b 1
)

if not exist ".env" (
  echo.
  echo [X] Settings file ".env" not found.
  echo     Copy ".env.example" to ".env" and fill it in, then run this file again.
  echo.
  if not defined AUTO pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run - installing components, please wait...
  call npm install
  if errorlevel 1 (
    echo.
    echo [X] Install failed. Check your internet connection and try again.
    echo.
    if not defined AUTO pause
    exit /b 1
  )
)

echo.
echo Starting Scan Bridge... leave this window open.
echo (Close this window to stop scanning.)
echo.
node index.js

echo.
echo Scan Bridge stopped.
if not defined AUTO pause
