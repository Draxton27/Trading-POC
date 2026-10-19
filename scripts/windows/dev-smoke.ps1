$ErrorActionPreference = 'Stop'
$source = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$junction = Join-Path $env:RUNNER_TEMP 'Trading POC path with spaces'
if (-not (Test-Path -LiteralPath $junction)) {
  New-Item -ItemType Junction -Path $junction -Target $source | Out-Null
}

function FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
  return $port
}

function StopTree([int]$processId) {
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$processId"
  foreach ($child in $children) { StopTree ([int]$child.ProcessId) }
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}

$env:TRADING_POC_API_PORT = [string](FreePort)
$env:TRADING_POC_WEB_PORT = [string](FreePort)
$env:TRADING_POC_MODE = 'DEMO'
$stdout = Join-Path $env:RUNNER_TEMP 'phase19-dev-stdout.log'
$stderr = Join-Path $env:RUNNER_TEMP 'phase19-dev-stderr.log'
$process = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/s','/c','npm.cmd run dev' `
  -WorkingDirectory $junction -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr
try {
  $ready = $false
  for ($i = 0; $i -lt 40; $i++) {
    if ($process.HasExited) { break }
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$env:TRADING_POC_API_PORT/api/v1/health" -TimeoutSec 2
      $web = Invoke-WebRequest "http://127.0.0.1:$env:TRADING_POC_WEB_PORT/" -TimeoutSec 2 -UseBasicParsing
      if ($health.ok -and $health.mode -eq 'DEMO' -and $web.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ready) {
    throw "npm run dev no inició API y Vite en Windows. stdout=$(Get-Content $stdout -Raw) stderr=$(Get-Content $stderr -Raw)"
  }
  Write-Host 'DEMO: API y Vite iniciados desde ruta con espacios.'
} finally {
  if (-not $process.HasExited) {
    StopTree $process.Id
  }
  $process.WaitForExit(10000) | Out-Null
}

Start-Sleep -Seconds 1
foreach ($port in @($env:TRADING_POC_API_PORT, $env:TRADING_POC_WEB_PORT)) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $client.Connect('127.0.0.1', [int]$port)
    throw "Proceso huérfano en puerto $port"
  } catch [System.Net.Sockets.SocketException] { }
  finally { $client.Dispose() }
}
Write-Host 'Ambos puertos cerrados tras detener el árbol del launcher.'

$env:TRADING_POC_MODE = 'INVALID'
$failed = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/s','/c','npm.cmd run dev' `
  -WorkingDirectory $junction -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr
try {
  if (-not $failed.WaitForExit(30000)) { throw 'El launcher no cerró Vite al fallar la API.' }
  if ($failed.ExitCode -eq 0) { throw 'El launcher ocultó el fallo de la API.' }
} finally {
  if (-not $failed.HasExited) { StopTree $failed.Id }
}
foreach ($port in @($env:TRADING_POC_API_PORT, $env:TRADING_POC_WEB_PORT)) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $client.Connect('127.0.0.1', [int]$port)
    throw "Proceso huérfano después de fallo en puerto $port"
  } catch [System.Net.Sockets.SocketException] { }
  finally { $client.Dispose() }
}
Write-Host 'Fallo del hijo propagado y ambos puertos liberados.'
