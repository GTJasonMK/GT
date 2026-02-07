@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0\.."

echo ========================================
echo   GraphAndTable Production Build
echo ========================================
echo.

if not exist "node_modules\@tauri-apps\cli\tauri.js" (
    echo [1/3] Installing dependencies - missing Tauri CLI...
    call npm.cmd install
    if !ERRORLEVEL! neq 0 (
        echo Error: npm install failed
        pause
        exit /b 1
    )
) else (
    echo [1/3] Dependencies OK
)

echo [2/3] Building frontend...
call npm.cmd run build
if !ERRORLEVEL! neq 0 (
    echo Error: Frontend build failed
    pause
    exit /b 1
)

if defined GAT_PROXY_URL (
    set "HTTP_PROXY=%GAT_PROXY_URL%"
    set "HTTPS_PROXY=%GAT_PROXY_URL%"
    echo [3/3] Building Tauri app with proxy %GAT_PROXY_URL%...
) else (
    set "HTTP_PROXY="
    set "HTTPS_PROXY="
    set "ALL_PROXY="
    set "http_proxy="
    set "https_proxy="
    set "all_proxy="
    echo [3/3] Building Tauri app - proxy disabled...
)

call npm.cmd run tauri -- build
if !ERRORLEVEL! neq 0 (
    echo Error: Tauri build failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Build Success!
echo ========================================
echo.
echo Output: src-tauri\target\release\bundle
echo.
pause
