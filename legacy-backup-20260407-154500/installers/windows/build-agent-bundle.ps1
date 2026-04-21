[CmdletBinding()]
param(
  [string]$RepositoryRoot = "",
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepositoryRoot) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepositoryRoot = (Resolve-Path (Join-Path $scriptDirectory "..\\..")).Path
}

if (-not $OutputRoot) {
  $OutputRoot = Join-Path $RepositoryRoot "dist\\agent\\windows"
}

$runtimeOutput = Join-Path $OutputRoot "runtime"
$nodeModuleOutput = Join-Path $runtimeOutput "node_modules\\systeminformation"
$runtimeSrcOutput = Join-Path $runtimeOutput "src"
$runtimeNodeModules = Join-Path $runtimeOutput "node_modules"
$runtimeSupportOutput = Join-Path $runtimeOutput "support"

if (Test-Path $OutputRoot) {
  Remove-Item -Path $OutputRoot -Recurse -Force
}

New-Item -Path $runtimeOutput -ItemType Directory -Force | Out-Null
New-Item -Path $runtimeSrcOutput -ItemType Directory -Force | Out-Null
New-Item -Path $runtimeNodeModules -ItemType Directory -Force | Out-Null
New-Item -Path $runtimeSupportOutput -ItemType Directory -Force | Out-Null

Copy-Item -Path (Join-Path $RepositoryRoot "agent-runtime\\package.json") -Destination $runtimeOutput
Copy-Item -Path (Join-Path $RepositoryRoot "agent-runtime\\config") -Destination $runtimeOutput -Recurse -Force
Copy-Item -Path (Join-Path $RepositoryRoot "agent-runtime\\src\\config.js") -Destination (Join-Path $runtimeOutput "src\\config.js") -Force
Copy-Item -Path (Join-Path $RepositoryRoot "agent-runtime\\src\\logger.js") -Destination (Join-Path $runtimeOutput "src\\logger.js") -Force
Copy-Item -Path (Join-Path $RepositoryRoot "agent-runtime\\src\\service.js") -Destination (Join-Path $runtimeOutput "src\\service.js") -Force
Copy-Item -Path (Join-Path $RepositoryRoot "agent-runtime\\src\\server.js") -Destination (Join-Path $runtimeOutput "src\\server.js") -Force
Copy-Item -Path (Join-Path $RepositoryRoot "node_modules\\systeminformation") -Destination $nodeModuleOutput -Recurse -Force
Copy-Item -Path (Join-Path $RepositoryRoot "dist\\agent\\windows\\InfraWatchAgent.exe") -Destination (Join-Path $runtimeOutput "InfraWatchAgent.exe") -Force -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $RepositoryRoot "packaging\\windows\\vendor\\nssm.exe") -Destination (Join-Path $runtimeSupportOutput "nssm.exe") -Force
Copy-Item -Path (Join-Path $RepositoryRoot "packaging\\windows\\vendor\\nssm-license.txt") -Destination (Join-Path $runtimeSupportOutput "nssm-license.txt") -Force

Copy-Item -Path (Join-Path $RepositoryRoot "installers\\windows\\install-agent.ps1") -Destination $OutputRoot -Force
Copy-Item -Path (Join-Path $RepositoryRoot "installers\\windows\\update-agent.ps1") -Destination $OutputRoot -Force
Copy-Item -Path (Join-Path $RepositoryRoot "installers\\windows\\uninstall-agent.ps1") -Destination $OutputRoot -Force

@"
InfraWatch Agent Installer Bundle

Conteudo:
- runtime\
- install-agent.ps1
- update-agent.ps1
- uninstall-agent.ps1

Instalacao:
1. Execute install-agent.ps1 em PowerShell elevado.
2. O bundle usa InfraWatchAgent.exe standalone e NSSM para registrar o servico.
"@ | Set-Content -Path (Join-Path $OutputRoot "README.txt") -Encoding UTF8

[pscustomobject]@{
  outputRoot = $OutputRoot
  runtime = $runtimeOutput
  includesSystemInformation = Test-Path $nodeModuleOutput
} | Format-List
