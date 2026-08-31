param(
  [string]$NodeIp
)

$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$templatePath = Join-Path $workspace 'infra/livekit/livekit.local.template.yaml'
$outputPath = Join-Path $workspace 'infra/livekit/livekit.local.yaml'

if (-not $NodeIp) {
  $routes = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' |
    Sort-Object RouteMetric, InterfaceMetric
  foreach ($route in $routes) {
    $candidate = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex |
      Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.AddressState -eq 'Preferred'
      } |
      Select-Object -First 1
    if ($candidate) {
      $NodeIp = $candidate.IPAddress
      break
    }
  }
}

$parsed = [Net.IPAddress]::None
if (-not [Net.IPAddress]::TryParse($NodeIp, [ref]$parsed) -or $parsed.AddressFamily -ne 'InterNetwork') {
  throw 'Não foi possível determinar um IPv4 LAN. Use -NodeIp 192.168.x.y.'
}

$octets = $NodeIp.Split('.')
$lanCidr = "$($octets[0]).$($octets[1]).$($octets[2]).0/24"
$config = (Get-Content -LiteralPath $templatePath -Raw).Replace(
  '__NODE_IP__',
  $NodeIp
).Replace('__LAN_CIDR__', $lanCidr)
[IO.File]::WriteAllText($outputPath, $config, [Text.UTF8Encoding]::new($false))
Write-Host "LiveKit local configurado: node_ip=$NodeIp, LAN=$lanCidr"
