@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "REPO_ROOT=%~dp0"
pushd "%REPO_ROOT%" >nul

call :require_cmd node "Node.js" || goto :fail
call :require_cmd npm "npm" || goto :fail

set "MODE="
set "CLEAN="
for %%A in (%*) do (
  if /i "%%~A"=="web" set "MODE=web"
  if /i "%%~A"=="app" set "MODE=app"
  if /i "%%~A"=="all" set "MODE=app"
  if /i "%%~A"=="clean" set "CLEAN=1"
  if /i "%%~A"=="-h" goto :help
  if /i "%%~A"=="--help" goto :help
  if /i "%%~A"=="/?" goto :help
)
if not defined MODE set "MODE=app"

set "EXIT_CODE=1"

call :cleanup_temp

if defined CLEAN (
  echo [INFO] Cleaning build outputs...
  if exist "dist\\" rmdir /s /q "dist" >nul 2>nul
  if exist "src-tauri\\target\\release\\bundle\\" rmdir /s /q "src-tauri\\target\\release\\bundle" >nul 2>nul
)

if not exist ".venv\\Scripts\\activate.bat" (
  echo [INFO] .venv not found. Running install.bat first...
  call "%REPO_ROOT%install.bat" || goto :fail
)

call ".venv\\Scripts\\activate.bat" || goto :fail

uv --version >nul 2>nul
if errorlevel 1 (
  echo [INFO] uv not found in venv. Installing...
  python -m pip install --upgrade uv || goto :fail
)

if not exist "node_modules\\" (
  echo [INFO] node_modules not found. Installing Node dependencies...
  if exist "package-lock.json" (
    call npm ci
    if errorlevel 1 (
      echo [WARN] npm ci failed; falling back to npm install
      call npm install || goto :fail
    )
  ) else (
    call npm install || goto :fail
  )
)

if /i "%MODE%"=="web" (
  echo [INFO] Building web assets (dist/)...
  call npm run build || goto :fail
  echo [OK] Web build complete: dist\\
  set "EXIT_CODE=0"
  goto :cleanup
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo [ERROR] cargo not found in PATH; install Rust toolchain, or run: build.bat web
  goto :fail
)

if not exist "src-tauri\\tauri.conf.json" (
  echo [ERROR] src-tauri\\tauri.conf.json not found; cannot build desktop app.
  goto :fail
)

echo [INFO] Building desktop bundle (Tauri)...
call npm run build:app || goto :fail

echo [OK] App build complete. Output is under: src-tauri\\target\\release\\bundle\\
set "EXIT_CODE=0"
goto :cleanup

:cleanup_temp
del /f /q "src-tauri\\tauri.conf.dev.*.json" >nul 2>nul
del /f /q ".tmp\\tauri.conf.dev.*.json" >nul 2>nul
if exist ".tmp\\" rmdir ".tmp" >nul 2>nul
exit /b 0

:require_cmd
where %~1 >nul 2>nul
if errorlevel 1 (
  echo [ERROR] %~2 not found in PATH.
  exit /b 1
)
exit /b 0

:help
echo Usage:
echo   build.bat [web^|app^|all] [clean]
echo.
echo Examples:
echo   build.bat app
echo   build.bat web
echo   build.bat app clean
set "EXIT_CODE=0"
goto :cleanup

:cleanup
call :cleanup_temp
popd >nul
exit /b %EXIT_CODE%

:fail
echo [ERROR] Build failed.
goto :cleanup

