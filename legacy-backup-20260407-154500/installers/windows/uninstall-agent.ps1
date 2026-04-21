[CmdletBinding()]
param(
  [string]$InstallRoot = "${env:ProgramFiles}\InfraWatch Agent",
  [string]$DataRoot = "${env:ProgramData}\InfraWatch Agent",
  [string]$ServiceName = "InfraWatchAgent",
  [switch]$RemoveData
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute o desinstalador em um PowerShell com privilegios administrativos."
  }
}

Assert-Administrator

$nssmPath = Join-Path $InstallRoot "support\nssm.exe"

$configPath = Join-Path $DataRoot "config\\agent.config.json"
$port = $null
if (Test-Path $configPath) {
  try {
    $port = (Get-Content $configPath -Raw | ConvertFrom-Json).port
  } catch {
    $port = $null
  }
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
  if ($service.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
  if (Test-Path $nssmPath) {
    & $nssmPath remove $ServiceName confirm | Out-Null
    if ($LASTEXITCODE -ne 0) {
      sc.exe delete $ServiceName | Out-Null
    }
  } else {
    sc.exe delete $ServiceName | Out-Null
  }
  Start-Sleep -Seconds 2
}

if ($port) {
  $ruleName = "InfraWatch Agent Port $port"
  Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
}

if (Test-Path $InstallRoot) {
  Remove-Item -Path $InstallRoot -Recurse -Force
}

if ($RemoveData -and (Test-Path $DataRoot)) {
  Remove-Item -Path $DataRoot -Recurse -Force
}

[pscustomobject]@{
  serviceRemoved = [bool]$service
  installRootRemoved = -not (Test-Path $InstallRoot)
  dataRootRemoved = if ($RemoveData) { -not (Test-Path $DataRoot) } else { $false }
  dataPreserved = if ($RemoveData) { $false } else { (Test-Path $DataRoot) }
  configPath = $configPath
} | Format-List
