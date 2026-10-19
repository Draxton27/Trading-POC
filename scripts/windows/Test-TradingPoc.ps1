$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo
npm ci; if ($LASTEXITCODE -ne 0) { throw 'Instalación fallida.' }
npm run typecheck; if ($LASTEXITCODE -ne 0) { throw 'Tipos fallidos.' }
npm test; if ($LASTEXITCODE -ne 0) { throw 'Pruebas fallidas.' }
npm run build; if ($LASTEXITCODE -ne 0) { throw 'Build fallido.' }
