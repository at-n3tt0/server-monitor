from datetime import datetime

from pydantic import BaseModel


class AuditLogResponse(BaseModel):
    id: int
    actor_username: str | None
    action: str
    resource_type: str
    resource_id: str | None
    message: str
    details: dict
    created_at: datetime

    class Config:
        from_attributes = True
