from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.api.deps import require_admin
from backend.app.db.session import get_db
from backend.app.repositories.audit_repository import AuditRepository
from backend.app.schemas.audit import AuditLogResponse


router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("", response_model=list[AuditLogResponse])
def list_audit_logs(db: Session = Depends(get_db), user=Depends(require_admin)):
    return AuditRepository(db).list_recent(200)
