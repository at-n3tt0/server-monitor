from datetime import datetime

from pydantic import BaseModel, Field


class MetricPoint(BaseModel):
    recorded_at: datetime
    value: float | None = None
    value_secondary: float | None = None
    label: str | None = None


class CurrentMetricSummary(BaseModel):
    cpu_percent: float | None = None
    memory_percent: float | None = None
    disk_percent: float | None = None
    latency_ms: float | None = None
    packet_loss_percent: float | None = None
    rx_rate: float | None = None
    tx_rate: float | None = None
    status: str | None = None
    availability_percent: float | None = None
    last_seen_at: datetime | None = None
    message: str | None = None
    collector_status: str | None = None
    integration_status: str | None = None
    collector_name: str | None = None
    vm_count: int | None = None
    vm_running: int | None = None
    services_ok: int | None = None
    services_total: int | None = None
    service_states: list[dict] = Field(default_factory=list)
    collection_payload: dict = Field(default_factory=dict)
