from __future__ import annotations

from datetime import datetime

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.app.models.host import Host


class HostRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list(self) -> list[Host]:
        return list(self.db.scalars(select(Host).order_by(Host.name.asc())))

    def active(self) -> list[Host]:
        return list(self.db.scalars(select(Host).where(Host.is_active.is_(True)).order_by(Host.name.asc())))

    def get(self, host_id: str) -> Host | None:
        return self.db.get(Host, host_id)

    def create(self, **kwargs) -> Host:
        if "metadata" in kwargs:
            kwargs["details"] = kwargs.pop("metadata")
        host = Host(**kwargs)
        self.db.add(host)
        self.db.commit()
        self.db.refresh(host)
        return host

    def update(self, host: Host, values: dict) -> Host:
        if "metadata" in values:
            values["details"] = values.pop("metadata")
        for key, value in values.items():
            setattr(host, key, value)
        host.updated_at = datetime.utcnow()
        self.db.add(host)
        self.db.commit()
        self.db.refresh(host)
        return host

    def delete(self, host: Host) -> None:
        self.db.delete(host)
        self.db.commit()
