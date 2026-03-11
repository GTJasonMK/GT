@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "REPO_ROOT=%~dp0"
pushd "%REPO_ROOT%" >nul

call :require_cmd node "Node.js" || goto :fail
call :require_cmd npm "npm" || goto :fail
call :find_python || goto :fail

if not exist ".venv\\Scripts\\activate.bat" (
  echo [INFO] Creating Python virtual environment: .venv
  %PYTHON_CMD% -m venv .venv || goto :fail
)

call ".venv\\Scripts\\activate.bat" || goto :fail

echo [INFO] Installing/updating uv in the virtual environment
python -m pip install --upgrade pip >nul || goto :fail
python -m pip install --upgrade uv || goto :fail

uv --version >nul 2>nul || goto :fail
uv pip install --upgrade pip setuptools wheel || goto :fail

if exist "package-lock.json" (
  echo [INFO] Installing Node dependencies (npm ci)
  call npm ci
  if errorlevel 1 (
    echo [WARN] npm ci failed; falling back to npm install
    call npm install || goto :fail
  )
) else (
  echo [INFO] Installing Node dependencies (npm install)
  call npm install || goto :fail
)

echo [OK] Dependencies installed.
popd >nul
exit /b 0

:require_cmd
where %~1 >nul 2>nul
if errorlevel 1 (
  echo [ERROR] %~2 not found in PATH.
  exit /b 1
)
exit /b 0

:find_python
set "PYTHON_CMD="
where py >nul 2>nul
if not errorlevel 1 (
  set "PYTHON_CMD=py -3"
  exit /b 0
)
where python >nul 2>nul
if not errorlevel 1 (
  set "PYTHON_CMD=python"
  exit /b 0
)
echo [ERROR] Python not found. Install Python 3 (and enable the "py" launcher) then re-run install.bat.
exit /b 1

:fail
echo [ERROR] Install failed.
popd >nul
exit /b 1

