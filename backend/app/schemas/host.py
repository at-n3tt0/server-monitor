from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class HostThresholds(BaseModel):
    warning_latency_ms: float = 150
    critical_latency_ms: float = 300
    warning_packet_loss: float = 10
    critical_packet_loss: float = 30
    cpu_usage_warning: float = 80
    cpu_usage_critical: float = 90
    memory_usage_warning: float = 80
    memory_usage_critical: float = 90
    disk_usage_warning: float = 85
    disk_usage_critical: float = 95


class HostBase(BaseModel):
    name: str
    address: str | None = None
    hostname: str | None = None
    role: str | None = None
    criticality: str = "medium"
    operating_system: str | None = None
    profile_id: str | None = None
    monitor_type: str
    collector_type: str | None = None
    agent_endpoint: str | None = None
    agent_token: str | None = None
    tcp_port: int | None = None
    interval_seconds: int = 30
    timeout_ms: int = 5000
    is_active: bool = True
    description: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    expected_services: list[str] = Field(default_factory=list)
    integration_status: str = "awaiting_collection"


class HostCreate(HostBase):
    id: str


class HostUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    hostname: str | None = None
    role: str | None = None
    criticality: str | None = None
    operating_system: str | None = None
    profile_id: str | None = None
    monitor_type: str | None = None
    collector_type: str | None = None
    agent_endpoint: str | None = None
    agent_token: str | None = None
    tcp_port: int | None = None
    interval_seconds: int | None = None
    timeout_ms: int | None = None
    is_active: bool | None = None
    description: str | None = None
    details: dict[str, Any] | None = None
    tags: list[str] | None = None
    expected_services: list[str] | None = None
    integration_status: str | None = None


class HostResponse(HostBase):
    id: str
    last_seen_at: datetime | None = None
    last_status: str | None = None
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
