from __future__ import annotations

import json
import os
import platform
import socket
import subprocess
import time
from pathlib import Path

import psutil
from fastapi import FastAPI, Header, HTTPException


CONFIG_PATH = Path(os.getenv("SERVER_MONITOR_AGENT_CONFIG", Path(__file__).with_name("config").joinpath("agent-config.json")))
TOKEN = os.getenv("SERVER_MONITOR_AGENT_TOKEN")
LISTEN_HOST = os.getenv("SERVER_MONITOR_AGENT_HOST", "0.0.0.0")
LISTEN_PORT = int(os.getenv("SERVER_MONITOR_AGENT_PORT", "9090"))


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {"services": []}
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def service_statuses(services: list[str]) -> list[dict]:
    if not services:
        return []
    if platform.system() == "Windows":
        statuses = []
        for service in services:
            result = subprocess.run(["powershell", "-NoProfile", "-Command", f"Get-Service -Name '{service}' -ErrorAction SilentlyContinue | Select-Object Name,Status | ConvertTo-Json"], capture_output=True, text=True)
            output = result.stdout.strip()
            if output:
                try:
                    parsed = json.loads(output)
                    statuses.append({"name": parsed.get("Name"), "status": str(parsed.get("Status", "")).lower()})
                except json.JSONDecodeError:
                    statuses.append({"name": service, "status": "unknown"})
            else:
                statuses.append({"name": service, "status": "unknown"})
        return statuses
    statuses = []
    for service in services:
        result = subprocess.run(["systemctl", "is-active", service], capture_output=True, text=True)
        statuses.append({"name": service, "status": result.stdout.strip() or "unknown"})
    return statuses


def collect_metrics() -> dict:
    config = load_config()
    memory = psutil.virtual_memory()
    swap = psutil.swap_memory()
    disks = []
    for partition in psutil.disk_partitions():
        try:
            usage = psutil.disk_usage(partition.mountpoint)
            disks.append(
                {
                    "mountpoint": partition.mountpoint,
                    "used_percent": usage.percent,
                    "used_bytes": usage.used,
                    "total_bytes": usage.total,
                }
            )
        except PermissionError:
            continue
    networks = []
    for name, stats in psutil.net_io_counters(pernic=True).items():
        networks.append({"interface_name": name, "rx_bytes": stats.bytes_recv, "tx_bytes": stats.bytes_sent})

    payload = {
        "hostname": socket.gethostname(),
        "os": f"{platform.system()} {platform.release()}",
        "platform": platform.platform(),
        "uptime": int(time.time() - psutil.boot_time()),
        "cpu_percent": psutil.cpu_percent(interval=0.2),
        "cpu_cores": psutil.cpu_count(logical=True),
        "memory_percent": memory.percent,
        "memory_used_bytes": memory.used,
        "memory_total_bytes": memory.total,
        "swap_used_bytes": swap.used,
        "swap_total_bytes": swap.total,
        "disks": disks,
        "networks": networks,
        "status": "up",
        "availability_percent": 100.0,
        "message": "Métricas coletadas pelo agente",
        "services": service_statuses(config.get("services", [])),
    }
    load_avg = getattr(os, "getloadavg", None)
    if callable(load_avg):
        payload["load_average"] = list(load_avg())
    return payload


app = FastAPI(title="server-monitor-agent")


@app.get("/metrics")
def metrics(authorization: str | None = Header(default=None)):
    if TOKEN:
        expected = f"Bearer {TOKEN}"
        if authorization != expected:
            raise HTTPException(status_code=401, detail="unauthorized")
    return collect_metrics()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=LISTEN_HOST, port=LISTEN_PORT)
