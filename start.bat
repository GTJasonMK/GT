@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "REPO_ROOT=%~dp0"
pushd "%REPO_ROOT%" >nul

call :require_cmd node "Node.js" || goto :fail
call :require_cmd npm "npm" || goto :fail
call :require_cmd powershell "PowerShell" || goto :fail

set "EXIT_CODE=1"
set "TMP_DIR=%REPO_ROOT%.tmp"
set "TAURI_CONFIG="
set "VITE_DEV_PID="
set "VITE_DEV_LOG_OUT="
set "VITE_DEV_LOG_ERR="

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

call :find_free_port DEV_PORT || goto :fail
call :find_free_port HMR_PORT || goto :fail
if "!HMR_PORT!"=="!DEV_PORT!" call :find_free_port HMR_PORT || goto :fail

set "PORT=!DEV_PORT!"
set "VITE_PORT=!DEV_PORT!"
set "VITE_HMR_PORT=!HMR_PORT!"
set "DEV_URL=http://localhost:!DEV_PORT!"

echo [INFO] Using port !DEV_PORT! (HMR !HMR_PORT!)

set "MODE=%~1"
if /i "!MODE!"=="web" (set "FORCE_WEB=1" & goto :start_web)
if /i "!MODE!"=="app" goto :start_app

if exist "src-tauri\\tauri.conf.json" (
  where cargo >nul 2>nul
  if not errorlevel 1 goto :start_app
)

:start_web
if defined FORCE_WEB (
  echo [INFO] Starting web dev server.
) else (
  echo [WARN] Rust toolchain not found. Starting web dev server only.
)
call npm run dev -- --port !DEV_PORT! --strictPort
set "EXIT_CODE=%ERRORLEVEL%"
goto :cleanup

:start_app
if not exist "src-tauri\\tauri.conf.json" (
  echo [ERROR] src-tauri\\tauri.conf.json not found; cannot start desktop app.
  goto :fail
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo [ERROR] cargo not found in PATH; install Rust toolchain, or run: start.bat web
  goto :fail
)
call :run_tauri_dev
set "EXIT_CODE=!ERRORLEVEL!"
goto :cleanup

:require_cmd
where %~1 >nul 2>nul
if errorlevel 1 (
  echo [ERROR] %~2 not found in PATH.
  exit /b 1
)
exit /b 0

:find_free_port
set "%~1="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$l=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0); $l.Start(); $p=($l.LocalEndpoint).Port; $l.Stop(); $p"`) do set "%~1=%%P"
if not defined %~1 (
  echo [ERROR] Failed to determine a free TCP port.
  exit /b 1
)
exit /b 0

:run_tauri_dev
if not exist "!TMP_DIR!\\" mkdir "!TMP_DIR!" >nul 2>nul
del /f /q "!TMP_DIR!\\tauri.conf.dev.*.json" >nul 2>nul

set "TAURI_CONFIG=!TMP_DIR!\\tauri.conf.dev.!RANDOM!.json"

echo [INFO] Starting web dev server in background...
call :start_vite_dev_background || exit /b 1
call :wait_for_port !DEV_PORT! 60000 !VITE_DEV_PID! "!VITE_DEV_LOG_OUT!" "!VITE_DEV_LOG_ERR!" || exit /b 1
echo [INFO] Web dev server is ready: !DEV_URL!

echo [INFO] Preparing Tauri config: !TAURI_CONFIG!
node -e "const fs=require('fs');const inPath=process.argv[1];const outPath=process.argv[2];const devUrl=process.argv[3];const conf=JSON.parse(fs.readFileSync(inPath,'utf8'));conf.build=conf.build||{};conf.build.devUrl=devUrl;delete conf.build.beforeDevCommand;fs.writeFileSync(outPath, JSON.stringify(conf,null,2));" "src-tauri\\tauri.conf.json" "!TAURI_CONFIG!" "!DEV_URL!"

if errorlevel 1 (
  echo [ERROR] Failed to write temporary Tauri config.
  exit /b 1
)

echo [INFO] Starting Tauri dev (frontend: !DEV_URL!)
call npm run tauri -- dev --config "!TAURI_CONFIG!"
exit /b %ERRORLEVEL%

:start_vite_dev_background
set "VITE_DEV_PID="
set "VITE_DEV_LOG_OUT=!TMP_DIR!\\vite.dev.!DEV_PORT!.out.log"
set "VITE_DEV_LOG_ERR=!TMP_DIR!\\vite.dev.!DEV_PORT!.err.log"
del /f /q "!VITE_DEV_LOG_OUT!" >nul 2>nul
del /f /q "!VITE_DEV_LOG_ERR!" >nul 2>nul
echo [INFO] Vite log: !VITE_DEV_LOG_OUT! ^(stderr: !VITE_DEV_LOG_ERR!^)
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$out=$env:VITE_DEV_LOG_OUT; $err=$env:VITE_DEV_LOG_ERR; $args=@('/c','npm','run','dev','--','--port',$env:DEV_PORT,'--strictPort'); $p=Start-Process -FilePath cmd.exe -ArgumentList $args -WorkingDirectory '%REPO_ROOT%' -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err; $p.Id"`) do set "VITE_DEV_PID=%%P"
if not defined VITE_DEV_PID (
  echo [ERROR] Failed to start Vite dev server.
  exit /b 1
)
echo [INFO] Vite PID: !VITE_DEV_PID!
exit /b 0

:wait_for_port
set "WAIT_PORT=%~1"
set "WAIT_TIMEOUT_MS=%~2"
set "WAIT_PID=%~3"
set "WAIT_LOG_OUT=%~4"
set "WAIT_LOG_ERR=%~5"
echo [INFO] Waiting for web dev server on port %WAIT_PORT% (timeout %WAIT_TIMEOUT_MS%ms)...
powershell -NoProfile -Command "$port=[int]$env:WAIT_PORT; $timeout=[int]$env:WAIT_TIMEOUT_MS; $pidText=$env:WAIT_PID; $pid=0; if($pidText){ [void][int]::TryParse($pidText,[ref]$pid) }; $out=$env:WAIT_LOG_OUT; $hosts=@('localhost','127.0.0.1','::1'); $deadline=(Get-Date).AddMilliseconds($timeout); $portRegex=[regex]::Escape($port.ToString()); while((Get-Date) -lt $deadline){ if($pid -gt 0){ if(-not (Get-Process -Id $pid -ErrorAction SilentlyContinue)){ exit 2 } }; try { if(netstat -ano -p tcp | Select-String -Pattern (':'+$portRegex+'\s+.*LISTENING') -Quiet){ exit 0 } } catch {}; if($out -and (Test-Path -LiteralPath $out)){ if(Select-String -LiteralPath $out -Pattern ('localhost:.*'+$portRegex) -Quiet -ErrorAction SilentlyContinue){ exit 0 }; if(Select-String -LiteralPath $out -Pattern ('127\.0\.0\.1:.*'+$portRegex) -Quiet -ErrorAction SilentlyContinue){ exit 0 }; if(Select-String -LiteralPath $out -Pattern ('ready in') -Quiet -ErrorAction SilentlyContinue){ exit 0 } }; foreach($h in $hosts){ try { $c=New-Object System.Net.Sockets.TcpClient($h,$port); $c.Close(); exit 0 } catch {} }; Start-Sleep -Milliseconds 250 } exit 1"
if errorlevel 2 (
  echo [ERROR] Web dev server process exited before becoming ready.
  call :print_tail "!VITE_DEV_LOG_OUT!" 80
  call :print_tail "!VITE_DEV_LOG_ERR!" 80
  exit /b 1
)
if errorlevel 1 (
  echo [ERROR] Web dev server did not become ready on port %WAIT_PORT% within %WAIT_TIMEOUT_MS%ms.
  call :print_tail "!VITE_DEV_LOG_OUT!" 80
  call :print_tail "!VITE_DEV_LOG_ERR!" 80
  exit /b 1
)
exit /b 0

:print_tail
set "TAIL_FILE=%~1"
set "TAIL_LINES=%~2"
if not defined TAIL_LINES set "TAIL_LINES=80"
if not defined TAIL_FILE exit /b 0
if not exist "%TAIL_FILE%" exit /b 0
echo [INFO] --- Vite log tail (%TAIL_LINES% lines) ---
powershell -NoProfile -Command "Get-Content -LiteralPath $env:TAIL_FILE -Tail ([int]$env:TAIL_LINES)"
echo [INFO] --- end ---
exit /b 0

:cleanup
if defined TAURI_CONFIG del /f /q "!TAURI_CONFIG!" >nul 2>nul
if defined VITE_DEV_PID taskkill /PID !VITE_DEV_PID! /T /F >nul 2>nul
del /f /q "!TMP_DIR!\\tauri.conf.dev.*.json" >nul 2>nul
if exist "!TMP_DIR!\\" (
  if "!EXIT_CODE!"=="0" (
    del /f /q "!TMP_DIR!\\vite.dev.*.out.log" >nul 2>nul
    del /f /q "!TMP_DIR!\\vite.dev.*.err.log" >nul 2>nul
    rmdir "!TMP_DIR!" >nul 2>nul
  ) else (
    echo [INFO] Keeping logs under !TMP_DIR! for troubleshooting.
  )
)
popd >nul
exit /b !EXIT_CODE!

:fail
echo [ERROR] Start failed.
goto :cleanup
