import sqlite3
from pathlib import Path
from datetime import datetime

from sqlalchemy.orm import Session

from backend.app.models.host import Host
from backend.app.models.metric import CpuMetric, LatencyMetric, MemoryMetric, NetworkMetric
from backend.app.repositories.host_repository import HostRepository
from backend.app.utils.legacy import extract_address_from_url, has_sqlite_table, load_legacy_config
from backend.app.utils.time import utcnow


class LegacyImportService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.host_repository = HostRepository(db)

    def import_targets_from_config(self, config_path: Path) -> int:
        if self.host_repository.list():
            return 0
        config = load_legacy_config(config_path)
        imported = 0
        for target in config.get("targets", []):
            target_thresholds = target.get("thresholds") or {}
            host = Host(
                id=target["id"],
                name=target["name"],
                address=target.get("host") or extract_address_from_url(target.get("url")),
                monitor_type=target.get("type", "ping"),
                agent_endpoint=target.get("url") if target.get("type") == "agent" else None,
                agent_token=target.get("secret"),
                tcp_port=target.get("port"),
                interval_seconds=target.get("intervalSeconds", 30),
                timeout_ms=target.get("timeout", 5000),
                is_active=bool(target.get("enabled", True)),
                description=(target.get("metadata") or {}).get("notes"),
                details={
                    "thresholds": {
                        "warning_latency_ms": target_thresholds.get("warningLatencyMs", 150),
                        "critical_latency_ms": target_thresholds.get("criticalLatencyMs", 300),
                        "warning_packet_loss": target_thresholds.get("warningPacketLoss", 10),
                        "critical_packet_loss": target_thresholds.get("criticalPacketLoss", 30),
                        "cpu_usage_warning": target_thresholds.get("cpuUsageWarning", 80),
                        "cpu_usage_critical": target_thresholds.get("cpuUsageCritical", 90),
                        "memory_usage_warning": target_thresholds.get("memoryUsageWarning", 80),
                        "memory_usage_critical": target_thresholds.get("memoryUsageCritical", 90),
                        "disk_usage_warning": target_thresholds.get("diskUsageWarning", 85),
                        "disk_usage_critical": target_thresholds.get("diskUsageCritical", 95),
                    },
                    **(target.get("metadata") or {}),
                },
                created_at=utcnow(),
                updated_at=utcnow(),
            )
            self.db.add(host)
            imported += 1
        self.db.commit()
        return imported

    def import_history_from_sqlite(self, sqlite_path: Path) -> dict:
        if not sqlite_path.exists():
            return {"cpu": 0, "memory": 0, "latency": 0, "network": 0}
        if self.db.query(CpuMetric.id).first() or self.db.query(LatencyMetric.id).first():
            return {"cpu": 0, "memory": 0, "latency": 0, "network": 0}

        counters = {"cpu": 0, "memory": 0, "latency": 0, "network": 0}
        with sqlite3.connect(sqlite_path) as connection:
            if has_sqlite_table(sqlite_path, "agent_metrics"):
                for row in connection.execute(
                    "SELECT target_id, cpu_usage, cpu_cores, memory_used_percent, memory_used, memory_total, collected_at FROM agent_metrics"
                ):
                    host_id, cpu_usage, cpu_cores, mem_percent, mem_used, mem_total, collected_at = row
                    recorded_at = datetime.fromisoformat(str(collected_at).replace("Z", "+00:00"))
                    self.db.add(CpuMetric(host_id=host_id, usage_percent=cpu_usage, cores=cpu_cores, recorded_at=recorded_at))
                    self.db.add(MemoryMetric(host_id=host_id, used_percent=mem_percent, used_bytes=mem_used, total_bytes=mem_total, recorded_at=recorded_at))
                    counters["cpu"] += 1
                    counters["memory"] += 1

            if has_sqlite_table(sqlite_path, "check_results"):
                for row in connection.execute("SELECT target_id, latency_ms, packet_loss, availability, checked_at FROM check_results"):
                    host_id, latency_ms, packet_loss, availability, checked_at = row
                    recorded_at = datetime.fromisoformat(str(checked_at).replace("Z", "+00:00"))
                    self.db.add(
                        LatencyMetric(
                            host_id=host_id,
                            latency_ms=latency_ms,
                            packet_loss_percent=packet_loss,
                            availability_percent=availability,
                            source="legacy",
                            recorded_at=recorded_at,
                        )
                    )
                    counters["latency"] += 1

            if has_sqlite_table(sqlite_path, "network_metrics"):
                for row in connection.execute(
                    "SELECT target_id, interface_name, rx_bytes, tx_bytes, rx_rate, tx_rate, collected_at FROM network_metrics"
                ):
                    host_id, interface_name, rx_bytes, tx_bytes, rx_rate, tx_rate, recorded_at = row
                    parsed_at = datetime.fromisoformat(str(recorded_at).replace("Z", "+00:00"))
                    self.db.add(
                        NetworkMetric(
                            host_id=host_id,
                            interface_name=interface_name,
                            rx_bytes=rx_bytes,
                            tx_bytes=tx_bytes,
                            rx_rate=rx_rate,
                            tx_rate=tx_rate,
                            recorded_at=parsed_at,
                        )
                    )
                    counters["network"] += 1

        self.db.commit()
        return counters
