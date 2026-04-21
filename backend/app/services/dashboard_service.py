from sqlalchemy.orm import Session

from backend.app.models.host import Host
from backend.app.models.metric import CpuMetric, DiskMetric, HostStatusMetric, LatencyMetric, MemoryMetric, NetworkMetric
from backend.app.repositories.alert_repository import AlertRepository
from backend.app.repositories.host_repository import HostRepository
from backend.app.repositories.metric_repository import MetricRepository
from backend.app.repositories.monitoring_repository import MonitoringRepository
from backend.app.schemas.dashboard import DashboardBootstrap, HostDashboardSummary
from backend.app.schemas.metric import CurrentMetricSummary, MetricPoint
from backend.app.utils.time import utcnow


class DashboardService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.host_repository = HostRepository(db)
        self.metric_repository = MetricRepository(db)
        self.alert_repository = AlertRepository(db)
        self.monitoring_repository = MonitoringRepository(db)

    def _map_series(self, rows, value_attr: str, secondary_attr: str | None = None, label_attr: str | None = None) -> list[MetricPoint]:
        items: list[MetricPoint] = []
        for row in rows:
            items.append(
                MetricPoint(
                    recorded_at=row.recorded_at,
                    value=getattr(row, value_attr, None),
                    value_secondary=getattr(row, secondary_attr, None) if secondary_attr else None,
                    label=getattr(row, label_attr, None) if label_attr else None,
                )
            )
        return items

    def get_current_summary(self, host_id: str) -> CurrentMetricSummary:
        cpu = self.metric_repository.get_latest(CpuMetric, host_id)
        memory = self.metric_repository.get_latest(MemoryMetric, host_id)
        latency = self.metric_repository.get_latest(LatencyMetric, host_id)
        status = self.metric_repository.get_latest(HostStatusMetric, host_id)
        networks = self.metric_repository.get_series(NetworkMetric, host_id, limit=8)
        disk_rows = self.metric_repository.get_series(DiskMetric, host_id, limit=24)
        latest_disks = [row for row in disk_rows if disk_rows and row.recorded_at == disk_rows[-1].recorded_at]
        disk_percent = max((row.used_percent or 0) for row in latest_disks) if latest_disks else None
        latest_network = networks[-1] if networks else None
        collection_state = self.monitoring_repository.get_collection_state(host_id)
        service_results = self.monitoring_repository.list_latest_service_results(host_id)
        service_states = [
            {
                "service_key": key,
                "status": value.status,
                "message": value.message,
                "response_time_ms": value.response_time_ms,
                "recorded_at": value.recorded_at,
            }
            for key, value in sorted(service_results.items())
        ]
        payload = collection_state.payload if collection_state else {}
        payload_services = payload.get("services", []) if isinstance(payload, dict) else []
        payload_windows_services = payload.get("windows_services", []) if isinstance(payload, dict) else []
        payload_recorded_at = collection_state.last_collection_at if collection_state else None
        for service in payload_services:
            name = service.get("name")
            if not name:
                continue
            status_value = str(service.get("status") or "unknown").lower()
            service_states.append(
                {
                    "service_key": name,
                    "status": "up" if status_value in {"running", "active", "up"} else "down" if status_value in {"stopped", "inactive", "failed", "down"} else status_value,
                    "message": f"Estado reportado pela coleta remota: {status_value}",
                    "response_time_ms": None,
                    "recorded_at": payload_recorded_at,
                }
            )
        for service in payload_windows_services:
            name = service.get("Name") or service.get("name")
            if not name:
                continue
            status_value = str(service.get("Status") or service.get("status") or "unknown").lower()
            service_states.append(
                {
                    "service_key": name,
                    "status": "up" if status_value in {"running", "active", "up"} else "down" if status_value in {"stopped", "inactive", "failed", "down"} else status_value,
                    "message": f"Estado reportado pelo coletor Windows: {status_value}",
                    "response_time_ms": None,
                    "recorded_at": payload_recorded_at,
                }
            )
        vm_states = payload.get("vms", []) if isinstance(payload, dict) else []

        return CurrentMetricSummary(
            cpu_percent=cpu.usage_percent if cpu else None,
            memory_percent=memory.used_percent if memory else None,
            disk_percent=disk_percent,
            latency_ms=latency.latency_ms if latency else None,
            packet_loss_percent=latency.packet_loss_percent if latency else None,
            rx_rate=latest_network.rx_rate if latest_network else None,
            tx_rate=latest_network.tx_rate if latest_network else None,
            status=status.status if status else None,
            availability_percent=latency.availability_percent if latency else None,
            last_seen_at=status.recorded_at if status else None,
            message=status.message if status else None,
            collector_status=collection_state.collector_status if collection_state else None,
            integration_status=collection_state.integration_status if collection_state else None,
            collector_name=collection_state.collector_name if collection_state else None,
            vm_count=len(vm_states),
            vm_running=len([vm for vm in vm_states if vm.get("status") == "running"]),
            services_ok=len([item for item in service_states if item["status"] == "up"]),
            services_total=len(service_states),
            service_states=service_states,
            collection_payload=payload if isinstance(payload, dict) else {},
        )

    def _build_host_summary(self, host: Host) -> HostDashboardSummary:
        return HostDashboardSummary(
            host=host,
            current=self.get_current_summary(host.id),
            cpu_series=self._map_series(self.metric_repository.get_series(CpuMetric, host.id), "usage_percent"),
            memory_series=self._map_series(self.metric_repository.get_series(MemoryMetric, host.id), "used_percent"),
            latency_series=self._map_series(self.metric_repository.get_series(LatencyMetric, host.id), "latency_ms"),
            traffic_series=self._map_series(self.metric_repository.get_series(NetworkMetric, host.id), "rx_rate", "tx_rate", "interface_name"),
            disk_series=self._map_series(self.metric_repository.get_series(DiskMetric, host.id), "used_percent", None, "mountpoint"),
        )

    def bootstrap(self, user: dict) -> DashboardBootstrap:
        return DashboardBootstrap(
            generated_at=utcnow(),
            user=user,
            hosts=[self._build_host_summary(host) for host in self.host_repository.list()],
            alerts=self.alert_repository.list_recent(100),
        )
