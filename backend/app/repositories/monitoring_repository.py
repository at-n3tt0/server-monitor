from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.app.models.monitoring import (
    AlertRule,
    CollectorBinding,
    HostCapability,
    HostCollectionState,
    HostCredentialBinding,
    MonitoringProfile,
    ServiceCheck,
    ServiceCheckResult,
)


class MonitoringRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_profiles(self) -> list[MonitoringProfile]:
        return list(self.db.scalars(select(MonitoringProfile).order_by(MonitoringProfile.name.asc())))

    def get_profile(self, profile_id: str) -> MonitoringProfile | None:
        return self.db.get(MonitoringProfile, profile_id)

    def upsert_profile(self, profile: MonitoringProfile) -> MonitoringProfile:
        existing = self.db.get(MonitoringProfile, profile.id)
        if existing:
            for field in [
                "name",
                "collector_type",
                "description",
                "polling_policy",
                "expected_services",
                "default_alert_rules",
                "default_capabilities",
            ]:
                setattr(existing, field, getattr(profile, field))
            self.db.add(existing)
            self.db.commit()
            self.db.refresh(existing)
            return existing
        self.db.add(profile)
        self.db.commit()
        self.db.refresh(profile)
        return profile

    def replace_host_credentials(self, host_id: str, bindings: list[HostCredentialBinding]) -> None:
        self.db.execute(delete(HostCredentialBinding).where(HostCredentialBinding.host_id == host_id))
        self.db.add_all(bindings)
        self.db.commit()

    def replace_host_capabilities(self, host_id: str, capabilities: list[HostCapability]) -> None:
        self.db.execute(delete(HostCapability).where(HostCapability.host_id == host_id))
        self.db.add_all(capabilities)
        self.db.commit()

    def replace_host_collectors(self, host_id: str, bindings: list[CollectorBinding]) -> None:
        self.db.execute(delete(CollectorBinding).where(CollectorBinding.host_id == host_id))
        self.db.add_all(bindings)
        self.db.commit()

    def replace_host_service_checks(self, host_id: str, checks: list[ServiceCheck]) -> None:
        existing_ids = [
            row.id
            for row in self.db.scalars(select(ServiceCheck).where(ServiceCheck.host_id == host_id))
        ]
        if existing_ids:
            self.db.execute(delete(ServiceCheckResult).where(ServiceCheckResult.service_check_id.in_(existing_ids)))
        self.db.execute(delete(ServiceCheck).where(ServiceCheck.host_id == host_id))
        self.db.add_all(checks)
        self.db.commit()

    def replace_alert_rules(self, host_id: str, rules: list[AlertRule]) -> None:
        self.db.execute(delete(AlertRule).where(AlertRule.host_id == host_id))
        self.db.add_all(rules)
        self.db.commit()

    def list_host_collectors(self, host_id: str) -> list[CollectorBinding]:
        return list(
            self.db.scalars(
                select(CollectorBinding)
                .where(CollectorBinding.host_id == host_id, CollectorBinding.is_active.is_(True))
                .order_by(CollectorBinding.priority.asc())
            )
        )

    def list_host_service_checks(self, host_id: str) -> list[ServiceCheck]:
        return list(
            self.db.scalars(
                select(ServiceCheck)
                .where(ServiceCheck.host_id == host_id, ServiceCheck.is_active.is_(True))
                .order_by(ServiceCheck.display_name.asc())
            )
        )

    def list_host_credentials(self, host_id: str) -> list[HostCredentialBinding]:
        return list(
            self.db.scalars(
                select(HostCredentialBinding)
                .where(HostCredentialBinding.host_id == host_id, HostCredentialBinding.is_active.is_(True))
                .order_by(HostCredentialBinding.binding_name.asc())
            )
        )

    def list_host_capabilities(self, host_id: str) -> list[HostCapability]:
        return list(self.db.scalars(select(HostCapability).where(HostCapability.host_id == host_id)))

    def list_alert_rules(self, host_id: str) -> list[AlertRule]:
        return list(
            self.db.scalars(
                select(AlertRule)
                .where((AlertRule.host_id == host_id) | (AlertRule.host_id.is_(None)))
            )
        )

    def upsert_collection_state(self, state: HostCollectionState) -> HostCollectionState:
        existing = self.db.get(HostCollectionState, state.host_id)
        if existing:
            existing.collector_name = state.collector_name
            existing.collector_status = state.collector_status
            existing.integration_status = state.integration_status
            existing.message = state.message
            existing.payload = state.payload
            existing.last_collection_at = state.last_collection_at
            self.db.add(existing)
            self.db.commit()
            self.db.refresh(existing)
            return existing
        self.db.add(state)
        self.db.commit()
        self.db.refresh(state)
        return state

    def get_collection_state(self, host_id: str) -> HostCollectionState | None:
        return self.db.get(HostCollectionState, host_id)

    def save_service_results(self, results: list[ServiceCheckResult]) -> None:
        if not results:
            return
        self.db.add_all(results)
        self.db.commit()

    def list_latest_service_results(self, host_id: str) -> dict[str, ServiceCheckResult]:
        results = {}
        checks = self.list_host_service_checks(host_id)
        for check in checks:
            row = self.db.scalar(
                select(ServiceCheckResult)
                .where(ServiceCheckResult.service_check_id == check.id)
                .order_by(ServiceCheckResult.recorded_at.desc())
                .limit(1)
            )
            if row:
                results[check.service_key] = row
        return results
