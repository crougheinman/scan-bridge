@echo off
REM ===== Magic Ops Scan Bridge - install auto-start =====
REM Creates a Windows Scheduled Task so the bridge starts automatically when you
REM log on AND restarts itself within ~5 minutes if the window is ever closed.
REM Just double-click it. Windows will ask for administrator approval once
REM (creating a scheduled task requires it); the bridge itself runs normally.
REM
REM To remove later: schtasks /Delete /TN "Magic Ops Scan Bridge" /F
title Scan Bridge - Install auto-start

REM --- Self-elevate (task creation needs admin); relaunch this file via UAC ---
net session >nul 2>&1
if %errorlevel% NEQ 0 (
  echo Requesting administrator approval...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
  exit /b
)

setlocal
cd /d "%~dp0"

REM Folder this script lives in (no trailing backslash) -> passed to PowerShell.
set "DIR=%~dp0"
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"
set "SCANBRIDGE_DIR=%DIR%"

if not exist "%DIR%\start-scan-bridge.bat" (
  echo [X] start-scan-bridge.bat was not found next to this file.
  echo     Run this from inside the unzipped scan-bridge folder.
  echo.
  pause
  exit /b 1
)

echo Creating the auto-start task "Magic Ops Scan Bridge"...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $dir=$env:SCANBRIDGE_DIR; $action=New-ScheduledTaskAction -Execute (Join-Path $dir 'start-scan-bridge.bat') -Argument '/auto' -WorkingDirectory $dir; $tl=New-ScheduledTaskTrigger -AtLogOn; $tr=New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650); $s=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 3 -ExecutionTimeLimit ([TimeSpan]::Zero); $p=New-ScheduledTaskPrincipal -UserId ('{0}\{1}' -f $env:USERDOMAIN,$env:USERNAME) -LogonType Interactive -RunLevel Limited; Register-ScheduledTask -TaskName 'Magic Ops Scan Bridge' -Action $action -Trigger $tl,$tr -Settings $s -Principal $p -Force | Out-Null; Start-ScheduledTask -TaskName 'Magic Ops Scan Bridge'"

if errorlevel 1 (
  echo.
  echo [X] Could not create the task. Try right-clicking this file and choosing
  echo     "Run as administrator".
  echo.
  pause
  exit /b 1
)

echo.
echo [OK] Done. The Scan Bridge will now:
echo      - start automatically every time you log on, and
echo      - restart itself within ~5 minutes if its window is closed.
echo.
echo It has also been started now - look for the "Scan Bridge" window.
echo (Make sure .env is set up first, or that window will show an error.)
echo.
pause
