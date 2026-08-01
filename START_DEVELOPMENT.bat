@echo off
setlocal
cd /d "%~dp0"
title QuizForge React Development

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  pause
  exit /b 1
)

if not exist "node_modules\react\package.json" (
  echo Installing development dependencies...
  call npm install
  if errorlevel 1 goto :failed
)

call npm run dev
exit /b 0

:failed
echo.
echo QuizForge development setup failed. Review the error above.
pause
exit /b 1
