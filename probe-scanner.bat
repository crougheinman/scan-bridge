@echo off
REM ===== Magic Ops Scan Bridge - test the scanner connection =====
cd /d "%~dp0"
title Scan Bridge - Scanner Test

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js is not installed. Install it from https://nodejs.org first.
  pause
  exit /b 1
)

if not exist ".env" (
  echo [X] Settings file ".env" not found. Copy ".env.example" to ".env" first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing components, please wait...
  call npm install
)

echo.
echo Testing the scanner... look for the line that starts with "Scanner:".
echo.
node index.js --probe

echo.
echo   reachable=true escl=true   -^> scanner is ready, you can use Start.
echo   reachable=false            -^> PC cannot see the scanner; check it is on / its IP.
echo   reachable=true escl=false  -^> scanner does not support network scan; tell the office.
echo.
pause
