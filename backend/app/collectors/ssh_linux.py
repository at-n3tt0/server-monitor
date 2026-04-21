from __future__ import annotations

import os


class SshLinuxCollector:
    async def collect(self, host: str, binding: dict) -> dict:
        try:
            import paramiko  # type: ignore
        except Exception:
            return {
                "integration_status": "integration_pending",
                "collector_status": "dependency_missing",
                "message": "Paramiko nao esta disponivel para coleta SSH",
            }

        username = binding.get("username")
        secret_env_var = binding.get("secret_env_var")
        password = os.getenv(secret_env_var or "") if secret_env_var else None
        if not username or not password:
            return {
                "integration_status": "integration_pending",
                "collector_status": "pending_credentials",
                "message": "Credenciais SSH Linux pendentes",
            }

        service_names = binding.get("service_names", [])
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(host, username=username, password=password, timeout=8)
            commands = {
                "cpu": "LC_ALL=C top -bn1 | awk -F'[, ]+' '/Cpu\\(s\\)/ {print 100-$8}'",
                "load_average": "cat /proc/loadavg",
                "memory": "free -b | awk 'NR==2 {print $3\" \"$2}'",
                "swap": "free -b | awk 'NR==3 {print $3\" \"$2}'",
                "disks": "df -B1 --output=target,used,size / | tail -n 1",
                "uptime": "cat /proc/uptime | awk '{print $1}'",
            }
            if service_names:
                commands["services"] = "for svc in " + " ".join(service_names) + "; do printf \"%s \" \"$svc\"; systemctl is-active \"$svc\"; done"
            outputs = {}
            for key, command in commands.items():
                _, stdout, _ = client.exec_command(command)
                outputs[key] = stdout.read().decode().strip()

            mem_used, mem_total = [int(value) for value in outputs["memory"].split()]
            swap_used, swap_total = [int(value) for value in outputs["swap"].split()]
            mountpoint, disk_used, disk_total = outputs["disks"].split()
            service_lines = [line.strip() for line in outputs.get("services", "").splitlines() if line.strip()]
            services = []
            for line in service_lines:
                parts = line.split(maxsplit=1)
                if len(parts) == 2:
                    services.append({"name": parts[0], "status": parts[1]})

            return {
                "integration_status": "active",
                "collector_status": "ok",
                "message": "Coleta Linux via SSH concluida",
                "cpu_percent": float(outputs["cpu"]) if outputs["cpu"] else None,
                "memory_percent": (mem_used / mem_total) * 100 if mem_total else None,
                "memory_used_bytes": mem_used,
                "memory_total_bytes": mem_total,
                "swap_used_bytes": swap_used,
                "swap_total_bytes": swap_total,
                "uptime_seconds": float(outputs["uptime"]),
                "load_average": outputs["load_average"].split()[:3],
                "disks": [
                    {
                        "mountpoint": mountpoint,
                        "used_bytes": int(disk_used),
                        "total_bytes": int(disk_total),
                        "used_percent": (int(disk_used) / int(disk_total)) * 100 if int(disk_total) else None,
                    }
                ],
                "services": services,
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "integration_status": "collector_error",
                "collector_status": "error",
                "message": f"Falha SSH Linux: {exc}",
            }
        finally:
            client.close()
