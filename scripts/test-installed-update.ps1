param(
  [int]$Port = 18899,
  [string]$FromVersion = '0.1.0',
  [string]$ToVersion = '0.1.1'
)

$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runId = [Guid]::NewGuid().ToString('N')
$testRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) "lili-update-$runId"))
$oldOutput = Join-Path $testRoot 'old'
$feedOutput = Join-Path $testRoot 'feed'
$installDir = Join-Path $testRoot 'installed'
$resultPath = Join-Path $testRoot "lili-update-result-$runId.jsonl"
$serverLog = Join-Path $testRoot 'server.log'
$feedUrl = "http://127.0.0.1:$Port/"
$server = $null

function Assert-TestPath([string]$Path) {
  $resolved = [IO.Path]::GetFullPath($Path)
  $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (-not $resolved.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase) -or
      -not $resolved.Contains('lili-update-')) {
    throw "Caminho de teste inseguro: $resolved"
  }
}

function Stop-TestProcesses {
  Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try {
      $_.Path -and [IO.Path]::GetFullPath($_.Path).StartsWith(
        [IO.Path]::GetFullPath($installDir) + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase
      )
    } catch { $false }
  } | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Test-ProductVersion([string]$Actual, [string]$Expected) {
  return $Actual -eq $Expected -or $Actual -eq "$Expected.0"
}

Assert-TestPath $testRoot
New-Item -ItemType Directory -Path $oldOutput, $feedOutput -Force | Out-Null

try {
  Push-Location $workspace
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Vite build falhou.' }

  & npx.cmd electron-builder --win nsis --publish never `
    "--config.directories.output=$oldOutput" `
    "--config.extraMetadata.version=$FromVersion" `
    "--config.publish.provider=generic" `
    "--config.publish.url=$feedUrl"
  if ($LASTEXITCODE -ne 0) { throw 'Build da versão inicial falhou.' }

  & npx.cmd electron-builder --win nsis --publish never `
    "--config.directories.output=$feedOutput" `
    "--config.extraMetadata.version=$ToVersion" `
    "--config.publish.provider=generic" `
    "--config.publish.url=$feedUrl"
  if ($LASTEXITCODE -ne 0) { throw 'Build da versão de atualização falhou.' }

  $oldInstaller = Get-ChildItem -LiteralPath $oldOutput -Filter "*-$FromVersion-*.exe" -File |
    Select-Object -First 1
  $newInstaller = Get-ChildItem -LiteralPath $feedOutput -Filter "*-$ToVersion-*.exe" -File |
    Select-Object -First 1
  if (-not $oldInstaller -or -not $newInstaller) { throw 'Instaladores temporários não encontrados.' }
  if (-not (Test-Path -LiteralPath (Join-Path $feedOutput 'latest.yml'))) {
    throw 'Feed latest.yml não foi gerado.'
  }

  $server = Start-Process -FilePath 'node.exe' `
    -ArgumentList @((Join-Path $workspace 'scripts/local-update-server.mjs'), $feedOutput, $Port) `
    -RedirectStandardOutput $serverLog -RedirectStandardError (Join-Path $testRoot 'server-error.log') `
    -PassThru -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    if ((Test-Path -LiteralPath $serverLog) -and
        (Get-Content -LiteralPath $serverLog -Raw) -match 'READY') { break }
    Start-Sleep -Milliseconds 100
  }
  if (-not (Test-Path -LiteralPath $serverLog) -or
      (Get-Content -LiteralPath $serverLog -Raw) -notmatch 'READY') {
    throw 'Servidor HTTP local não iniciou.'
  }

  $install = Start-Process -FilePath $oldInstaller.FullName `
    -ArgumentList @('/S', ('/D=' + $installDir)) -Wait -PassThru -WindowStyle Hidden
  if ($install.ExitCode -ne 0) { throw "Instalação inicial falhou: $($install.ExitCode)" }
  $appPath = Join-Path $installDir 'Lili - Voice Chat.exe'
  if (-not (Test-Path -LiteralPath $appPath)) { throw 'Executável instalado não encontrado.' }
  $installedBefore = (Get-Item -LiteralPath $appPath).VersionInfo.ProductVersion
  if (-not (Test-ProductVersion $installedBefore $FromVersion)) {
    throw "Versão inicial inesperada: $installedBefore"
  }

  $env:LILI_UPDATE_TEST_MODE = '1'
  $env:LILI_UPDATE_FEED_URL = $feedUrl
  $env:LILI_UPDATE_TEST_RESULT = $resultPath
  $env:LILI_UPDATE_CHECK_DELAY_MS = '500'
  $env:ELECTRON_ENABLE_LOGGING = '1'
  $app = Start-Process -FilePath $appPath -ArgumentList @(
    '--enable-logging',
    '--lili-update-test',
    "--lili-update-feed=$feedUrl",
    "--lili-update-result=$resultPath"
  ) -PassThru

  $updated = $false
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    Start-Sleep -Seconds 1
    if (Test-Path -LiteralPath $appPath) {
      $version = (Get-Item -LiteralPath $appPath).VersionInfo.ProductVersion
      if (Test-ProductVersion $version $ToVersion) {
        $updated = $true
        break
      }
    }
    if ($app.HasExited -and $attempt -lt 5) {
      $events = if (Test-Path -LiteralPath $resultPath) {
        Get-Content -LiteralPath $resultPath -Raw
      } else { '' }
      if ($events -match '"status":"error"') {
        throw "Aplicativo reportou erro de atualização: $events"
      }
    }
  }
  if (-not $updated) {
    $events = if (Test-Path -LiteralPath $resultPath) {
      Get-Content -LiteralPath $resultPath -Raw
    } else { '<sem eventos>' }
    $exit = if ($app.HasExited) { $app.ExitCode } else { '<ativo>' }
    throw "Atualização não chegou a $ToVersion. Processo: $exit. Eventos: $events"
  }

  Start-Sleep -Seconds 2
  $events = Get-Content -LiteralPath $resultPath -Raw
  if ($events -notmatch '"status":"ready"') {
    throw "Evento update-downloaded ausente: $events"
  }

  Stop-TestProcesses
  $uninstaller = Join-Path $installDir 'Uninstall Lili - Voice Chat.exe'
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Desinstalador não encontrado.' }
  $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' `
    -Wait -PassThru -WindowStyle Hidden
  if ($uninstall.ExitCode -ne 0) { throw "Desinstalação falhou: $($uninstall.ExitCode)" }

  [pscustomobject]@{
    Success = $true
    FromVersion = $installedBefore
    ToVersion = $ToVersion
    Feed = $feedUrl
    DownloadedEvent = $true
    InstalledVersionVerified = $updated
    UninstallerExit = $uninstall.ExitCode
  } | ConvertTo-Json -Compress
} finally {
  Pop-Location -ErrorAction SilentlyContinue
  Stop-TestProcesses
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item Env:LILI_UPDATE_TEST_MODE -ErrorAction SilentlyContinue
  Remove-Item Env:LILI_UPDATE_FEED_URL -ErrorAction SilentlyContinue
  Remove-Item Env:LILI_UPDATE_TEST_RESULT -ErrorAction SilentlyContinue
  Remove-Item Env:LILI_UPDATE_CHECK_DELAY_MS -ErrorAction SilentlyContinue
  Remove-Item Env:ELECTRON_ENABLE_LOGGING -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $testRoot) {
    Assert-TestPath $testRoot
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}
