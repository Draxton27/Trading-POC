param([ValidateSet('MOCK','TWS')][string]$Mode = 'MOCK')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw 'El agente requiere Node.js 22 o superior.' }
if (-not (Test-Path 'node_modules')) { npm ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci falló.' } }
$env:TRADING_POC_AGENT_MODE = $Mode
Write-Host "Agente $Mode de solo lectura. Inicie sesión en TWS Paper manualmente si usa TWS."
npm run dev:agent
