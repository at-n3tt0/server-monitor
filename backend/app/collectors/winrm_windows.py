from __future__ import annotations

import os


class WinRMWindowsCollector:
    async def collect(self, host: str, binding: dict, service_names: list[str]) -> dict:
        try:
            import winrm  # type: ignore
        except Exception:
            return {
                "integration_status": "integration_pending",
                "collector_status": "dependency_missing",
                "message": "Biblioteca WinRM nao esta disponivel",
            }

        username = binding.get("username")
        secret_env_var = binding.get("secret_env_var")
        password = os.getenv(secret_env_var or "") if secret_env_var else None
        if not username or not password:
            return {
                "integration_status": "integration_pending",
                "collector_status": "pending_credentials",
                "message": "Credenciais WinRM pendentes",
            }

        try:
            session = winrm.Session(f"http://{host}:5985/wsman", auth=(username, password), transport="ntlm")
            script = """
$cpuSample = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$cpu = if ($cpuSample -ne $null) { [double]$cpuSample } else { $null }
$os = Get-CimInstance Win32_OperatingSystem
$disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,FreeSpace,Size
$services = @()
""" + "\n".join(
                [f"$services += (Get-Service -Name '{service}' -ErrorAction SilentlyContinue | Select-Object Name,Status)" for service in service_names]
            ) + """
$result = [pscustomobject]@{
 cpu = $cpu
 totalMemory = $os.TotalVisibleMemorySize * 1024
 freeMemory = $os.FreePhysicalMemory * 1024
 lastBoot = $os.LastBootUpTime
 disks = $disks
 services = $services
}
$result | ConvertTo-Json -Depth 4
"""
            response = session.run_ps(script)
            if response.status_code != 0:
                raise RuntimeError(response.std_err.decode(errors="ignore"))

            import json

            data = json.loads(response.std_out.decode())
            total_memory = data.get("totalMemory")
            free_memory = data.get("freeMemory")
            services = data.get("services") or []
            if isinstance(services, dict):
                services = [services]
            disks = data.get("disks") or []
            if isinstance(disks, dict):
                disks = [disks]

            return {
                "integration_status": "active",
                "collector_status": "ok",
                "message": "Coleta Windows via WinRM concluida",
                "cpu_percent": float(data.get("cpu")) if data.get("cpu") is not None else None,
                "memory_percent": ((total_memory - free_memory) / total_memory) * 100 if total_memory and free_memory is not None else None,
                "memory_used_bytes": (total_memory - free_memory) if total_memory and free_memory is not None else None,
                "memory_total_bytes": total_memory,
                "last_boot": data.get("lastBoot"),
                "windows_services": [
                    {
                        "Name": service.get("Name"),
                        "Status": "running" if service.get("Status") == 4 else str(service.get("Status")).lower(),
                    }
                    for service in services
                ],
                "disks": [
                    {
                        "mountpoint": disk.get("DeviceID"),
                        "used_bytes": (disk.get("Size") or 0) - (disk.get("FreeSpace") or 0),
                        "total_bytes": disk.get("Size"),
                        "used_percent": (((disk.get("Size") or 0) - (disk.get("FreeSpace") or 0)) / disk.get("Size") * 100) if disk.get("Size") else None,
                    }
                    for disk in disks
                ],
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "integration_status": "collector_error",
                "collector_status": "error",
                "message": f"Falha WinRM: {exc}",
            }
