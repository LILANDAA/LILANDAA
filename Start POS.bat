@echo off
title Point of Sale
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org
  pause
  exit /b 1
)

echo Node.js found:
where node
node --version
echo.

rem Open the browser a few seconds after the server starts.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"

node --disable-warning=ExperimentalWarning src\server.js
echo.
echo The POS has stopped. Read the message above, then press any key to close.
pause >nul
