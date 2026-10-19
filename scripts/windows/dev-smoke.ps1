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

function AssertPortsClosed([int[]]$ports, [string]$context) {
  foreach ($port in $ports) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $client.Connect('127.0.0.1', $port)
      throw "Proceso huerfano $context en puerto $port"
    } catch [System.Net.Sockets.SocketException] { }
    finally { $client.Dispose() }
  }
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

foreach ($port in @($env:TRADING_POC_API_PORT, $env:TRADING_POC_WEB_PORT)) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $client.Connect('127.0.0.1', [int]$port)
    throw "Proceso huérfano en puerto $port"
  } catch [System.Net.Sockets.SocketException] { }
  finally { $client.Dispose() }
}
Write-Host 'Ambos puertos cerrados tras detener el árbol del launcher.'

$failed = Start-Process -FilePath 'node.exe' -ArgumentList 'scripts/windows/dev-failure-fixture.mjs' `
  -WorkingDirectory $junction -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr
try {
  if (-not $failed.WaitForExit(30000)) {
    throw "El launcher no cerró Vite al fallar el otro script. stdout=$(Get-Content $stdout -Raw) stderr=$(Get-Content $stderr -Raw)"
  }
  if ($failed.ExitCode -eq 0) { throw 'El launcher ocultó el fallo del otro script.' }
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

$failedAfterStart = Start-Process -FilePath 'node.exe' -ArgumentList 'scripts/windows/dev-failure-after-start-fixture.mjs' `
  -WorkingDirectory $junction -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr
try {
  if (-not $failedAfterStart.WaitForExit(45000)) {
    throw "El launcher no cerrÃ³ Vite tras un fallo posterior a su arranque. stdout=$(Get-Content $stdout -Raw) stderr=$(Get-Content $stderr -Raw)"
  }
  if ($failedAfterStart.ExitCode -eq 0) { throw 'El launcher ocultÃ³ el fallo posterior al arranque de Vite.' }
} finally {
  if (-not $failedAfterStart.HasExited) { StopTree $failedAfterStart.Id }
}
AssertPortsClosed @([int]$env:TRADING_POC_API_PORT, [int]$env:TRADING_POC_WEB_PORT) 'despues de fallo con Vite disponible'
Write-Host 'Fallo posterior al arranque propagado y puertos liberados.'

$occupiedApiPort = FreePort
$env:TRADING_POC_API_PORT = [string]$occupiedApiPort
$env:TRADING_POC_WEB_PORT = [string](FreePort)
$occupiedListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $occupiedApiPort)
$occupiedListener.Start()
try {
  $blocked = Start-Process -FilePath 'node.exe' -ArgumentList 'scripts/dev.mjs' `
    -WorkingDirectory $junction -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  if (-not $blocked.WaitForExit(10000)) {
    StopTree $blocked.Id
    throw 'El launcher no rechazÃ³ el puerto API ocupado.'
  }
  if ($blocked.ExitCode -eq 0) { throw 'El launcher iniciÃ³ con el puerto API ocupado.' }
  AssertPortsClosed @([int]$env:TRADING_POC_WEB_PORT) 'despues de rechazar un puerto ocupado'
} finally {
  $occupiedListener.Stop()
}
Write-Host 'Puerto ocupado rechazado sin iniciar servicios adicionales.'
