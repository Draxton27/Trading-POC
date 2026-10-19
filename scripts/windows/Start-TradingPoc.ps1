param([ValidateSet('DEMO','OFFLINE','PAPER')][string]$Mode = 'DEMO')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw 'Trading-POC requiere Node.js 22 o superior.' }
if (-not (Test-Path 'node_modules')) { npm ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci falló.' } }
$env:TRADING_POC_MODE = $Mode
Write-Host "Trading-POC $Mode: abra http://127.0.0.1:5173/ en este equipo."
npm run dev
