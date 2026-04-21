"""operational profiles and audited hosts support

Revision ID: 20260407_0002
Revises: 20260407_0001
Create Date: 2026-04-07 00:30:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260407_0002"
down_revision = "20260407_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "monitoring_profiles",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("collector_type", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("polling_policy", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("expected_services", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("default_alert_rules", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("default_capabilities", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_monitoring_profiles_name", "monitoring_profiles", ["name"], unique=True)
    op.create_index("ix_monitoring_profiles_collector_type", "monitoring_profiles", ["collector_type"], unique=False)

    with op.batch_alter_table("hosts") as batch_op:
        batch_op.add_column(sa.Column("hostname", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("role", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("criticality", sa.String(length=32), nullable=False, server_default="medium"))
        batch_op.add_column(sa.Column("operating_system", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("profile_id", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("collector_type", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("tags", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")))
        batch_op.add_column(sa.Column("expected_services", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")))
        batch_op.add_column(sa.Column("integration_status", sa.String(length=64), nullable=False, server_default="awaiting_collection"))
        batch_op.create_index("ix_hosts_hostname", ["hostname"], unique=False)
        batch_op.create_index("ix_hosts_role", ["role"], unique=False)
        batch_op.create_index("ix_hosts_criticality", ["criticality"], unique=False)
        batch_op.create_index("ix_hosts_profile_id", ["profile_id"], unique=False)
        batch_op.create_index("ix_hosts_collector_type", ["collector_type"], unique=False)
        batch_op.create_foreign_key("fk_hosts_profile_id", "monitoring_profiles", ["profile_id"], ["id"])

    op.create_table(
        "host_credential_bindings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("host_id", sa.String(length=64), nullable=False),
        sa.Column("binding_name", sa.String(length=120), nullable=False),
        sa.Column("auth_method", sa.String(length=64), nullable=False),
        sa.Column("username", sa.String(length=255), nullable=True),
        sa.Column("secret_env_var", sa.String(length=255), nullable=True),
        sa.Column("ssh_key_path", sa.String(length=500), nullable=True),
        sa.Column("endpoint", sa.String(length=500), nullable=True),
        sa.Column("port", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("validation_status", sa.String(length=64), nullable=False, server_default="pending"),
        sa.Column("last_validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.ForeignKeyConstraint(["host_id"], ["hosts.id"]),
    )
    op.create_index("ix_host_credential_bindings_host_id", "host_credential_bindings", ["host_id"], unique=False)
    op.create_index("ix_host_credential_bindings_auth_method", "host_credential_bindings", ["auth_method"], unique=False)

    op.create_table(
        "host_capabilities",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("host_id", sa.String(length=64), nullable=False),
        sa.Column("capability_key", sa.String(length=120), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("source", sa.String(length=64), nullable=False, server_default="audit"),
        sa.Column("details", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.ForeignKeyConstraint(["host_id"], ["hosts.id"]),
    )
    op.create_index("ix_host_capabilities_host_id", "host_capabilities", ["host_id"], unique=False)
    op.create_index("ix_host_capabilities_capability_key", "host_capabilities", ["capability_key"], unique=False)

    op.create_table(
        "collector_bindings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("host_id", sa.String(length=64), nullable=False),
        sa.Column("collector_type", sa.String(length=64), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("config", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["host_id"], ["hosts.id"]),
    )
    op.create_index("ix_collector_bindings_host_id", "collector_bindings", ["host_id"], unique=False)
    op.create_index("ix_collector_bindings_collector_type", "collector_bindings", ["collector_type"], unique=False)

    op.create_table(
        "service_checks",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("host_id", sa.String(length=64), nullable=False),
        sa.Column("service_key", sa.String(length=120), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("check_type", sa.String(length=64), nullable=False),
        sa.Column("target", sa.String(length=500), nullable=True),
        sa.Column("port", sa.Integer(), nullable=True),
        sa.Column("path", sa.String(length=500), nullable=True),
        sa.Column("expected_state", sa.String(length=64), nullable=False, server_default="running"),
        sa.Column("interval_seconds", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("severity", sa.String(length=32), nullable=False, server_default="warning"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.ForeignKeyConstraint(["host_id"], ["hosts.id"]),
    )
    op.create_index("ix_service_checks_host_id", "service_checks", ["host_id"], unique=False)
    op.create_index("ix_service_checks_service_key", "service_checks", ["service_key"], unique=False)
    op.create_index("ix_service_checks_check_type", "service_checks", ["check_type"], unique=False)

    op.create_table(
        "service_check_results",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("service_check_id", sa.Integer(), nullable=False),
        sa.Column("host_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=True),
        sa.Column("response_time_ms", sa.Float(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["host_id"], ["hosts.id"]),
        sa.ForeignKeyConstraint(["service_check_id"], ["service_checks.id"]),
    )
    op.create_index("ix_service_check_results_host_id", "service_check_results", ["host_id"], unique=False)
    op.create_index("ix_service_check_results_service_check_id", "service_check_results", ["service_check_id"], unique=False)
    op.create_index("ix_service_check_results_recorded_at", "service_check_results", ["recorded_at"], unique=False)

    op.create_table(
        "alert_rules",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("profile_id", sa.String(length=64), nullable=True),
        sa.Column("host_id", sa.String(length=64), nullable=True),
        sa.Column("rule_key", sa.String(length=120), nullable=False),
        sa.Column("metric_key", sa.String(length=120), nullable=False),
        sa.Column("condition_operator", sa.String(length=32), nullable=False, server_default="gte"),
        sa.Column("warning_threshold", sa.Float(), nullable=True),
        sa.Column("critical_threshold", sa.Float(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["host_id"], ["hosts.id"]),
        sa.ForeignKeyConstraint(["profile_id"], ["monitoring_profiles.id"]),
    )
    op.create_index("ix_alert_rules_host_id", "alert_rules", ["host_id"], unique=False)
    op.create_index("ix_alert_rules_profile_id", "alert_rules", ["profile_id"], unique=False)
    op.create_index("ix_alert_rules_rule_key", "alert_rules", ["rule_key"], unique=False)
    op.create_index("ix_alert_rules_metric_key", "alert_rules", ["metric_key"], unique=False)

    op.create_table(
        "host_collection_states",
        sa.Column("host_id", sa.String(length=64), primary_key=True),
        sa.Column("collector_name", sa.String(length=120), nullable=True),
        sa.Column("collector_status", sa.String(length=64), nullable=False, server_default="idle"),
        sa.Column("integration_status", sa.String(length=64), nullable=False, server_default="awaiting_collection"),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("last_collection_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["host_id"], ["hosts.id"]),
    )
    op.create_index("ix_host_collection_states_collector_status", "host_collection_states", ["collector_status"], unique=False)
    op.create_index("ix_host_collection_states_integration_status", "host_collection_states", ["integration_status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_host_collection_states_integration_status", table_name="host_collection_states")
    op.drop_index("ix_host_collection_states_collector_status", table_name="host_collection_states")
    op.drop_table("host_collection_states")
    op.drop_index("ix_alert_rules_metric_key", table_name="alert_rules")
    op.drop_index("ix_alert_rules_rule_key", table_name="alert_rules")
    op.drop_index("ix_alert_rules_profile_id", table_name="alert_rules")
    op.drop_index("ix_alert_rules_host_id", table_name="alert_rules")
    op.drop_table("alert_rules")
    op.drop_index("ix_service_check_results_recorded_at", table_name="service_check_results")
    op.drop_index("ix_service_check_results_service_check_id", table_name="service_check_results")
    op.drop_index("ix_service_check_results_host_id", table_name="service_check_results")
    op.drop_table("service_check_results")
    op.drop_index("ix_service_checks_check_type", table_name="service_checks")
    op.drop_index("ix_service_checks_service_key", table_name="service_checks")
    op.drop_index("ix_service_checks_host_id", table_name="service_checks")
    op.drop_table("service_checks")
    op.drop_index("ix_collector_bindings_collector_type", table_name="collector_bindings")
    op.drop_index("ix_collector_bindings_host_id", table_name="collector_bindings")
    op.drop_table("collector_bindings")
    op.drop_index("ix_host_capabilities_capability_key", table_name="host_capabilities")
    op.drop_index("ix_host_capabilities_host_id", table_name="host_capabilities")
    op.drop_table("host_capabilities")
    op.drop_index("ix_host_credential_bindings_auth_method", table_name="host_credential_bindings")
    op.drop_index("ix_host_credential_bindings_host_id", table_name="host_credential_bindings")
    op.drop_table("host_credential_bindings")

    with op.batch_alter_table("hosts") as batch_op:
        batch_op.drop_constraint("fk_hosts_profile_id", type_="foreignkey")
        batch_op.drop_index("ix_hosts_collector_type")
        batch_op.drop_index("ix_hosts_profile_id")
        batch_op.drop_index("ix_hosts_criticality")
        batch_op.drop_index("ix_hosts_role")
        batch_op.drop_index("ix_hosts_hostname")
        batch_op.drop_column("integration_status")
        batch_op.drop_column("expected_services")
        batch_op.drop_column("tags")
        batch_op.drop_column("collector_type")
        batch_op.drop_column("profile_id")
        batch_op.drop_column("operating_system")
        batch_op.drop_column("criticality")
        batch_op.drop_column("role")
        batch_op.drop_column("hostname")

    op.drop_index("ix_monitoring_profiles_collector_type", table_name="monitoring_profiles")
    op.drop_index("ix_monitoring_profiles_name", table_name="monitoring_profiles")
    op.drop_table("monitoring_profiles")
