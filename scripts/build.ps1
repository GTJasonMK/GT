# GraphAndTable 生产构建脚本
# 使用方式: .\scripts\build.ps1

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectRoot

Write-Host "========================================"
Write-Host "  GraphAndTable Production Build"
Write-Host "========================================"
Write-Host ""

$startTime = Get-Date

try {
    # 清理
    Write-Host "[1/4] Cleaning old build..." -ForegroundColor White
    if (Test-Path "dist") {
        Remove-Item -Recurse -Force "dist"
    }
    Write-Host "  OK" -ForegroundColor Green

    # 依赖
    Write-Host "[2/4] Checking dependencies..." -ForegroundColor White
    if (-not (Test-Path "node_modules/@tauri-apps/cli/tauri.js")) {
        Write-Host "  Installing (missing Tauri CLI)..." -ForegroundColor Gray
        npm install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed"
        }
    }
    Write-Host "  OK" -ForegroundColor Green

    # 前端构建
    Write-Host "[3/4] Building frontend..." -ForegroundColor White
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed"
    }
    Write-Host "  OK" -ForegroundColor Green

    # Tauri 构建
    if ($env:GAT_PROXY_URL) {
        Write-Host "[4/4] Building Tauri app with proxy $($env:GAT_PROXY_URL)..." -ForegroundColor White
        $env:HTTP_PROXY = $env:GAT_PROXY_URL
        $env:HTTPS_PROXY = $env:GAT_PROXY_URL
    } else {
        Write-Host "[4/4] Building Tauri app (proxy disabled)..." -ForegroundColor White
        Remove-Item Env:HTTP_PROXY -ErrorAction SilentlyContinue
        Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
        Remove-Item Env:ALL_PROXY -ErrorAction SilentlyContinue
        Remove-Item Env:http_proxy -ErrorAction SilentlyContinue
        Remove-Item Env:https_proxy -ErrorAction SilentlyContinue
        Remove-Item Env:all_proxy -ErrorAction SilentlyContinue
    }

    npm run tauri -- build
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri build failed"
    }
    Write-Host "  OK" -ForegroundColor Green

    $elapsed = (Get-Date) - $startTime
    Write-Host ""
    Write-Host "========================================"
    Write-Host "  Build Success!"
    Write-Host "  Time: $($elapsed.ToString('mm\:ss'))"
    Write-Host "========================================"
    Write-Host ""

    # 显示输出
    $bundlePath = "src-tauri\target\release\bundle"
    if (Test-Path $bundlePath) {
        Write-Host "Output files:" -ForegroundColor White
        Get-ChildItem -Path $bundlePath -Recurse -File |
            Where-Object { $_.Extension -in ".exe", ".msi" } |
            ForEach-Object {
                $size = "{0:N2} MB" -f ($_.Length / 1MB)
                Write-Host "  $($_.FullName)"
                Write-Host "    Size: $size" -ForegroundColor Gray
            }
    }

}
catch {
    Write-Host ""
    Write-Host "Build failed: $_" -ForegroundColor Red
    exit 1
}
