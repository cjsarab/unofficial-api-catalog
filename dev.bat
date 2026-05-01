@echo off
setlocal EnableExtensions
title API Catalog Explorer dev (Vite HMR + Node API)

set "APP_ROOT=%~dp0"
if "%APP_ROOT:~-1%"=="\" set "APP_ROOT=%APP_ROOT:~0,-1%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH. Install Node 22.5+ from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

if not exist "%APP_ROOT%\node_modules" (
  echo node_modules missing. Running npm install...
  pushd "%APP_ROOT%"
  call npm install
  popd
  if errorlevel 1 exit /b 1
)

pushd "%APP_ROOT%"
call npm run dev
popd

endlocal
