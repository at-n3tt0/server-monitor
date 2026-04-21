from datetime import datetime

from pydantic import BaseModel

from backend.app.schemas.alert import AlertResponse
from backend.app.schemas.host import HostResponse
from backend.app.schemas.metric import CurrentMetricSummary, MetricPoint


class HostDashboardSummary(BaseModel):
    host: HostResponse
    current: CurrentMetricSummary
    cpu_series: list[MetricPoint]
    memory_series: list[MetricPoint]
    latency_series: list[MetricPoint]
    traffic_series: list[MetricPoint]
    disk_series: list[MetricPoint]


class DashboardBootstrap(BaseModel):
    generated_at: datetime
    user: dict
    hosts: list[HostDashboardSummary]
    alerts: list[AlertResponse]
