# 一键本地启动（Windows PowerShell）
#
#   .\scripts\dev-up.ps1                 # 默认 8787 后端 + 5173 前端
#   .\scripts\dev-up.ps1 -ApiPort 8790 -WebPort 5180
#
# 做四件事：构建后端 → 起后端 → 起前端 → 打印地址与初始化口令。
# Ctrl+C 会把两个进程一起停掉。

param(
  [int]$ApiPort = 8787,
  [int]$WebPort = 5173,
  [string]$DbPath = ".tmp/dev.sqlite"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host "`n=== Detter 本地启动 ===`n" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "没有找到 node，请先安装 Node 22 或更高版本。" -ForegroundColor Red
  exit 1
}

# 1) 后端产物
$dist = Join-Path $repo "apps/api/dist/server.js"
if (-not (Test-Path $dist)) {
  Write-Host "[1/4] 构建后端 ..." -ForegroundColor Yellow
  node apps/api/scripts/build-node.mjs
} else {
  Write-Host "[1/4] 后端产物已存在，跳过构建（想强制重建就删掉 apps/api/dist）" -ForegroundColor DarkGray
}

# 2) 初始化口令（首次需要，之后可删）
$token = $env:SETUP_TOKEN
if (-not $token) {
  $token = -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
}

# 3) 起后端
Write-Host "[2/4] 启动后端 :$ApiPort ..." -ForegroundColor Yellow
$dbFull = Join-Path $repo $DbPath
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dbFull) | Out-Null

$env:PORT = "$ApiPort"
$env:DETTER_DB = $dbFull
$env:SETUP_TOKEN = $token
$env:APP_ORIGIN = "http://127.0.0.1:$WebPort"

$api = Start-Process -FilePath "node" -ArgumentList "apps/api/dist/server.js" -PassThru -WindowStyle Hidden

# 等健康检查
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 250
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$ApiPort/api/v1/health" -TimeoutSec 2 -UseBasicParsing
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}
if (-not $ready) {
  Write-Host "后端没有起来，端口可能被占用。看看是不是已经有一个在跑，或者换个端口：-ApiPort 8790" -ForegroundColor Red
  if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force }
  exit 1
}

# 4) 起前端
Write-Host "[3/4] 启动前端 :$WebPort ..." -ForegroundColor Yellow
$env:DETTER_API_TARGET = "http://127.0.0.1:$ApiPort"
$vite = Start-Process -FilePath "node" `
  -ArgumentList "node_modules/vite/bin/vite.js --port $WebPort --strictPort --host 127.0.0.1" `
  -WorkingDirectory (Join-Path $repo "apps/web") -PassThru -WindowStyle Hidden

Start-Sleep -Seconds 3

Write-Host "[4/4] 就绪`n" -ForegroundColor Green
Write-Host "  应用  http://127.0.0.1:$WebPort"
Write-Host "  接口  http://127.0.0.1:$ApiPort/api/v1/health"
Write-Host "  数据库 $dbFull"
if ($env:SETUP_TOKEN) {
  Write-Host "  初始化口令 $token" -ForegroundColor Yellow
  Write-Host "  （第一次打开网页会要求填它 + 设置一个至少 10 位的密码）`n"
}

Write-Host "想灌一批示例数据：在另一个窗口跑 `node scripts/seed-demo.mjs --url=http://127.0.0.1:$WebPort --password=<你设的密码>`" -ForegroundColor DarkGray
Write-Host "按 Ctrl+C 停止。`n" -ForegroundColor DarkGray

try {
  while ($true) {
    Start-Sleep -Seconds 1
    if ($api.HasExited) { Write-Host "后端退出了。" -ForegroundColor Red; break }
    if ($vite.HasExited) { Write-Host "前端退出了。" -ForegroundColor Red; break }
  }
} finally {
  Write-Host "`n正在停止 ..." -ForegroundColor Yellow
  if ($vite -and -not $vite.HasExited) { Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue }
  if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
}
