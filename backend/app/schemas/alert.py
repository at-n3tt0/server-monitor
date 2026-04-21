from datetime import datetime

from pydantic import BaseModel


class AlertResponse(BaseModel):
    id: str
    host_id: str
    alert_key: str
    alert_type: str
    severity: str
    status: str
    title: str
    message: str
    payload: dict
    first_seen_at: datetime
    last_seen_at: datetime
    resolved_at: datetime | None = None

    class Config:
        from_attributes = True
