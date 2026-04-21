from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.session import Base


class MonitoringProfile(Base):
    __tablename__ = "monitoring_profiles"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    collector_type: Mapped[str] = mapped_column(String(64), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    polling_policy: Mapped[dict] = mapped_column(JSON, default=dict)
    expected_services: Mapped[list[dict]] = mapped_column(JSON, default=list)
    default_alert_rules: Mapped[list[dict]] = mapped_column(JSON, default=list)
    default_capabilities: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class HostCredentialBinding(Base):
    __tablename__ = "host_credential_bindings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    host_id: Mapped[str] = mapped_column(String(64), ForeignKey("hosts.id"), index=True)
    binding_name: Mapped[str] = mapped_column(String(120))
    auth_method: Mapped[str] = mapped_column(String(64), index=True)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    secret_env_var: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ssh_key_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    endpoint: Mapped[str | None] = mapped_column(String(500), nullable=True)
    port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    validation_status: Mapped[str] = mapped_column(String(64), default="pending")
    last_validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)


class HostCapability(Base):
    __tablename__ = "host_capabilities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    host_id: Mapped[str] = mapped_column(String(64), ForeignKey("hosts.id"), index=True)
    capability_key: Mapped[str] = mapped_column(String(120), index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[str] = mapped_column(String(64), default="audit")
    details: Mapped[dict] = mapped_column(JSON, default=dict)


class CollectorBinding(Base):
    __tablename__ = "collector_bindings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    host_id: Mapped[str] = mapped_column(String(64), ForeignKey("hosts.id"), index=True)
    collector_type: Mapped[str] = mapped_column(String(64), index=True)
    priority: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class ServiceCheck(Base):
    __tablename__ = "service_checks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    host_id: Mapped[str] = mapped_column(String(64), ForeignKey("hosts.id"), index=True)
    service_key: Mapped[str] = mapped_column(String(120), index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    check_type: Mapped[str] = mapped_column(String(64), index=True)
    target: Mapped[str | None] = mapped_column(String(500), nullable=True)
    port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    expected_state: Mapped[str] = mapped_column(String(64), default="running")
    interval_seconds: Mapped[int] = mapped_column(Integer, default=60)
    severity: Mapped[str] = mapped_column(String(32), default="warning")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)


class ServiceCheckResult(Base):
    __tablename__ = "service_check_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    service_check_id: Mapped[int] = mapped_column(Integer, ForeignKey("service_checks.id"), index=True)
    host_id: Mapped[str] = mapped_column(String(64), ForeignKey("hosts.id"), index=True)
    status: Mapped[str] = mapped_column(String(64), index=True)
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    response_time_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("monitoring_profiles.id"), nullable=True, index=True)
    host_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("hosts.id"), nullable=True, index=True)
    rule_key: Mapped[str] = mapped_column(String(120), index=True)
    metric_key: Mapped[str] = mapped_column(String(120), index=True)
    condition_operator: Mapped[str] = mapped_column(String(32), default="gte")
    warning_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    critical_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class HostCollectionState(Base):
    __tablename__ = "host_collection_states"

    host_id: Mapped[str] = mapped_column(String(64), ForeignKey("hosts.id"), primary_key=True)
    collector_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    collector_status: Mapped[str] = mapped_column(String(64), default="idle", index=True)
    integration_status: Mapped[str] = mapped_column(String(64), default="awaiting_collection", index=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    last_collection_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
