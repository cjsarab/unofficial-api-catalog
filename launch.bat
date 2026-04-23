@echo off
setlocal EnableExtensions
title API Catalog Explorer

rem Resolve the folder this launcher lives in (handles spaces in paths)
set "APP_ROOT=%~dp0"
if "%APP_ROOT:~-1%"=="\" set "APP_ROOT=%APP_ROOT:~0,-1%"

rem Ensure Bun runtime is present; call setup if not
if not exist "%APP_ROOT%\bun.exe" (
  echo.
  echo Bun runtime not found. Running first-time setup...
  echo.
  call "%APP_ROOT%\setup.bat"
  if errorlevel 1 (
    echo.
    echo Setup failed. See error above. Press any key to close.
    pause >nul
    exit /b 1
  )
)

rem Run the server. Ctrl+C in this window stops it.
"%APP_ROOT%\bun.exe" run "%APP_ROOT%\server.ts"

endlocal
