[CmdletBinding()]
param(
  [string]$BundleRoot = $PSScriptRoot,
  [string]$InstallRoot = "${env:ProgramFiles}\InfraWatch Agent",
  [string]$DataRoot = "${env:ProgramData}\InfraWatch Agent",
  [string]$ServiceName = "InfraWatchAgent"
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute o atualizador em um PowerShell com privilegios administrativos."
  }
}

Assert-Administrator

$runtimeSource = Join-Path $BundleRoot "runtime"
$standaloneExecutableSource = Join-Path $BundleRoot "InfraWatchAgent.exe"
if (-not (Test-Path $standaloneExecutableSource)) {
  $standaloneExecutableSource = Join-Path $runtimeSource "InfraWatchAgent.exe"
}
if (-not (Test-Path $standaloneExecutableSource)) {
  throw "Bundle do agente invalido. Esperado runtime em $runtimeSource"
}

$service = Get-Service -Name $ServiceName -ErrorAction Stop
if ($service.Status -ne "Stopped") {
  Stop-Service -Name $ServiceName -Force
  Start-Sleep -Seconds 2
}

Copy-Item -Path (Join-Path $runtimeSource "*") -Destination $InstallRoot -Recurse -Force
Copy-Item -Path $standaloneExecutableSource -Destination (Join-Path $InstallRoot "InfraWatchAgent.exe") -Force

Start-Service -Name $ServiceName
Start-Sleep -Seconds 4

$configPath = Join-Path $DataRoot "config\\agent.config.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$headers = @{}
if ($config.secret) {
  $headers["Authorization"] = "Bearer $($config.secret)"
}
$health = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $config.port) -Headers $headers

[pscustomobject]@{
  serviceName = $ServiceName
  installRoot = $InstallRoot
  configPath = $configPath
  endpoint = ("http://127.0.0.1:{0}/metrics" -f $config.port)
  healthOk = $health.ok
} | Format-List
