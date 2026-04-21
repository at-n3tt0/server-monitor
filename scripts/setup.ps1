$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
}

try {
  docker version | Out-Null
} catch {
  Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  Start-Sleep -Seconds 20
}

docker compose up -d postgres

python -m pip install -r backend/requirements.txt
npm install --prefix frontend

Start-Sleep -Seconds 5
python -m alembic -c backend/alembic.ini upgrade head
