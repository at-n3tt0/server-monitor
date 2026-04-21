from __future__ import annotations

import asyncio
import os
from contextlib import suppress

from sqlalchemy.orm import Session

from backend.app.collectors.agent import AgentCollector
from backend.app.collectors.http_health import HttpHealthCollector
from backend.app.collectors.local import LocalCollector
from backend.app.collectors.ping import PingCollector
from backend.app.collectors.proxmox import ProxmoxCollector
from backend.app.collectors.ssh_routeros import SshRouterOsCollector
from backend.app.collectors.ssh_linux import SshLinuxCollector
from backend.app.collectors.tcp import TcpCollector
from backend.app.collectors.winrm_windows import WinRMWindowsCollector
from backend.app.models.host import Host
from backend.app.models.metric import CpuMetric, DiskMetric, HostStatusMetric, LatencyMetric, MemoryMetric, NetworkMetric
from backend.app.models.monitoring import HostCollectionState, ServiceCheckResult
from backend.app.repositories.host_repository import HostRepository
from backend.app.repositories.metric_repository import MetricRepository
from backend.app.repositories.monitoring_repository import MonitoringRepository
from backend.app.services.alert_service import AlertService
from backend.app.services.dashboard_service import DashboardService
from backend.app.utils.time import utcnow
from backend.app.websocket.manager import WebSocketManager


class MonitoringService:
    def __init__(self, db_factory, websocket_manager: WebSocketManager) -> None:
        self.db_factory = db_factory
        self.websocket_manager = websocket_manager
        self.local_collector = LocalCollector()
        self.ping_collector = PingCollector()
        self.agent_collector = AgentCollector()
        self.http_collector = HttpHealthCollector()
        self.tcp_collector = TcpCollector()
        self.proxmox_collector = ProxmoxCollector()
        self.routeros_collector = SshRouterOsCollector()
        self.ssh_linux_collector = SshLinuxCollector()
        self.winrm_windows_collector = WinRMWindowsCollector()
        self.task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        self._running = True
        if self.task is None:
            self.task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._running = False
        if self.task is not None:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task
            self.task = None

    async def _loop(self) -> None:
        while self._running:
            db = self.db_factory()
            try:
                hosts = HostRepository(db).active()
                for host in hosts:
                    await self.run_host_collection(host.id)
            finally:
                db.close()
            await asyncio.sleep(15)

    async def run_host_collection(self, host_id: str) -> None:
        db: Session = self.db_factory()
        try:
            host = HostRepository(db).get(host_id)
            if not host or not host.is_active:
                return

            monitoring_repository = MonitoringRepository(db)
            metric_repository = MetricRepository(db)
            alert_service = AlertService(db)

            summary = await self._collect(host, monitoring_repository, metric_repository)
            alert_service.evaluate(host, summary)
            host.last_seen_at = utcnow()
            host.last_status = summary.get("status")
            host.integration_status = summary.get("integration_status", host.integration_status)
            host.last_error = summary.get("message") if summary.get("status") in {"down", "error"} else None
            db.add(host)
            db.commit()

            dashboard = DashboardService(db).bootstrap({"username": "collector", "role": "system"})
            await self.websocket_manager.broadcast("dashboard.bootstrap", dashboard.model_dump(mode="json"))
        finally:
            db.close()

    async def _collect(self, host: Host, monitoring_repository: MonitoringRepository, metric_repository: MetricRepository) -> dict:
        collector_payload = await self._run_collectors(host, monitoring_repository)
        now = collector_payload.get("recorded_at", utcnow())
        checks_by_id = {check.id: check for check in monitoring_repository.list_host_service_checks(host.id)}
        service_results = await self._run_service_checks(host, monitoring_repository, now)
        discovered_services = self._build_discovered_service_states(collector_payload)
        services_up = len([result for result in service_results if result.status == "up"])
        status = collector_payload.get("status", "unknown")
        message = collector_payload.get("message")
        if status == "down" and services_up > 0:
            status = "degraded"
            message = "ICMP sem resposta, mas há serviços acessíveis por checagem passiva."
        if any(result.status == "down" and result.message for result in service_results if result.status == "down") and status == "up":
            status = "degraded"
        if any(service.get("status") not in {"up", "running", "active"} for service in discovered_services) and status == "up":
            status = "degraded"

        metric_items = [
            HostStatusMetric(
                host_id=host.id,
                status=status,
                is_available=status == "up",
                message=message,
                recorded_at=now,
            ),
            LatencyMetric(
                host_id=host.id,
                latency_ms=collector_payload.get("latency_ms"),
                packet_loss_percent=collector_payload.get("packet_loss_percent"),
                availability_percent=collector_payload.get("availability_percent"),
                source=collector_payload.get("collector_name") or host.collector_type or host.monitor_type,
                recorded_at=now,
            ),
        ]

        if collector_payload.get("cpu_percent") is not None:
            metric_items.append(CpuMetric(host_id=host.id, usage_percent=collector_payload.get("cpu_percent"), cores=collector_payload.get("cpu_cores"), recorded_at=now))
        if collector_payload.get("memory_percent") is not None:
            metric_items.append(
                MemoryMetric(
                    host_id=host.id,
                    used_percent=collector_payload.get("memory_percent"),
                    used_bytes=collector_payload.get("memory_used_bytes"),
                    total_bytes=collector_payload.get("memory_total_bytes"),
                    recorded_at=now,
                )
            )

        disks = collector_payload.get("disks", []) or []
        if collector_payload.get("storages"):
            for storage in collector_payload.get("storages", []):
                total = storage.get("total")
                used = storage.get("used")
                disks.append(
                    {
                        "mountpoint": storage.get("storage"),
                        "used_bytes": used,
                        "total_bytes": total,
                        "used_percent": (used / total * 100) if total and used is not None else None,
                    }
                )
        for disk in disks:
            metric_items.append(
                DiskMetric(
                    host_id=host.id,
                    mountpoint=disk.get("mountpoint"),
                    used_percent=disk.get("used_percent"),
                    used_bytes=disk.get("used_bytes"),
                    total_bytes=disk.get("total_bytes"),
                    recorded_at=now,
                )
            )

        previous_rows = metric_repository.get_series(NetworkMetric, host.id, limit=16)
        previous_by_interface = {row.interface_name: row for row in previous_rows if row.interface_name}
        for network in collector_payload.get("networks", []) or []:
            previous = previous_by_interface.get(network.get("interface_name"))
            rx_rate = network.get("rx_rate")
            tx_rate = network.get("tx_rate")
            if previous and rx_rate is None and tx_rate is None and previous.rx_bytes is not None and previous.tx_bytes is not None:
                seconds = max((now - previous.recorded_at).total_seconds(), 1)
                if network.get("rx_bytes") is not None:
                    rx_rate = max((network.get("rx_bytes") - previous.rx_bytes) / seconds, 0)
                if network.get("tx_bytes") is not None:
                    tx_rate = max((network.get("tx_bytes") - previous.tx_bytes) / seconds, 0)
            metric_items.append(
                NetworkMetric(
                    host_id=host.id,
                    interface_name=network.get("interface_name"),
                    rx_bytes=network.get("rx_bytes"),
                    tx_bytes=network.get("tx_bytes"),
                    rx_rate=rx_rate,
                    tx_rate=tx_rate,
                    recorded_at=now,
                )
            )

        metric_repository.add_batch(metric_items)
        monitoring_repository.save_service_results(service_results)
        monitoring_repository.upsert_collection_state(
            HostCollectionState(
                host_id=host.id,
                collector_name=collector_payload.get("collector_name"),
                collector_status=collector_payload.get("collector_status", "ok"),
                integration_status=collector_payload.get("integration_status", "active"),
                message=collector_payload.get("message"),
                payload={
                    key: value
                    for key, value in collector_payload.items()
                    if key not in {"cpu_percent", "memory_percent", "memory_used_bytes", "memory_total_bytes", "latency_ms", "packet_loss_percent", "availability_percent", "recorded_at"}
                },
                last_collection_at=now,
            )
        )

        latest_disk = max((disk.get("used_percent") or 0 for disk in disks), default=None) if disks else None
        networks = collector_payload.get("networks", []) or []
        latest_network = networks[-1] if networks else None
        services_total = len(service_results)

        return {
            "status": status,
            "latency_ms": collector_payload.get("latency_ms"),
            "packet_loss_percent": collector_payload.get("packet_loss_percent"),
            "availability_percent": collector_payload.get("availability_percent"),
            "message": message,
            "cpu_percent": collector_payload.get("cpu_percent"),
            "memory_percent": collector_payload.get("memory_percent"),
            "disk_percent": latest_disk,
            "rx_rate": latest_network.get("rx_rate") if latest_network else None,
            "tx_rate": latest_network.get("tx_rate") if latest_network else None,
            "integration_status": collector_payload.get("integration_status", "active"),
            "services_ok": services_up,
            "services_total": services_total,
            "service_states": [
                {
                    "service_check_id": result.service_check_id,
                    "name": checks_by_id.get(result.service_check_id).display_name if checks_by_id.get(result.service_check_id) else None,
                    "status": result.status,
                    "message": result.message,
                }
                for result in service_results
            ] + discovered_services,
            "vms": collector_payload.get("vms", []),
            "collector_status": collector_payload.get("collector_status"),
        }

    async def _run_collectors(self, host: Host, monitoring_repository: MonitoringRepository) -> dict:
        collector_bindings = monitoring_repository.list_host_collectors(host.id)
        credentials = monitoring_repository.list_host_credentials(host.id)
        creds_by_method = {binding.auth_method: binding for binding in credentials}

        for binding in collector_bindings:
            collector_type = binding.collector_type
            if collector_type == "agent" and host.agent_endpoint:
                agent_credential = creds_by_method.get("agent_token")
                token = host.agent_token or (os.getenv(agent_credential.secret_env_var) if agent_credential and agent_credential.secret_env_var else None)
                try:
                    payload = await self.agent_collector.collect(host.agent_endpoint, token, host.timeout_ms)
                    payload.update({"collector_name": "agent", "collector_status": "ok", "integration_status": "active"})
                    return payload
                except Exception as exc:  # noqa: BLE001
                    last_error = f"Falha ao consultar agente: {exc}"
                    binding.last_error = last_error
            elif collector_type == "proxmox_api":
                proxmox_credential = creds_by_method.get("proxmox_api_token")
                details = host.details.get("proxmox", {}) if isinstance(host.details, dict) else {}
                token_id = os.getenv(proxmox_credential.details.get("token_id_env_var", ""), "") if proxmox_credential and proxmox_credential.details else ""
                payload = await self.proxmox_collector.collect(
                    endpoint=(proxmox_credential.endpoint if proxmox_credential else None) or details.get("endpoint"),
                    node_name=details.get("node_name"),
                    token_id=token_id or None,
                    secret_env_var=proxmox_credential.secret_env_var if proxmox_credential else None,
                    verify_tls=bool(details.get("verify_tls", False)),
                )
                payload.setdefault("collector_name", "proxmox_api")
                if payload.get("integration_status") == "active":
                    payload.setdefault("status", "up")
                    payload.setdefault("availability_percent", 100.0)
                    return payload
            elif collector_type == "ssh_linux":
                ssh_credential = creds_by_method.get("ssh_password") or creds_by_method.get("ssh_key")
                payload = await self.ssh_linux_collector.collect(
                    host.address or host.hostname or host.name,
                    {
                        "username": ssh_credential.username if ssh_credential else None,
                        "secret_env_var": ssh_credential.secret_env_var if ssh_credential else None,
                        "ssh_key_path": ssh_credential.ssh_key_path if ssh_credential else None,
                        "service_names": binding.config.get("service_names", []),
                    },
                )
                payload.setdefault("collector_name", "ssh_linux")
                if payload.get("integration_status") == "active":
                    payload.setdefault("status", "up")
                    payload.setdefault("availability_percent", 100.0)
                    return payload
            elif collector_type == "ssh_routeros":
                ssh_credential = creds_by_method.get("ssh_password")
                payload = await self.routeros_collector.collect(
                    host.address or host.hostname or host.name,
                    {
                        "username": ssh_credential.username if ssh_credential else None,
                        "secret_env_var": ssh_credential.secret_env_var if ssh_credential else None,
                    },
                )
                payload.setdefault("collector_name", "ssh_routeros")
                if payload.get("integration_status") == "active":
                    payload.setdefault("status", "up")
                    payload.setdefault("availability_percent", 100.0)
                    return payload
            elif collector_type == "winrm_windows":
                winrm_credential = creds_by_method.get("winrm_ntlm")
                service_names = binding.config.get("service_names", [])
                payload = await self.winrm_windows_collector.collect(
                    host.address or host.hostname or host.name,
                    {
                        "username": winrm_credential.username if winrm_credential else None,
                        "secret_env_var": winrm_credential.secret_env_var if winrm_credential else None,
                    },
                    service_names,
                )
                payload.setdefault("collector_name", "winrm_windows")
                if payload.get("integration_status") == "active":
                    payload.setdefault("status", "up")
                    payload.setdefault("availability_percent", 100.0)
                    return payload
            elif collector_type == "ping":
                payload = await self.ping_collector.collect(host.address or host.hostname or host.name, host.timeout_ms)
                payload.update({"collector_name": "ping", "collector_status": "ok"})
                if host.collector_type in {"windows_agent", "linux_agent", "proxmox_api", "ssh_linux", "winrm_windows", "infrawatch_agent"}:
                    payload["integration_status"] = "integration_pending"
                    payload["message"] = "Coleta passiva ativa; integração profunda ainda pendente."
                else:
                    payload["integration_status"] = "active"
                return payload

        return {
            "recorded_at": utcnow(),
            "status": "unknown",
            "availability_percent": None,
            "collector_name": host.collector_type or host.monitor_type,
            "collector_status": "idle",
            "integration_status": "integration_pending",
            "message": "Nenhum coletor ativo disponível",
        }

    async def _run_service_checks(self, host: Host, monitoring_repository: MonitoringRepository, now) -> list[ServiceCheckResult]:
        checks = monitoring_repository.list_host_service_checks(host.id)
        results: list[ServiceCheckResult] = []
        for check in checks:
            if check.check_type == "tcp" and check.target and check.port:
                payload = await self.tcp_collector.collect(check.target, check.port, host.timeout_ms)
            elif check.check_type == "http" and check.target:
                payload = await self.http_collector.collect(check.target, host.timeout_ms)
            else:
                payload = {"status": "pending", "message": "Check depende de integração de agente/coletor remoto", "response_time_ms": None}

            results.append(
                ServiceCheckResult(
                    service_check_id=check.id,
                    host_id=host.id,
                    status=payload.get("status", "unknown"),
                    message=payload.get("message"),
                    response_time_ms=payload.get("response_time_ms"),
                    details={key: value for key, value in payload.items() if key not in {"status", "message", "response_time_ms"}},
                    recorded_at=now,
                )
            )
        return results

    def _build_discovered_service_states(self, collector_payload: dict) -> list[dict]:
        service_states: list[dict] = []
        for service in collector_payload.get("windows_services", []) or []:
            state = str(service.get("Status") or service.get("status") or "unknown").lower()
            service_states.append(
                {
                    "service_check_id": None,
                    "name": service.get("Name") or service.get("name"),
                    "status": "up" if state in {"running", "active"} else "down" if state in {"stopped", "inactive", "failed"} else state,
                    "message": f"Estado reportado pelo coletor: {state}",
                }
            )
        for service in collector_payload.get("services", []) or []:
            state = str(service.get("status") or "unknown").lower()
            service_states.append(
                {
                    "service_check_id": None,
                    "name": service.get("name"),
                    "status": "up" if state in {"running", "active"} else "down" if state in {"stopped", "inactive", "failed"} else state,
                    "message": f"Estado reportado pelo agente: {state}",
                }
            )
        for service_name in collector_payload.get("service_samples", []) or []:
            state = str(service_name).lower()
            service_states.append(
                {
                    "service_check_id": None,
                    "name": service_name,
                    "status": "up" if state in {"running", "active"} else state,
                    "message": "Estado bruto retornado pela coleta remota",
                }
            )
        return service_states
