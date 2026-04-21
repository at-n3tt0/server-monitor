$ErrorActionPreference = "Stop"

param(
  [string]$InstallDir = "C:\\ServerMonitorAgent",
  [string]$PythonExe = "python",
  [string]$BindAddress = "0.0.0.0",
  [int]$Port = 9090,
  [string]$Token = "",
  [string]$AllowedMonitorIp = ""
)

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path "agent\\*" -Destination $InstallDir -Recurse -Force

& $PythonExe -m venv "$InstallDir\\.venv"
& "$InstallDir\\.venv\\Scripts\\python.exe" -m pip install -r "$InstallDir\\requirements.txt"

if (-not (Test-Path "$InstallDir\\config\\agent-config.json")) {
  Copy-Item "$InstallDir\\config\\agent-config.example.json" "$InstallDir\\config\\agent-config.json"
}

$envFile = @"
SERVER_MONITOR_AGENT_HOST=$BindAddress
SERVER_MONITOR_AGENT_PORT=$Port
SERVER_MONITOR_AGENT_TOKEN=$Token
SERVER_MONITOR_AGENT_CONFIG=$InstallDir\\config\\agent-config.json
SERVER_MONITOR_ALLOWED_MONITOR_IP=$AllowedMonitorIp
"@
$envFile | Set-Content "$InstallDir\\agent.env"

$command = "`"$InstallDir\\.venv\\Scripts\\python.exe`" `"$InstallDir\\monitor_agent.py`""
New-Service -Name "ServerMonitorAgent" -BinaryPathName $command -DisplayName "Server Monitor Agent" -StartupType Automatic

if ($AllowedMonitorIp) {
  $ruleName = "Server Monitor Agent 9090"
  if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
    Remove-NetFirewallRule -DisplayName $ruleName
  }
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -RemoteAddress $AllowedMonitorIp | Out-Null
}

Start-Service "ServerMonitorAgent"
