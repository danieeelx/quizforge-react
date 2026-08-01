@echo off
setlocal
cd /d "%~dp0"
title QuizForge React

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  echo Download it from the official Node.js website, then run this file again.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo The built app is missing. Installing dependencies and building QuizForge...
  call npm install
  if errorlevel 1 goto :failed
  call npm run build
  if errorlevel 1 goto :failed
)

start "" "http://127.0.0.1:4173"
node server.mjs
exit /b 0

:failed
echo.
echo QuizForge could not be prepared. Review the error above.
pause
exit /b 1
