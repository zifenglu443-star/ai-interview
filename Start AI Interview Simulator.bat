@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "FRONTEND_URL=http://127.0.0.1:3001/setup"
set "BACKEND_URL=http://127.0.0.1:8000/health"
set "LOG_DIR=%CD%\.runtime-logs"

where node >nul 2>nul || goto :missing_node
where npm >nul 2>nul || goto :missing_node
node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a^>20 ^|^| (a===20 ^&^& b^>=9) ? 0 : 1)" >nul 2>nul
if %ERRORLEVEL% NEQ 0 goto :outdated_node

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  set "PY_CMD=py -3"
) else (
  where python >nul 2>nul || goto :missing_python
  set "PY_CMD=python"
)

if not exist ".env" (
  copy /Y ".env.example" ".env" >nul || goto :failed
  echo Created local .env configuration file.
)

if not exist ".venv\Scripts\python.exe" (
  echo First launch: creating the Python environment...
  %PY_CMD% -m venv .venv || goto :failed
)

set "PYTHON=%CD%\.venv\Scripts\python.exe"
"%PYTHON%" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if %ERRORLEVEL% NEQ 0 goto :outdated_python
"%PYTHON%" -c "import fastapi, uvicorn, dotenv, websockets" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo First launch: installing Python dependencies...
  "%PYTHON%" -m pip install -r backend\requirements.txt || goto :failed
)

if not exist "frontend\node_modules" (
  echo First launch: installing frontend dependencies...
  call npm --prefix frontend ci || goto :failed
)

powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%BACKEND_URL%' ^| Out-Null; Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%FRONTEND_URL%' ^| Out-Null; exit 0 } catch { exit 1 }"
if %ERRORLEVEL% EQU 0 (
  start "" "%FRONTEND_URL%"
  exit /b 0
)

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
echo Building the interface. The first build may take a few minutes...
call npm --prefix frontend run build || goto :failed

echo Starting AI Interview Simulator...
start "AI Interview Backend" /min cmd /c ""%PYTHON%" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 1^>"%LOG_DIR%\backend.log" 2^>^&1"
start "AI Interview Frontend" /min cmd /c "npm --prefix frontend run start -- --hostname 127.0.0.1 --port 3001 1^>"%LOG_DIR%\frontend.log" 2^>^&1"

for /L %%I in (1,1,120) do (
  powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%BACKEND_URL%' ^| Out-Null; Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%FRONTEND_URL%' ^| Out-Null; exit 0 } catch { exit 1 }"
  if not errorlevel 1 goto :ready
  timeout /t 1 /nobreak >nul
)

echo.
echo Startup timed out. Check logs in:
echo %LOG_DIR%
pause
exit /b 1

:ready
start "" "%FRONTEND_URL%"
exit /b 0

:missing_node
echo Node.js was not found. Install Node.js 20.9 or newer from https://nodejs.org/
pause
exit /b 1

:missing_python
echo Python 3 was not found. Install Python 3.10 or newer from https://www.python.org/downloads/
pause
exit /b 1

:outdated_node
echo Node.js is too old. Install Node.js 20.9 or newer from https://nodejs.org/
pause
exit /b 1

:outdated_python
echo Python is too old. Install Python 3.10 or newer from https://www.python.org/downloads/
pause
exit /b 1

:failed
echo.
echo Setup or startup failed. Check your network connection and try again.
pause
exit /b 1
