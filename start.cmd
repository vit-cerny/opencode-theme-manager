@echo off
rem OpenCode Theme Manager - start.cmd
rem Double-click this, or run: start.cmd --port 4289 --no-open
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 18+ is required: https://nodejs.org & pause & exit /b 1)
node server.mjs %*
if errorlevel 1 pause
