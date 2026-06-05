@echo off
REM ===== Magic Ops Scan Bridge - one-click start =====
cd /d "%~dp0"
title Scan Bridge

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [X] Node.js is not installed. Install it from https://nodejs.org (LTS version),
  echo     then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo.
  echo [X] Settings file ".env" not found.
  echo     Copy ".env.example" to ".env" and fill it in, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run - installing components, please wait...
  call npm install
  if errorlevel 1 (
    echo.
    echo [X] Install failed. Check your internet connection and try again.
    echo.
    pause
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
pause
