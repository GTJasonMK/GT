@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0\.."

echo ========================================
echo   GraphAndTable Dev Server
echo ========================================
echo.

echo [1/3] Cleaning up old processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :1420 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=2" %%a in ('tasklist ^| findstr /i "GraphAndTable"') do (
    taskkill /F /PID %%a >nul 2>&1
)
echo      OK

if not exist "node_modules" (
    echo [2/3] Installing dependencies...
    call npm.cmd install
    if !ERRORLEVEL! neq 0 (
        echo Error: npm install failed
        pause
        exit /b 1
    )
) else (
    echo [2/3] Dependencies OK
)

echo [3/3] Starting Tauri dev server...
echo.
echo ----------------------------------------
echo   Press Ctrl+C to stop
echo ----------------------------------------
echo.

call npm.cmd run tauri dev

echo.
echo Cleaning up...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :1420 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)
echo Server stopped.
pause
