$ErrorActionPreference = "Stop"

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot "release"))
$systemTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temporaryOutput = [IO.Path]::GetFullPath(
  (Join-Path $systemTempRoot ("janja-desktop-dist-" + [guid]::NewGuid().ToString("N")))
)

if (-not $temporaryOutput.StartsWith($systemTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Diretório temporário fora da pasta temporária do sistema."
}

Push-Location $projectRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "O build web falhou com código $LASTEXITCODE." }

  & npx.cmd electron-builder --win nsis "--config.directories.output=$temporaryOutput"
  if ($LASTEXITCODE -ne 0) { throw "O empacotamento desktop falhou com código $LASTEXITCODE." }

  New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
  $artifacts = Get-ChildItem -LiteralPath $temporaryOutput -File | Where-Object {
    $_.Name -like "Janja-Voice-Chat-*.exe" -or
    $_.Name -like "Janja-Voice-Chat-*.exe.blockmap"
  }
  if (($artifacts | Where-Object Extension -eq ".exe").Count -ne 1) {
    throw "O empacotador não produziu exatamente um instalador Janja."
  }
  foreach ($artifact in $artifacts) {
    Copy-Item -LiteralPath $artifact.FullName -Destination (Join-Path $releaseRoot $artifact.Name) -Force
  }

  Write-Host "Instalador copiado para $releaseRoot"
}
finally {
  Pop-Location
  if (
    (Test-Path -LiteralPath $temporaryOutput) -and
    $temporaryOutput.StartsWith($systemTempRoot, [StringComparison]::OrdinalIgnoreCase) -and
    ([IO.Path]::GetFileName($temporaryOutput) -like "janja-desktop-dist-*")
  ) {
    Remove-Item -LiteralPath $temporaryOutput -Recurse -Force
  }
}
