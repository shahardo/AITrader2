# start-redis.ps1 — launch a local Redis server for AITrader2 dev (matches the
# default REDIS_URL=redis://localhost:6379/0), storing its dump.rdb under
# .redis-data/ in the repo root so it never lands in the repo's working files.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $repoRoot '.redis-data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$redisServer = Get-Command redis-server.exe -ErrorAction SilentlyContinue
if ($redisServer) {
    $redisServerPath = $redisServer.Source
} else {
    $found = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" `
        -Filter redis-server.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $found) {
        throw "redis-server.exe not found. Install it with: winget install taizod1024.redis-windows-fork"
    }
    $redisServerPath = $found.FullName
}

& $redisServerPath --port 6379 --dir $dataDir
