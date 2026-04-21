[CmdletBinding()]
param(
  [string]$RepositoryRoot = "",
  [string]$OutputRoot = "",
  [string]$Target = "node18-win-x64"
)

$ErrorActionPreference = "Stop"

if (-not $RepositoryRoot) {
  $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepositoryRoot = (Resolve-Path (Join-Path $scriptDirectory "..\\..")).Path
}

if (-not $OutputRoot) {
  $OutputRoot = Join-Path $RepositoryRoot "dist\\agent\\windows"
}

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepositoryRoot "installers\\windows\\build-agent-bundle.ps1") -RepositoryRoot $RepositoryRoot -OutputRoot $OutputRoot

$runtimeRoot = Join-Path $OutputRoot "runtime"
$entryScript = Join-Path $runtimeRoot "src\\service.js"
$exeOutput = Join-Path $OutputRoot "InfraWatchAgent.exe"

if (Test-Path $exeOutput) {
  Remove-Item $exeOutput -Force
}

Push-Location $RepositoryRoot
try {
  npx pkg $entryScript --targets $Target --output $exeOutput
} finally {
  Pop-Location
}

[pscustomobject]@{
  executable = $exeOutput
  runtimeRoot = $runtimeRoot
  target = $Target
  exists = (Test-Path $exeOutput)
} | Format-List
