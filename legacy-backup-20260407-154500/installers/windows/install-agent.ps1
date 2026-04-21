[CmdletBinding()]
param(
  [string]$BundleRoot = $PSScriptRoot,
  [string]$InstallRoot = "${env:ProgramFiles}\InfraWatch Agent",
  [string]$DataRoot = "${env:ProgramData}\InfraWatch Agent",
  [string]$ServiceName = "InfraWatchAgent",
  [int]$Port = 9090,
  [string]$Secret = "",
  [string]$HostAlias = "",
  [string]$BindHost = "0.0.0.0",
  [string]$LogLevel = "info",
  [switch]$OpenFirewall
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute o instalador em um PowerShell com privilegios administrativos."
  }
}

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -ItemType Directory -Force | Out-Null
  }
}

function Invoke-Nssm {
  param(
    [string]$NssmPath,
    [string[]]$Arguments
  )

  $output = & $NssmPath @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    $message = if ($output) { ($output | Out-String).Trim() } else { "falha ao executar NSSM" }
    throw "NSSM retornou erro ao executar '$($Arguments -join " ")': $message"
  }

  return $output
}

function Write-AgentConfig([string]$ConfigPath) {
  if (Test-Path $ConfigPath) {
    return
  }

  $config = [ordered]@{
    port = $Port
    secret = $Secret
    hostAlias = if ($HostAlias) { $HostAlias } else { $null }
    bindHost = $BindHost
    logLevel = $LogLevel
    serviceName = $ServiceName
  }
  $config | ConvertTo-Json -Depth 5 | Set-Content -Path $ConfigPath -Encoding UTF8
}

function Ensure-FirewallRule([string]$RuleName) {
  if (-not $OpenFirewall) {
    return $false
  }
  $existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
  if (-not $existing) {
    New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
  }
  return $true
}

function Remove-ServiceIfExists([string]$Name, [string]$NssmPath) {
  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (-not $service) {
    return
  }
  if ($service.Status -ne "Stopped") {
    Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
  if (Test-Path $NssmPath) {
    try {
      Invoke-Nssm -NssmPath $NssmPath -Arguments @("remove", $Name, "confirm") | Out-Null
    } catch {
      sc.exe delete $Name | Out-Null
    }
  } else {
    sc.exe delete $Name | Out-Null
  }
  Start-Sleep -Seconds 2
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
$nssmSource = Join-Path $runtimeSource "support\nssm.exe"
if (-not (Test-Path $nssmSource)) {
  throw "Bundle do agente invalido. NSSM nao encontrado em $nssmSource"
}

$configRoot = Join-Path $DataRoot "config"
$logsRoot = Join-Path $DataRoot "logs"
$configPath = Join-Path $configRoot "agent.config.json"
$firewallRuleName = "InfraWatch Agent Port $Port"

Ensure-Directory $InstallRoot
Ensure-Directory $configRoot
Ensure-Directory $logsRoot

Copy-Item -Path (Join-Path $runtimeSource "*") -Destination $InstallRoot -Recurse -Force
Copy-Item -Path $standaloneExecutableSource -Destination (Join-Path $InstallRoot "InfraWatchAgent.exe") -Force
Write-AgentConfig -ConfigPath $configPath

$nssmPath = Join-Path $InstallRoot "support\nssm.exe"
$executablePath = Join-Path $InstallRoot "InfraWatchAgent.exe"
Remove-ServiceIfExists -Name $ServiceName -NssmPath $nssmPath

$serviceParameters = "--config `"$configPath`""
Invoke-Nssm -NssmPath $nssmPath -Arguments @("install", $ServiceName, $executablePath) | Out-Null
Invoke-Nssm -NssmPath $nssmPath -Arguments @("set", $ServiceName, "Application", $executablePath) | Out-Null
Invoke-Nssm -NssmPath $nssmPath -Arguments @("set", $ServiceName, "AppParameters", $serviceParameters) | Out-Null
Invoke-Nssm -NssmPath $nssmPath -Arguments @("set", $ServiceName, "AppDirectory", $InstallRoot) | Out-Null
Invoke-Nssm -NssmPath $nssmPath -Arguments @("set", $ServiceName, "Start", "SERVICE_AUTO_START") | Out-Null
Invoke-Nssm -NssmPath $nssmPath -Arguments @("set", $ServiceName, "DisplayName", "InfraWatch Agent") | Out-Null
Invoke-Nssm -NssmPath $nssmPath -Arguments @("set", $ServiceName, "Description", "InfraWatch Agent - coleta local de metricas e diagnostico para o backend central.") | Out-Null
Invoke-Nssm -NssmPath $nssmPath -Arguments @("set", $ServiceName, "AppExit", "Default", "Restart") | Out-Null
Invoke-Nssm -NssmPath $nssmPath -Arguments @("set", $ServiceName, "AppNoConsole", "1") | Out-Null
Invoke-Nssm -NssmPath $nssmPath -Arguments @("set", $ServiceName, "AppStdout", (Join-Path $logsRoot "service-stdout.log")) | Out-Null
Invoke-Nssm -NssmPath $nssmPath -Arguments @("set", $ServiceName, "AppStderr", (Join-Path $logsRoot "service-stderr.log")) | Out-Null
Invoke-Nssm -NssmPath $nssmPath -Arguments @("set", $ServiceName, "AppRotateFiles", "1") | Out-Null

$firewallCreated = Ensure-FirewallRule -RuleName $firewallRuleName

Start-Service -Name $ServiceName
Start-Sleep -Seconds 4

$headers = @{}
if ($Secret) {
  $headers["Authorization"] = "Bearer $Secret"
}
$health = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $Port) -Headers $headers

[pscustomobject]@{
  serviceName = $ServiceName
  installRoot = $InstallRoot
  dataRoot = $DataRoot
  configPath = $configPath
  logFile = (Join-Path $logsRoot "agent.log")
  executablePath = $executablePath
  nssmPath = $nssmPath
  endpoint = ("http://127.0.0.1:{0}/metrics" -f $Port)
  firewallRule = if ($firewallCreated) { $firewallRuleName } else { "nao criada" }
  healthOk = $health.ok
} | Format-List
