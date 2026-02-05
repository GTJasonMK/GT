# GraphAndTable 开发环境启动脚本
# 使用方式: .\scripts\dev.ps1

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8

# 项目根目录
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectRoot

Write-Host "========================================"
Write-Host "  GraphAndTable Dev Server"
Write-Host "========================================"
Write-Host ""

# 清理函数
function Stop-DevServer {
    Write-Host ""
    Write-Host "[Cleanup] Stopping all processes..." -ForegroundColor Yellow

    # 终止 node 进程 (Vite)
    Get-Process -Name "node" -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            Write-Host "  Stopped node process: $($_.Id)" -ForegroundColor Gray
        }
        catch { }
    }

    # 终止 GraphAndTable 进程
    Get-Process -Name "GraphAndTable*" -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            Write-Host "  Stopped app process: $($_.Id)" -ForegroundColor Gray
        }
        catch { }
    }

    Write-Host "[Cleanup] Done" -ForegroundColor Green
}

# 注册 Ctrl+C 处理
[Console]::TreatControlCAsInput = $false

try {
    # 检查依赖
    Write-Host "[1/3] Checking dependencies..." -ForegroundColor White
    if (-not (Test-Path "node_modules")) {
        Write-Host "  Installing npm packages..." -ForegroundColor Gray
        npm install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed"
        }
    }
    Write-Host "  OK" -ForegroundColor Green

    # 检查 Rust
    Write-Host "[2/3] Checking Rust..." -ForegroundColor White
    $rustVer = rustc --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Rust not found. Install from https://rustup.rs"
    }
    Write-Host "  $rustVer" -ForegroundColor Green

    # 启动
    Write-Host "[3/3] Starting Tauri dev server..." -ForegroundColor White
    Write-Host ""
    Write-Host "----------------------------------------"
    Write-Host "  Press Ctrl+C to stop"
    Write-Host "----------------------------------------"
    Write-Host ""

    # 直接运行 tauri dev
    npm run tauri dev

}
catch {
    Write-Host ""
    Write-Host "Error: $_" -ForegroundColor Red
    Stop-DevServer
    exit 1
}
finally {
    Stop-DevServer
}
