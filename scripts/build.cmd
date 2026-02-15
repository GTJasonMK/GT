@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0\.."

echo ========================================
echo   GraphAndTable Production Build
echo ========================================
echo.

if not exist "node_modules\@tauri-apps\cli\tauri.js" (
    echo [1/3] Installing dependencies - missing Tauri CLI
    call npm.cmd install
    if !ERRORLEVEL! neq 0 (
        echo Error: npm install failed
        pause
        exit /b 1
    )
) else (
    echo [1/3] Dependencies OK
)

echo [2/3] Building frontend
call npm.cmd run build
if !ERRORLEVEL! neq 0 (
    echo Error: Frontend build failed
    pause
    exit /b 1
)

set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "http_proxy="
set "https_proxy="
set "all_proxy="
set "TAURI_BUNDLER_TOOLS_GITHUB_MIRROR="
set "TAURI_BUNDLER_TOOLS_GITHUB_MIRROR_TEMPLATE="

if defined GAT_PROXY_URL (
    set "HTTP_PROXY=%GAT_PROXY_URL%"
    set "HTTPS_PROXY=%GAT_PROXY_URL%"
    set "ALL_PROXY=%GAT_PROXY_URL%"
    echo [3/3] Proxy enabled: %GAT_PROXY_URL%
) else (
    echo [3/3] Proxy disabled
)

if defined GAT_GITHUB_MIRROR_TEMPLATE (
    set "TAURI_BUNDLER_TOOLS_GITHUB_MIRROR_TEMPLATE=%GAT_GITHUB_MIRROR_TEMPLATE%"
    echo [3/3] Tauri mirror template enabled
    echo       %GAT_GITHUB_MIRROR_TEMPLATE%
) else (
    if defined GAT_GITHUB_MIRROR (
        set "TAURI_BUNDLER_TOOLS_GITHUB_MIRROR=%GAT_GITHUB_MIRROR%"
        echo [3/3] Tauri mirror enabled
        echo       %GAT_GITHUB_MIRROR%
    ) else (
        echo [3/3] Tauri mirror disabled. Using direct GitHub download.
    )
)

echo [3/3] Building Tauri app
call npm.cmd run tauri -- build
if !ERRORLEVEL! neq 0 (
    echo Error: Tauri build failed
    echo Hint: If GitHub download times out, set GAT_GITHUB_MIRROR_TEMPLATE.
    echo Example:
    echo set GAT_GITHUB_MIRROR_TEMPLATE=https://ghproxy.com/https://github.com/^<owner^>/^<repo^>/releases/download/^<version^>/^<asset^>
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
