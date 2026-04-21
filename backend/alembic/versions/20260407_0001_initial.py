"""initial schema

Revision ID: 20260407_0001
Revises:
Create Date: 2026-04-07 00:00:01
"""

from alembic import op
import sqlalchemy as sa


revision = "20260407_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("username", sa.String(length=120), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "hosts",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column("monitor_type", sa.String(length=32), nullable=False),
        sa.Column("agent_endpoint", sa.String(length=500), nullable=True),
        sa.Column("agent_token", sa.String(length=255), nullable=True),
        sa.Column("tcp_port", sa.Integer(), nullable=True),
        sa.Column("interval_seconds", sa.Integer(), nullable=False),
        sa.Column("timeout_ms", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(length=32), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_hosts_name", "hosts", ["name"], unique=False)
    op.create_index("ix_hosts_monitor_type", "hosts", ["monitor_type"], unique=False)

    for table_name, columns in {
        "cpu_metrics": [
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("host_id", sa.String(length=64), nullable=False),
            sa.Column("usage_percent", sa.Float(), nullable=True),
            sa.Column("cores", sa.Integer(), nullable=True),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        ],
        "memory_metrics": [
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("host_id", sa.String(length=64), nullable=False),
            sa.Column("used_percent", sa.Float(), nullable=True),
            sa.Column("used_bytes", sa.BigInteger(), nullable=True),
            sa.Column("total_bytes", sa.BigInteger(), nullable=True),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        ],
        "disk_metrics": [
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("host_id", sa.String(length=64), nullable=False),
            sa.Column("mountpoint", sa.String(length=255), nullable=True),
            sa.Column("used_percent", sa.Float(), nullable=True),
            sa.Column("used_bytes", sa.BigInteger(), nullable=True),
            sa.Column("total_bytes", sa.BigInteger(), nullable=True),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        ],
        "network_metrics": [
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("host_id", sa.String(length=64), nullable=False),
            sa.Column("interface_name", sa.String(length=255), nullable=True),
            sa.Column("rx_bytes", sa.BigInteger(), nullable=True),
            sa.Column("tx_bytes", sa.BigInteger(), nullable=True),
            sa.Column("rx_rate", sa.Float(), nullable=True),
            sa.Column("tx_rate", sa.Float(), nullable=True),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        ],
        "latency_metrics": [
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("host_id", sa.String(length=64), nullable=False),
            sa.Column("latency_ms", sa.Float(), nullable=True),
            sa.Column("packet_loss_percent", sa.Float(), nullable=True),
            sa.Column("availability_percent", sa.Float(), nullable=True),
            sa.Column("source", sa.String(length=32), nullable=False),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        ],
        "host_status_metrics": [
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("host_id", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("is_available", sa.Boolean(), nullable=True),
            sa.Column("message", sa.String(length=500), nullable=True),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        ],
    }.items():
        op.create_table(table_name, *columns)
        op.create_index(f"ix_{table_name}_host_id", table_name, ["host_id"], unique=False)
        op.create_index(f"ix_{table_name}_recorded_at", table_name, ["recorded_at"], unique=False)

    op.create_table(
        "alerts",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("host_id", sa.String(length=64), nullable=False),
        sa.Column("alert_key", sa.String(length=255), nullable=False),
        sa.Column("alert_type", sa.String(length=64), nullable=False),
        sa.Column("severity", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_alerts_alert_key", "alerts", ["alert_key"], unique=True)
    op.create_index("ix_alerts_host_id", "alerts", ["host_id"], unique=False)
    op.create_index("ix_alerts_status", "alerts", ["status"], unique=False)
    op.create_index("ix_alerts_severity", "alerts", ["severity"], unique=False)
    op.create_index("ix_alerts_alert_type", "alerts", ["alert_type"], unique=False)

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("actor_username", sa.String(length=120), nullable=True),
        sa.Column("action", sa.String(length=120), nullable=False),
        sa.Column("resource_type", sa.String(length=64), nullable=False),
        sa.Column("resource_id", sa.String(length=120), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_logs_actor_username", "audit_logs", ["actor_username"], unique=False)
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"], unique=False)
    op.create_index("ix_audit_logs_resource_type", "audit_logs", ["resource_type"], unique=False)
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"], unique=False)


def downgrade() -> None:
    for table_name in [
        "audit_logs",
        "alerts",
        "host_status_metrics",
        "latency_metrics",
        "network_metrics",
        "disk_metrics",
        "memory_metrics",
        "cpu_metrics",
        "hosts",
        "users",
    ]:
        op.drop_table(table_name)
