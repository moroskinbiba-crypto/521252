@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>&1
if not errorlevel 1 (
  start "TGRMLither Local Server" /min "%ComSpec%" /k "cd /d ""%~dp0"" && py -3 -m http.server 8765 --bind 127.0.0.1"
  goto :open
)

where python >nul 2>&1
if not errorlevel 1 (
  start "TGRMLither Local Server" /min "%ComSpec%" /k "cd /d ""%~dp0"" && python -m http.server 8765 --bind 127.0.0.1"
  goto :open
)

echo Python 3 was not found. Opening the app directly instead.
echo Some browser storage and offline features may be limited when opening a file URL.
start "" "%~dp0index.html"
pause
exit /b 0

:open
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8765/"
echo TGRMLither is running in your browser.
echo Close the minimized "TGRMLither Local Server" window to stop the local server.
