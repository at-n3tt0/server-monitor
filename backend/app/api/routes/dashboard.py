from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.api.deps import get_current_user
from backend.app.db.session import get_db
from backend.app.schemas.dashboard import DashboardBootstrap
from backend.app.services.dashboard_service import DashboardService


router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/bootstrap", response_model=DashboardBootstrap)
def bootstrap(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return DashboardService(db).bootstrap({"username": user.username, "role": user.role})
