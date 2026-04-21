from backend.app.repositories.audit_repository import AuditRepository
from backend.app.utils.time import utcnow


class AuditService:
    def __init__(self, repository: AuditRepository) -> None:
        self.repository = repository

    def log(
        self,
        action: str,
        resource_type: str,
        message: str,
        actor_username: str | None = None,
        resource_id: str | None = None,
        details: dict | None = None,
    ) -> None:
        self.repository.log(
            actor_username=actor_username,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            message=message,
            details=details or {},
            created_at=utcnow(),
        )
