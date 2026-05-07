@echo off
setlocal EnableExtensions

rem Download the portable Bun Windows runtime into the app folder as bun.exe.
rem One-time download (~30 MB). Safe to re-run; will overwrite an existing bun.exe.

set "APP_ROOT=%~dp0"
if "%APP_ROOT:~-1%"=="\" set "APP_ROOT=%APP_ROOT:~0,-1%"

set "BUN_URL=https://github.com/oven-sh/bun/releases/latest/download/bun-windows-x64.zip"
set "DOWNLOAD_ZIP=%TEMP%\bun-windows-x64-%RANDOM%.zip"
set "EXTRACT_DIR=%TEMP%\bun-install-%RANDOM%"

echo Downloading Bun runtime from:
echo   %BUN_URL%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri '%BUN_URL%' -OutFile '%DOWNLOAD_ZIP%' -UseBasicParsing } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
  echo Download failed. Check your network / proxy / IT policy.
  exit /b 1
)

echo Extracting...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { Expand-Archive -Path '%DOWNLOAD_ZIP%' -DestinationPath '%EXTRACT_DIR%' -Force } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
  echo Extraction failed.
  exit /b 1
)

rem The zip contains a bun-windows-x64\bun.exe layout.
if exist "%EXTRACT_DIR%\bun-windows-x64\bun.exe" (
  copy /Y "%EXTRACT_DIR%\bun-windows-x64\bun.exe" "%APP_ROOT%\bun.exe" >nul
) else (
  rem Some zip packagings use a flatter structure; try a recursive copy of any bun.exe we find.
  for /r "%EXTRACT_DIR%" %%F in (bun.exe) do (
    copy /Y "%%F" "%APP_ROOT%\bun.exe" >nul
    goto :copied
  )
  echo Could not locate bun.exe in the extracted archive.
  exit /b 1
)

:copied
del "%DOWNLOAD_ZIP%" 2>nul
rmdir /s /q "%EXTRACT_DIR%" 2>nul

if not exist "%APP_ROOT%\bun.exe" (
  echo Install completed but bun.exe is missing. Investigate.
  exit /b 1
)

echo.
echo Bun runtime installed at:
echo   %APP_ROOT%\bun.exe
echo.
"%APP_ROOT%\bun.exe" --version

endlocal
