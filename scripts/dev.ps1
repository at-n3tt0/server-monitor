$ErrorActionPreference = "Stop"

$python = (Get-Command python).Source
$npm = (Get-Command npm.cmd).Source

Start-Process -FilePath $python -ArgumentList "-m","uvicorn","backend.app.main:app","--host","0.0.0.0","--port","8010","--reload" -WorkingDirectory $PWD
Start-Process -FilePath $npm -ArgumentList "run","dev","--prefix","frontend","--","--host","0.0.0.0" -WorkingDirectory $PWD

Write-Host "Backend em http://localhost:8010"
Write-Host "Frontend em http://localhost:5173"
