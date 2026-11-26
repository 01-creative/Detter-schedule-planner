# 单端口本地运行（Windows PowerShell）
#
#   .\scripts\serve-local.ps1                 # 默认 10101
#   .\scripts\serve-local.ps1 -Port 8080
#
# 一个进程同时提供前端页面与 API：不需要 Vite、不需要 Nginx、不需要 Docker。
# 数据库默认放 .local/detter.sqlite（删掉它就是全新环境）。

param(
  [int]$Port = 10101,
  [string]$DbPath = ".local/detter.sqlite",
  [string]$SetupToken = "detter-local-setup-2026"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

if (-not (Test-Path "apps/web/dist/index.html")) {
  Write-Host "没有前端构建产物，先构建 ..." -ForegroundColor Yellow
  node node_modules/pnpm/bin/pnpm.cjs --filter @detter/web build
}
if (-not (Test-Path "apps/api/dist/server.js")) {
  Write-Host "没有后端产物，先构建 ..." -ForegroundColor Yellow
  node apps/api/scripts/build-node.mjs
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent (Join-Path $repo $DbPath)) | Out-Null

$env:DETTER_DB = Join-Path $repo $DbPath
$env:PORT = "$Port"
$env:HOST = "0.0.0.0"
$env:SETUP_TOKEN = $SetupToken
$env:APP_ORIGIN = "http://127.0.0.1:$Port"

$lan = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
  Select-Object -First 1 -ExpandProperty IPAddress)

Write-Host "`nDetter 单端口运行中" -ForegroundColor Cyan
Write-Host "  本机   http://127.0.0.1:$Port"
if ($lan) { Write-Host "  局域网 http://${lan}:$Port   （手机连同一个 WiFi 就能打开）" }
Write-Host "  数据库 $env:DETTER_DB"
Write-Host "  初始化口令 $SetupToken（仅首次打开网页时需要）`n"
Write-Host "按 Ctrl+C 停止。`n" -ForegroundColor DarkGray

node apps/api/dist/server.js
