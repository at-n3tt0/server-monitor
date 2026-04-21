from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.app.models.alert import Alert


class AlertRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_key(self, alert_key: str) -> Alert | None:
        return self.db.scalar(select(Alert).where(Alert.alert_key == alert_key))

    def list_recent(self, limit: int = 100) -> list[Alert]:
        return list(self.db.scalars(select(Alert).order_by(desc(Alert.last_seen_at)).limit(limit)))

    def list_active(self) -> list[Alert]:
        return list(self.db.scalars(select(Alert).where(Alert.status == "active").order_by(desc(Alert.last_seen_at))))

    def save(self, alert: Alert) -> Alert:
        self.db.add(alert)
        self.db.commit()
        self.db.refresh(alert)
        return alert
