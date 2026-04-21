from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.api.deps import get_current_user
from backend.app.db.session import get_db
from backend.app.schemas.auth import LoginRequest, TokenResponse, UserResponse
from backend.app.services.auth_service import AuthService


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    token = AuthService(db).authenticate(payload.username, payload.password)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
def me(user=Depends(get_current_user)):
    return UserResponse(username=user.username, role=user.role)
