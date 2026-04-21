from uuid import uuid4

from sqlalchemy.orm import Session

from backend.app.models.alert import Alert
from backend.app.models.host import Host
from backend.app.repositories.alert_repository import AlertRepository
from backend.app.utils.time import utcnow


class AlertService:
    def __init__(self, db: Session) -> None:
        self.repository = AlertRepository(db)

    def _upsert_alert(
        self,
        host: Host,
        key: str,
        alert_type: str,
        severity: str,
        title: str,
        message: str,
        payload: dict | None = None,
    ) -> Alert:
        existing = self.repository.get_by_key(key)
        now = utcnow()
        alert = existing or Alert(
            id=str(uuid4()),
            host_id=host.id,
            alert_key=key,
            alert_type=alert_type,
            severity=severity,
            status="active",
            title=title,
            message=message,
            payload=payload or {},
            first_seen_at=now,
            last_seen_at=now,
        )
        alert.host_id = host.id
        alert.severity = severity
        alert.status = "active"
        alert.title = title
        alert.message = message
        alert.payload = payload or {}
        alert.last_seen_at = now
        alert.resolved_at = None
        return self.repository.save(alert)

    def _resolve_alert(self, key: str) -> Alert | None:
        existing = self.repository.get_by_key(key)
        if not existing or existing.status == "resolved":
            return None
        existing.status = "resolved"
        existing.resolved_at = utcnow()
        existing.last_seen_at = existing.resolved_at
        return self.repository.save(existing)

    def evaluate(self, host: Host, summary: dict) -> list[Alert]:
        active_changes: list[Alert] = []
        metadata = host.details or {}
        thresholds = metadata.get("thresholds", {})

        status_key = f"{host.id}:status:down"
        if summary.get("status") == "down":
            active_changes.append(
                self._upsert_alert(
                    host,
                    status_key,
                    "host_down",
                    "critical",
                    f"{host.name} offline",
                    summary.get("message") or "Host sem resposta",
                    summary,
                )
            )
        else:
            resolved = self._resolve_alert(status_key)
            if resolved:
                active_changes.append(resolved)

        latency = summary.get("latency_ms")
        if latency is not None:
            critical = float(thresholds.get("critical_latency_ms", 300))
            warning = float(thresholds.get("warning_latency_ms", 150))
            key = f"{host.id}:latency"
            if latency >= critical:
                active_changes.append(
                    self._upsert_alert(host, key, "latency", "critical", f"{host.name} com latencia critica", f"Latencia atual: {latency:.2f} ms", summary)
                )
            elif latency >= warning:
                active_changes.append(
                    self._upsert_alert(host, key, "latency", "warning", f"{host.name} com latencia alta", f"Latencia atual: {latency:.2f} ms", summary)
                )
            else:
                resolved = self._resolve_alert(key)
                if resolved:
                    active_changes.append(resolved)

        for metric_name, warning_key, critical_key, label in [
            ("cpu_percent", "cpu_usage_warning", "cpu_usage_critical", "CPU"),
            ("memory_percent", "memory_usage_warning", "memory_usage_critical", "memoria"),
            ("disk_percent", "disk_usage_warning", "disk_usage_critical", "disco"),
        ]:
            value = summary.get(metric_name)
            if value is None:
                continue
            warning = float(thresholds.get(warning_key, 80))
            critical = float(thresholds.get(critical_key, 90))
            key = f"{host.id}:{metric_name}"
            if value >= critical:
                active_changes.append(
                    self._upsert_alert(host, key, metric_name, "critical", f"{host.name} com {label} critica", f"{label} em {value:.2f}%", summary)
                )
            elif value >= warning:
                active_changes.append(
                    self._upsert_alert(host, key, metric_name, "warning", f"{host.name} com {label} alta", f"{label} em {value:.2f}%", summary)
                )
            else:
                resolved = self._resolve_alert(key)
                if resolved:
                    active_changes.append(resolved)

        for service in summary.get("service_states", []):
            key = f"{host.id}:service:{service.get('service_check_id')}"
            if service.get("status") == "down":
                active_changes.append(
                    self._upsert_alert(
                        host,
                        key,
                        "service_down",
                        "critical",
                        f"{host.name} com serviço crítico indisponível",
                        service.get("message") or "Serviço monitorado sem resposta",
                        service,
                    )
                )
            elif service.get("status") == "pending":
                active_changes.append(
                    self._upsert_alert(
                        host,
                        key,
                        "service_pending",
                        "warning",
                        f"{host.name} com integração pendente",
                        service.get("message") or "Serviço depende de integração adicional",
                        service,
                    )
                )
            else:
                resolved = self._resolve_alert(key)
                if resolved:
                    active_changes.append(resolved)

        for vm in summary.get("vms", []):
            vm_key = f"{host.id}:vm:{vm.get('vmid')}"
            if vm.get("status") not in {None, "running"}:
                active_changes.append(
                    self._upsert_alert(
                        host,
                        vm_key,
                        "vm_down",
                        "critical",
                        f"{host.name} com VM parada",
                        f"VM {vm.get('name') or vm.get('vmid')} está {vm.get('status')}",
                        vm,
                    )
                )
            else:
                resolved = self._resolve_alert(vm_key)
                if resolved:
                    active_changes.append(resolved)

        if summary.get("collector_status") in {"error", "dependency_missing"}:
            active_changes.append(
                self._upsert_alert(
                    host,
                    f"{host.id}:collector:error",
                    "collector_failure",
                    "warning",
                    f"{host.name} com falha de coleta",
                    summary.get("message") or "O coletor principal falhou",
                    summary,
                )
            )
        else:
            resolved = self._resolve_alert(f"{host.id}:collector:error")
            if resolved:
                active_changes.append(resolved)

        return active_changes
