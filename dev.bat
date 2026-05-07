@echo off
setlocal EnableExtensions
title API Catalog Explorer — dev (Vite HMR + Bun API)

set "APP_ROOT=%~dp0"
if "%APP_ROOT:~-1%"=="\" set "APP_ROOT=%APP_ROOT:~0,-1%"

if not exist "%APP_ROOT%\bun.exe" (
  echo Bun runtime not found. Running first-time setup...
  call "%APP_ROOT%\setup.bat"
  if errorlevel 1 exit /b 1
)

rem Start the Bun API server on a fixed dev port in the background so Vite can proxy /api to it.
set "BUN_SERVER=http://localhost:5757"
set "PORT=5757"
start "API Catalog · Bun API" /min "%APP_ROOT%\bun.exe" run --watch server.ts

rem Vite dev server with HMR. Ctrl+C stops this; the backgrounded Bun server will close with it via taskkill on exit.
"%APP_ROOT%\bun.exe" run dev:web

rem cleanup: kill any lingering bun processes started by this script
taskkill /F /FI "WINDOWTITLE eq API Catalog · Bun API" >nul 2>nul

endlocal
