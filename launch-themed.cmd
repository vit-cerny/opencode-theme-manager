@echo off
rem OpenCode Theme Manager - start the desktop app with the theme pushed to it every time.
rem
rem The theme itself is stored in the app's localStorage (read at startup), so the colours already
rem survive a restart. This launcher adds the part that needs the DevTools port: re-pushing the
rem current CSS. Window backdrop is deliberately NOT applied here - it was measured to have no visible
rem effect on this app's window (see README, "Transparency: what each client can really do").
rem
rem   launch-themed.cmd          start (or reuse) the app with DevTools and push the current theme
setlocal
cd /d "%~dp0"

set EXE=%LOCALAPPDATA%\Programs\@opencode-aidesktop\OpenCode.exe
if not exist "%EXE%" (
  echo Could not find "%EXE%"
  exit /b 1
)

tasklist /FI "IMAGENAME eq OpenCode.exe" /NH | find /i "OpenCode.exe" >nul
if errorlevel 1 (
  echo starting opencode desktop app with DevTools on port 9222...
  start "" "%EXE%" --remote-debugging-port=9222
  timeout /t 12 /nobreak >nul
) else (
  echo opencode desktop app is already running
)

echo pushing the current theme to it...
node "%~dp0tools\desktop-apply.mjs" --glass

echo done. For the terminal client, transparency comes from Windows Terminal (panel 4 of the manager).
endlocal
