from __future__ import annotations

import os

import httpx


class ProxmoxCollector:
    async def collect(self, endpoint: str, node_name: str, token_id: str | None, secret_env_var: str | None, verify_tls: bool = False) -> dict:
        secret = os.getenv(secret_env_var or "") if secret_env_var else None
        if not endpoint or not node_name or not token_id or not secret:
            return {
                "integration_status": "integration_pending",
                "collector_status": "pending_credentials",
                "message": "Credenciais/API do Proxmox não configuradas",
            }

        headers = {"Authorization": f"PVEAPIToken={token_id}={secret}"}
        try:
            async with httpx.AsyncClient(base_url=endpoint.rstrip("/"), verify=verify_tls, timeout=10.0, headers=headers) as client:
                status_response = await client.get(f"/api2/json/nodes/{node_name}/status")
                qemu_response = await client.get(f"/api2/json/nodes/{node_name}/qemu")
                storage_response = await client.get(f"/api2/json/nodes/{node_name}/storage")
            status_response.raise_for_status()
            qemu_response.raise_for_status()
            storage_response.raise_for_status()
            node = status_response.json().get("data", {})
            vms = qemu_response.json().get("data", [])
            storages = storage_response.json().get("data", [])
            cpu = (node.get("cpu") or 0) * 100
            memory_total = node.get("memory", {}).get("total")
            memory_used = node.get("memory", {}).get("used")
            memory_percent = ((memory_used / memory_total) * 100) if memory_total and memory_used is not None else None
            swap_total = node.get("swap", {}).get("total")
            swap_used = node.get("swap", {}).get("used")
            loadavg = node.get("loadavg", [])
            return {
                "integration_status": "active",
                "collector_status": "ok",
                "message": "Coleta Proxmox via API concluída",
                "cpu_percent": cpu,
                "memory_percent": memory_percent,
                "memory_used_bytes": memory_used,
                "memory_total_bytes": memory_total,
                "swap_used_bytes": swap_used,
                "swap_total_bytes": swap_total,
                "load_average": loadavg,
                "uptime_seconds": node.get("uptime"),
                "vms": [
                    {
                        "vmid": vm.get("vmid"),
                        "name": vm.get("name"),
                        "status": vm.get("status"),
                        "cpus": vm.get("cpus"),
                        "maxmem": vm.get("maxmem"),
                    }
                    for vm in vms
                ],
                "storages": [
                    {
                        "storage": storage.get("storage"),
                        "type": storage.get("type"),
                        "used": storage.get("used"),
                        "total": storage.get("total"),
                        "avail": storage.get("avail"),
                    }
                    for storage in storages
                ],
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "integration_status": "collector_error",
                "collector_status": "error",
                "message": f"Falha ao consultar Proxmox API: {exc}",
            }
