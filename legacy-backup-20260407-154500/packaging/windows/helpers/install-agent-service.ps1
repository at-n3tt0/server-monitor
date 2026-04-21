[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,
  [string]$NssmPath = "",
  [string]$OptionsPath = "",
  [string]$InstallRoot = "${env:ProgramFiles}\InfraWatch Agent",
  [string]$DataRoot = "${env:ProgramData}\InfraWatch Agent",
  [string]$ServiceName = "InfraWatchAgent",
  [int]$Port = 9090,
  [string]$Secret = "",
  [string]$HostAlias = "",
  [string]$BindHost = "0.0.0.0",
  [string]$LogLevel = "info",
  [switch]$OpenFirewall,
  [switch]$ForceConfig
)

$ErrorActionPreference = "Stop"

$script:HelperLogPath = $null

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute em PowerShell com privilegios administrativos."
  }
}

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -ItemType Directory -Force | Out-Null
  }
}

function Write-HelperLog {
  param(
    [string]$Message,
    [string]$Level = "INFO"
  )

  $line = "[{0}] [{1}] {2}" -f (Get-Date).ToString("s"), $Level.ToUpperInvariant(), $Message
  if ($script:HelperLogPath) {
    Add-Content -Path $script:HelperLogPath -Value $line -Encoding UTF8
  }
}

function Invoke-Nssm {
  param(
    [string[]]$Arguments
  )

  $output = & $NssmPath @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    $message = if ($output) { ($output | Out-String).Trim() } else { "falha ao executar NSSM" }
    Write-HelperLog -Level "ERROR" -Message ("NSSM falhou: " + $message)
    throw "NSSM retornou erro ao executar '$($Arguments -join " ")': $message"
  }

  if ($output) {
    Write-HelperLog -Message ("NSSM output: " + (($output | Out-String).Trim()))
  }

  return $output
}

function Remove-ServiceIfExists([string]$Name) {
  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (-not $service) {
    return
  }
  if ($service.Status -ne "Stopped") {
    Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
  if ($NssmPath -and (Test-Path $NssmPath)) {
    try {
      Invoke-Nssm -Arguments @("remove", $Name, "confirm") | Out-Null
    } catch {
      sc.exe delete $Name | Out-Null
    }
  } else {
    sc.exe delete $Name | Out-Null
  }
  Start-Sleep -Seconds 2
}

function Write-AgentConfig([string]$ConfigPath) {
  if ((Test-Path $ConfigPath) -and -not $ForceConfig) {
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

try {
Assert-Administrator

if ($OptionsPath) {
  if (-not (Test-Path $OptionsPath)) {
    throw "Arquivo de opcoes nao encontrado em $OptionsPath"
  }
  $options = Get-Content $OptionsPath -Raw | ConvertFrom-Json
  if ($options.InstallRoot) { $InstallRoot = $options.InstallRoot }
  if ($options.DataRoot) { $DataRoot = $options.DataRoot }
  if ($options.NssmPath) { $NssmPath = [string]$options.NssmPath }
  if ($options.ServiceName) { $ServiceName = $options.ServiceName }
  if ($options.Port) { $Port = [int]$options.Port }
  if ($null -ne $options.Secret) { $Secret = [string]$options.Secret }
  if ($null -ne $options.HostAlias) { $HostAlias = [string]$options.HostAlias }
  if ($options.BindHost) { $BindHost = [string]$options.BindHost }
  if ($options.LogLevel) { $LogLevel = [string]$options.LogLevel }
  if ($null -ne $options.OpenFirewall) { $OpenFirewall = [bool]$options.OpenFirewall }
  if ($null -ne $options.ForceConfig) { $ForceConfig = [bool]$options.ForceConfig }
}

if (-not (Test-Path $ExecutablePath)) {
  throw "Executavel do agente nao encontrado em $ExecutablePath"
}

if (-not $NssmPath) {
  $NssmPath = Join-Path $InstallRoot "support\nssm.exe"
}

if (-not (Test-Path $NssmPath)) {
  throw "Executavel do NSSM nao encontrado em $NssmPath"
}

$configRoot = Join-Path $DataRoot "config"
$logsRoot = Join-Path $DataRoot "logs"
$configPath = Join-Path $configRoot "agent.config.json"
$firewallRuleName = "InfraWatch Agent Port $Port"

Ensure-Directory $InstallRoot
Ensure-Directory $configRoot
Ensure-Directory $logsRoot

$script:HelperLogPath = Join-Path $logsRoot "install-helper.log"
Write-HelperLog -Message "Inicio do helper de instalacao do servico"
Write-HelperLog -Message "ExecutablePath=$ExecutablePath"
Write-HelperLog -Message "NssmPath=$NssmPath"
Write-HelperLog -Message "InstallRoot=$InstallRoot"
Write-HelperLog -Message "DataRoot=$DataRoot"
Write-HelperLog -Message "ConfigPath=$configPath"

Write-AgentConfig -ConfigPath $configPath
Remove-ServiceIfExists -Name $ServiceName

$serviceParameters = "--config `"$configPath`""
Invoke-Nssm -Arguments @("install", $ServiceName, $ExecutablePath) | Out-Null
Invoke-Nssm -Arguments @("set", $ServiceName, "Application", $ExecutablePath) | Out-Null
Invoke-Nssm -Arguments @("set", $ServiceName, "AppParameters", $serviceParameters) | Out-Null
Invoke-Nssm -Arguments @("set", $ServiceName, "AppDirectory", $InstallRoot) | Out-Null
Invoke-Nssm -Arguments @("set", $ServiceName, "Start", "SERVICE_AUTO_START") | Out-Null
Invoke-Nssm -Arguments @("set", $ServiceName, "DisplayName", "InfraWatch Agent") | Out-Null
Invoke-Nssm -Arguments @("set", $ServiceName, "Description", "InfraWatch Agent - coleta local de metricas e diagnostico para o backend central.") | Out-Null
Invoke-Nssm -Arguments @("set", $ServiceName, "AppExit", "Default", "Restart") | Out-Null
Invoke-Nssm -Arguments @("set", $ServiceName, "AppNoConsole", "1") | Out-Null
Invoke-Nssm -Arguments @("set", $ServiceName, "AppStdout", (Join-Path $logsRoot "service-stdout.log")) | Out-Null
Invoke-Nssm -Arguments @("set", $ServiceName, "AppStderr", (Join-Path $logsRoot "service-stderr.log")) | Out-Null
Invoke-Nssm -Arguments @("set", $ServiceName, "AppRotateFiles", "1") | Out-Null

$firewallCreated = Ensure-FirewallRule -RuleName $firewallRuleName

Start-Service -Name $ServiceName
Start-Sleep -Seconds 4
Write-HelperLog -Message "Servico iniciado, executando validacao de health"

$headers = @{}
if ($Secret) {
  $headers["Authorization"] = "Bearer $Secret"
}
$health = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $Port) -Headers $headers
Write-HelperLog -Message ("Health OK=" + [string]$health.ok)

[pscustomobject]@{
  serviceName = $ServiceName
  executablePath = $ExecutablePath
  installRoot = $InstallRoot
  dataRoot = $DataRoot
  configPath = $configPath
  logFile = (Join-Path $logsRoot "agent.log")
  helperLog = $script:HelperLogPath
  endpoint = ("http://127.0.0.1:{0}/metrics" -f $Port)
  firewallRule = if ($firewallCreated) { $firewallRuleName } else { "nao criada" }
  healthOk = $health.ok
} | Format-List
} catch {
  Write-HelperLog -Level "ERROR" -Message $_.Exception.Message
  if ($_.ScriptStackTrace) {
    Write-HelperLog -Level "ERROR" -Message $_.ScriptStackTrace
  }
  throw
}
