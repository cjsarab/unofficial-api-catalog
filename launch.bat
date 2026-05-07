@echo off
setlocal EnableExtensions
title API Catalog Explorer

rem Resolve the folder this launcher lives in (handles spaces in paths)
set "APP_ROOT=%~dp0"
if "%APP_ROOT:~-1%"=="\" set "APP_ROOT=%APP_ROOT:~0,-1%"

rem Ensure Node + npm are on PATH
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found on PATH. Install Node 22.5+ from https://nodejs.org/ and try again.
  echo.
  pause
  exit /b 1
)

rem Install deps if node_modules is missing
if not exist "%APP_ROOT%\node_modules" (
  echo.
  echo node_modules missing. Running npm install...
  echo.
  pushd "%APP_ROOT%"
  call npm install
  popd
  if errorlevel 1 (
    echo.
    echo npm install failed. See error above. Press any key to close.
    pause >nul
    exit /b 1
  )
)

rem Run the server. Ctrl+C in this window stops it.
pushd "%APP_ROOT%"
call npm run start
popd

endlocal
