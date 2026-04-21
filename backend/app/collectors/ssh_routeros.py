from __future__ import annotations

import os
import re


RESOURCE_PATTERNS = {
    "version": re.compile(r"version:\s+(.+)", re.IGNORECASE),
    "board_name": re.compile(r"board-name:\s+(.+)", re.IGNORECASE),
    "cpu": re.compile(r"cpu:\s+(.+)", re.IGNORECASE),
    "cpu_count": re.compile(r"cpu-count:\s+(\d+)", re.IGNORECASE),
    "cpu_load": re.compile(r"cpu-load:\s+(\d+)%", re.IGNORECASE),
    "free_memory": re.compile(r"free-memory:\s+([\d.]+)MiB", re.IGNORECASE),
    "total_memory": re.compile(r"total-memory:\s+([\d.]+)MiB", re.IGNORECASE),
}


class SshRouterOsCollector:
    async def collect(self, host: str, binding: dict) -> dict:
        try:
            import paramiko  # type: ignore
        except Exception:
            return {
                "integration_status": "integration_pending",
                "collector_status": "dependency_missing",
                "message": "Paramiko nao esta disponivel para coleta RouterOS via SSH",
            }

        username = binding.get("username")
        secret_env_var = binding.get("secret_env_var")
        password = os.getenv(secret_env_var or "") if secret_env_var else None
        if not username or not password:
            return {
                "integration_status": "integration_pending",
                "collector_status": "pending_credentials",
                "message": "Credenciais SSH RouterOS pendentes",
            }

        commands = {
            "resource": "/system resource print",
            "interfaces": "/interface print stats without-paging",
            "dns": "/ip dns print",
            "snmp": "/snmp print",
            "services": "/ip service print detail without-paging",
        }

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            client.connect(host, username=username, password=password, timeout=8, banner_timeout=8, auth_timeout=8, look_for_keys=False, allow_agent=False)
            outputs: dict[str, str] = {}
            for key, command in commands.items():
                _, stdout, _ = client.exec_command(command, timeout=20)
                outputs[key] = stdout.read().decode("utf-8", "replace")

            cpu_percent = self._find_number(outputs["resource"], RESOURCE_PATTERNS["cpu_load"])
            cpu_count = self._find_number(outputs["resource"], RESOURCE_PATTERNS["cpu_count"])
            free_memory_mib = self._find_number(outputs["resource"], RESOURCE_PATTERNS["free_memory"])
            total_memory_mib = self._find_number(outputs["resource"], RESOURCE_PATTERNS["total_memory"])
            memory_used_mib = (total_memory_mib - free_memory_mib) if total_memory_mib is not None and free_memory_mib is not None else None

            networks = self._parse_interface_stats(outputs["interfaces"])
            services = self._parse_routeros_services(outputs["services"], outputs["dns"], outputs["snmp"])

            return {
                "integration_status": "active",
                "collector_status": "ok",
                "message": "Coleta RouterOS via SSH concluida",
                "cpu_percent": cpu_percent,
                "cpu_cores": int(cpu_count) if cpu_count is not None else None,
                "memory_percent": ((memory_used_mib / total_memory_mib) * 100) if memory_used_mib is not None and total_memory_mib else None,
                "memory_used_bytes": int(memory_used_mib * 1024 * 1024) if memory_used_mib is not None else None,
                "memory_total_bytes": int(total_memory_mib * 1024 * 1024) if total_memory_mib is not None else None,
                "networks": networks,
                "services": services,
                "routeros": {
                    "version": self._find_text(outputs["resource"], RESOURCE_PATTERNS["version"]),
                    "board_name": self._find_text(outputs["resource"], RESOURCE_PATTERNS["board_name"]),
                    "cpu": self._find_text(outputs["resource"], RESOURCE_PATTERNS["cpu"]),
                },
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "integration_status": "collector_error",
                "collector_status": "error",
                "message": f"Falha SSH RouterOS: {exc}",
            }
        finally:
            client.close()

    def _find_text(self, text: str, pattern: re.Pattern[str]) -> str | None:
        match = pattern.search(text)
        return match.group(1).strip() if match else None

    def _find_number(self, text: str, pattern: re.Pattern[str]) -> float | None:
        match = pattern.search(text)
        if not match:
            return None
        return float(match.group(1))

    def _parse_interface_stats(self, text: str) -> list[dict]:
        networks: list[dict] = []
        for raw_line in text.splitlines():
            line = " ".join(raw_line.split())
            if not line or line.startswith("Flags:") or line.startswith("Columns:") or line.startswith(";;;"):
                continue
            match = re.match(r"^\d+\s+(?:R\s+)?([A-Za-z0-9_.:+\\-]+)\s+([\d ]+)\s+([\d ]+)\s+[\d ]+$", line)
            if not match:
                continue
            interface_name = match.group(1)
            rx_bytes = int(match.group(2).replace(" ", ""))
            tx_bytes = int(match.group(3).replace(" ", ""))
            networks.append(
                {
                    "interface_name": interface_name,
                    "rx_bytes": rx_bytes,
                    "tx_bytes": tx_bytes,
                    "rx_rate": None,
                    "tx_rate": None,
                }
            )
        return networks

    def _parse_routeros_services(self, services_text: str, dns_text: str, snmp_text: str) -> list[dict]:
        services: list[dict] = []
        for raw_line in services_text.splitlines():
            line = " ".join(raw_line.split())
            if 'name="' not in line:
                continue
            name_match = re.search(r'name="([^"]+)"', line)
            disabled = line.startswith("X ") or " X " in raw_line[:3]
            if name_match:
                services.append({"name": f"service:{name_match.group(1)}", "status": "disabled" if disabled else "running"})

        dns_enabled = re.search(r"allow-remote-requests:\s+yes", dns_text, re.IGNORECASE)
        services.append({"name": "dns_remote_requests", "status": "running" if dns_enabled else "disabled"})

        snmp_enabled = re.search(r"enabled:\s+yes", snmp_text, re.IGNORECASE)
        services.append({"name": "snmp", "status": "running" if snmp_enabled else "disabled"})
        return services
