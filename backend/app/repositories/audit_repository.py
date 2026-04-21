from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.app.models.audit_log import AuditLog


class AuditRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def log(self, **kwargs) -> AuditLog:
        event = AuditLog(**kwargs)
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        return event

    def list_recent(self, limit: int = 200) -> list[AuditLog]:
        return list(self.db.scalars(select(AuditLog).order_by(desc(AuditLog.created_at)).limit(limit)))
