from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.api.deps import get_current_user
from backend.app.db.session import get_db
from backend.app.repositories.alert_repository import AlertRepository
from backend.app.schemas.alert import AlertResponse


router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertResponse])
def list_alerts(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return AlertRepository(db).list_recent(200)
