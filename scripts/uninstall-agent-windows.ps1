$ErrorActionPreference = "Stop"

param(
  [string]$InstallDir = "C:\\ServerMonitorAgent"
)

if (Get-Service "ServerMonitorAgent" -ErrorAction SilentlyContinue) {
  Stop-Service "ServerMonitorAgent" -Force -ErrorAction SilentlyContinue
  sc.exe delete "ServerMonitorAgent" | Out-Null
}

if (Get-NetFirewallRule -DisplayName "Server Monitor Agent 9090" -ErrorAction SilentlyContinue) {
  Remove-NetFirewallRule -DisplayName "Server Monitor Agent 9090"
}

if (Test-Path $InstallDir) {
  Remove-Item -LiteralPath $InstallDir -Recurse -Force
}
