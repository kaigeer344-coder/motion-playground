@echo off
setlocal

cd /d "%~dp0"
set URL=http://127.0.0.1:5173/

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist node_modules (
  npm install
)

start "" /B powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 2; Start-Process '%URL%'"
npm run local

pause
