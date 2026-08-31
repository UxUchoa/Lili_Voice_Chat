$ErrorActionPreference = 'Continue'

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'

function Remove-StaleDockerRuntimeSockets {
  $dockerProcesses = Get-Process -Name 'Docker Desktop', 'com.docker.backend' -ErrorAction SilentlyContinue
  if ($dockerProcesses) { return }

  $runtimeDirectory = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Docker\run'))
  $expectedDirectory = [IO.Path]::GetFullPath("$env:USERPROFILE\AppData\Local\Docker\run")
  if ($runtimeDirectory -ne $expectedDirectory -or -not (Test-Path -LiteralPath $runtimeDirectory)) {
    return
  }

  foreach ($socketName in @('dockerInference', 'dockerEthernetVfkit', 'userAnalyticsOtlpHttp.sock')) {
    $socketPath = Join-Path $runtimeDirectory $socketName
    $socket = Get-Item -Force -LiteralPath $socketPath -ErrorAction SilentlyContinue
    if (
      $socket -and
      -not $socket.PSIsContainer -and
      $socket.Length -eq 0 -and
      ($socket.Attributes -band [IO.FileAttributes]::ReparsePoint)
    ) {
      try {
        Remove-Item -Force -LiteralPath $socketPath -ErrorAction Stop
        Write-Host "Socket obsoleto do Docker removido: $socketName"
      } catch {
        Write-Warning "Socket $socketName permaneceu em uso; o Docker tentará reutilizá-lo."
      }
    }
  }
}

docker info --format '{{.ServerVersion}}' *> $null
if ($LASTEXITCODE -ne 0) {
  if (-not (Test-Path -LiteralPath $dockerDesktop)) {
    throw "Docker Desktop não encontrado em $dockerDesktop"
  }
  Remove-StaleDockerRuntimeSockets
  Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
  $dockerReady = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 2
    docker info --format '{{.ServerVersion}}' *> $null
    if ($LASTEXITCODE -eq 0) {
      $dockerReady = $true
      break
    }
  }
  if (-not $dockerReady) { throw 'Docker Desktop não ficou pronto em 60 segundos.' }
}

Push-Location $workspace
try {
  # imgproxy/pooler não são usados pelo Lili local. Vector exigiria expor a
  # Docker Engine API sem TLS na porta 2375 do Windows apenas para coletar logs;
  # mantemos esse auxiliar desligado e preservamos a configuração segura padrão.
  npx supabase start -x imgproxy,pooler,vector *> $null
  $startExitCode = $LASTEXITCODE
  if ($startExitCode -ne 0) {
    Write-Host 'Supabase ainda está inicializando; aguardando serviços essenciais...'
  }
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    npx supabase status --output json *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 2
  }
  if ($LASTEXITCODE -ne 0) { throw 'Supabase local não ficou pronto.' }

  npx supabase migration up
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao aplicar migrations locais.' }

  npm run infra:livekit:up
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao iniciar LiveKit/TURN.' }
} finally {
  Pop-Location
}

Write-Host 'Infraestrutura pronta. Iniciando web e Edge Functions...'
