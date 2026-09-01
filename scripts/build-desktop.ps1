<#
.SYNOPSIS
Empacota o instalador Windows da Lili.

.DESCRIPTION
Por padrão o instalador sai apontado para produção: `.env.production` sobrepõe
o `.env.local` no modo production do Vite, e o validador roda em modo estrito,
recusando URL local, chave de service role e segredo com prefixo VITE_.

Três verificações acontecem antes de o instalador existir, e cada uma cobre uma
falha que só aparece depois de instalar:

1. `check-web-env` recusa a configuração errada. Um instalador assinado
   falando com `127.0.0.1` é pior do que nenhum instalador.
2. O bundle é fumado por `file://` — o esquema que o aplicativo instalado usa.
   Foi assim que se descobriu que o `base` absoluto do Vite deixava a janela em
   branco, sem erro nenhum no console.
3. O mesmo teste roda de novo contra o `dist/` de dentro do `app.asar`, porque
   empacotar é a segunda chance de o caminho dos assets mudar.

Não existe modo local: o instalador só sai apontado para a infraestrutura
publicada. Um executável que fala com `127.0.0.1` não roda na máquina de mais
ninguém, e a única forma de descobrir isso é depois de distribuí-lo.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Get-Sha256([string] $Path) {
  $stream = [IO.File]::OpenRead($Path)
  try {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
      return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    }
    finally { $algorithm.Dispose() }
  }
  finally { $stream.Dispose() }
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot "release"))
$systemTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temporaryOutput = [IO.Path]::GetFullPath(
  (Join-Path $systemTempRoot ("lili-desktop-dist-" + [guid]::NewGuid().ToString("N")))
)

if (-not $temporaryOutput.StartsWith($systemTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Diretório temporário fora da pasta temporária do sistema."
}

Push-Location $projectRoot
try {
  # Diz ao Vite para gerar caminhos relativos: o `dist/` empacotado é aberto
  # por file://, onde "/assets/..." aponta para a raiz do disco.
  $env:LILI_DESKTOP_BUILD = "true"

  $env:LILI_STRICT_ENV = "true"
  & npm.cmd run build:web
  if ($LASTEXITCODE -ne 0) { throw "O build web falhou com código $LASTEXITCODE." }

  & npx.cmd electron scripts/test-desktop-smoke.mjs
  if ($LASTEXITCODE -ne 0) { throw "O dist não sobreviveu ao carregamento por file://." }

  & npx.cmd electron-builder --win nsis "--config.directories.output=$temporaryOutput"
  if ($LASTEXITCODE -ne 0) { throw "O empacotamento desktop falhou com código $LASTEXITCODE." }

  $packagedDist = Join-Path $temporaryOutput "win-unpacked\resources\app.asar\dist"
  $env:LILI_SMOKE_DIST = $packagedDist
  try {
    & npx.cmd electron scripts/test-desktop-smoke.mjs
    if ($LASTEXITCODE -ne 0) { throw "O bundle dentro do app.asar não carrega por file://." }
  }
  finally { Remove-Item Env:\LILI_SMOKE_DIST -ErrorAction SilentlyContinue }

  New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
  $artifacts = Get-ChildItem -LiteralPath $temporaryOutput -File | Where-Object {
    $_.Name -like "Lili-Voice-Chat-*.exe" -or
    $_.Name -like "Lili-Voice-Chat-*.exe.blockmap"
  }
  if (($artifacts | Where-Object Extension -eq ".exe").Count -ne 1) {
    throw "O empacotador não produziu exatamente um instalador Lili."
  }
  foreach ($artifact in $artifacts) {
    Copy-Item -LiteralPath $artifact.FullName -Destination (Join-Path $releaseRoot $artifact.Name) -Force
  }

  # A soma acompanha o instalador porque esta build não é assinada: sem
  # Authenticode, o hash publicado ao lado do download é a única forma de quem
  # baixa conferir que o arquivo é o que saiu daqui.
  $installer = $artifacts | Where-Object Extension -eq ".exe"
  $copied = Join-Path $releaseRoot $installer.Name
  $hash = Get-Sha256 $copied
  # Escrito na mão porque `Set-Content` do PowerShell 5.1 estraga o arquivo das
  # duas pontas: `-Encoding utf8` põe BOM no início da linha e a quebra sai
  # CRLF. `sha256sum -c` rejeita a linha nos dois casos, e conferir o download
  # é justamente para que este arquivo existe.
  [IO.File]::WriteAllText(
    (Join-Path $releaseRoot "SHA256SUMS.txt"),
    "$hash *$($installer.Name)`n",
    (New-Object Text.UTF8Encoding $false)
  )

  # O Electron carrega TypeData do PowerShell enquanto o smoke roda e, em
  # algumas versões do Windows, a recarga do módulo Security nesta mesma
  # sessão falha com membros duplicados. A verificação isolada não herda esse
  # estado e continua usando a API nativa de Authenticode.
  $env:LILI_SIGNATURE_TARGET = $copied
  try {
    $signatureStatus = (& powershell.exe -NoProfile -NonInteractive -Command `
      '(Get-AuthenticodeSignature -LiteralPath $env:LILI_SIGNATURE_TARGET).Status.ToString()').Trim()
    if ($LASTEXITCODE -ne 0 -or -not $signatureStatus) {
      throw "Não foi possível verificar a assinatura Authenticode."
    }
  }
  finally { Remove-Item Env:\LILI_SIGNATURE_TARGET -ErrorAction SilentlyContinue }
  if ($signatureStatus -ne "Valid") {
    Write-Warning (
      "Instalador sem assinatura Authenticode válida ($signatureStatus). " +
      "O SmartScreen vai avisar o usuário. A build assinada sai do workflow " +
      "release.yml, com CSC_LINK e CSC_KEY_PASSWORD."
    )
  }

  Write-Host ""
  Write-Host "Instalador: $copied" -ForegroundColor Green
  Write-Host "SHA256:     $hash"
}
finally {
  Pop-Location
  Remove-Item Env:\LILI_DESKTOP_BUILD -ErrorAction SilentlyContinue
  Remove-Item Env:\LILI_STRICT_ENV -ErrorAction SilentlyContinue
  if (
    (Test-Path -LiteralPath $temporaryOutput) -and
    $temporaryOutput.StartsWith($systemTempRoot, [StringComparison]::OrdinalIgnoreCase) -and
    ([IO.Path]::GetFileName($temporaryOutput) -like "lili-desktop-dist-*")
  ) {
    Remove-Item -LiteralPath $temporaryOutput -Recurse -Force
  }
}
