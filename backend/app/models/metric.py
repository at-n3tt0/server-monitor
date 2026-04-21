from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.session import Base


class CpuMetric(Base):
    __tablename__ = "cpu_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    host_id: Mapped[str] = mapped_column(String(64), index=True)
    usage_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    cores: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class MemoryMetric(Base):
    __tablename__ = "memory_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    host_id: Mapped[str] = mapped_column(String(64), index=True)
    used_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    used_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    total_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class DiskMetric(Base):
    __tablename__ = "disk_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    host_id: Mapped[str] = mapped_column(String(64), index=True)
    mountpoint: Mapped[str | None] = mapped_column(String(255), nullable=True)
    used_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    used_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    total_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class NetworkMetric(Base):
    __tablename__ = "network_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    host_id: Mapped[str] = mapped_column(String(64), index=True)
    interface_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rx_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    tx_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    rx_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    tx_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class LatencyMetric(Base):
    __tablename__ = "latency_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    host_id: Mapped[str] = mapped_column(String(64), index=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    packet_loss_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    availability_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="collector")
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class HostStatusMetric(Base):
    __tablename__ = "host_status_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    host_id: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    is_available: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
