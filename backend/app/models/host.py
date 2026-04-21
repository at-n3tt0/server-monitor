from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, JSON, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.session import Base


class Host(Base):
    __tablename__ = "hosts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hostname: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    role: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    criticality: Mapped[str] = mapped_column(String(32), default="medium", index=True)
    operating_system: Mapped[str | None] = mapped_column(String(255), nullable=True)
    profile_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("monitoring_profiles.id"), nullable=True, index=True)
    monitor_type: Mapped[str] = mapped_column(String(32), index=True)
    collector_type: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    agent_endpoint: Mapped[str | None] = mapped_column(String(500), nullable=True)
    agent_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tcp_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    interval_seconds: Mapped[int] = mapped_column(Integer, default=30)
    timeout_ms: Mapped[int] = mapped_column(Integer, default=5000)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    expected_services: Mapped[list[str]] = mapped_column(JSON, default=list)
    integration_status: Mapped[str] = mapped_column(String(64), default="awaiting_collection", index=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
