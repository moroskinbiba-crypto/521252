@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_CMD="
where py >nul 2>&1
if not errorlevel 1 (
  py -3 --version >nul 2>&1
  if not errorlevel 1 set "PYTHON_CMD=py -3"
)
if not defined PYTHON_CMD (
  where python >nul 2>&1
  if not errorlevel 1 (
    python --version >nul 2>&1
    if not errorlevel 1 set "PYTHON_CMD=python"
  )
)
if not defined PYTHON_CMD goto :fallback

%PYTHON_CMD% -c "import socket,sys;s=socket.socket();s.settimeout(.25);r=s.connect_ex(('127.0.0.1',8765));s.close();sys.exit(0 if r==0 else 1)" >nul 2>&1
if not errorlevel 1 goto :port_busy

start "TGRMLither Local Server" /min "%ComSpec%" /k "cd /d ""%~dp0"" && %PYTHON_CMD% -m http.server 8765 --bind 127.0.0.1"
set "WAIT_ATTEMPT=0"

:wait
%PYTHON_CMD% -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/',timeout=0.5).read(1)" >nul 2>&1
if not errorlevel 1 goto :ready
set /a WAIT_ATTEMPT+=1
if %WAIT_ATTEMPT% geq 20 goto :server_failed
timeout /t 1 /nobreak >nul
goto :wait

:ready
start "" "http://127.0.0.1:8765/"
echo TGRMLither is running in your browser.
echo Close the minimized "TGRMLither Local Server" window to stop the local server.
exit /b 0

:port_busy
echo Port 8765 is already in use. Close the other local server and try again.
pause
exit /b 1

:server_failed
echo The local server did not respond on port 8765. Check whether the port is available.
pause
exit /b 1

:fallback
echo Python 3 was not found. Opening the app directly instead.
echo Some browser storage and offline features may be limited when opening a file URL.
start "" "%~dp0index.html"
pause
exit /b 0
