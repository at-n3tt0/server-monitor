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

$packageVersion = (Get-Content (Join-Path $RepositoryRoot "package.json") -Raw | ConvertFrom-Json).version

function Get-IsccPath {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "${env:LOCALAPPDATA}\Programs\Inno Setup 6\ISCC.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }

  if ($candidates -is [string]) {
    return $candidates
  }

  if ($candidates.Count -gt 0) {
    return $candidates[0]
  }

  throw "ISCC.exe nao encontrado. Instale o Inno Setup 6 para compilar o setup."
}

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepositoryRoot "packaging\\windows\\build-agent-exe.ps1") -RepositoryRoot $RepositoryRoot -OutputRoot $OutputRoot

$isccPath = Get-IsccPath
$issPath = Join-Path $RepositoryRoot "installers\\windows\\inno\\InfraWatchAgentSetup.iss"
$compileCommand = "& '" + $isccPath + "' '/DMyAppVersion=" + $packageVersion + "' '" + $issPath + "'"

$compile = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-Command", $compileCommand) -Wait -PassThru -NoNewWindow
if ($compile.ExitCode -ne 0) {
  throw "Falha ao compilar o setup com Inno Setup. ExitCode=$($compile.ExitCode)"
}

$setupPath = Join-Path $OutputRoot "InfraWatchAgentSetup.exe"

[pscustomobject]@{
  setup = $setupPath
  exists = (Test-Path $setupPath)
  iscc = $isccPath
} | Format-List
