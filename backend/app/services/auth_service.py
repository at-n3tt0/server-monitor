from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.core.security import create_access_token, hash_password, verify_password
from backend.app.repositories.user_repository import UserRepository
from backend.app.utils.time import utcnow


class AuthService:
    def __init__(self, db: Session) -> None:
        self.user_repository = UserRepository(db)

    def ensure_bootstrap_admin(self) -> None:
        settings = get_settings()
        if self.user_repository.count():
            return
        self.user_repository.create(
            id="bootstrap-admin",
            username=settings.bootstrap_admin_username,
            password_hash=hash_password(settings.bootstrap_admin_password),
            role="admin",
            is_active=True,
            created_at=utcnow(),
            updated_at=utcnow(),
        )

    def authenticate(self, username: str, password: str) -> str:
        user = self.user_repository.get_by_username(username)
        if not user or not user.is_active or not verify_password(password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciais invalidas")
        return create_access_token(user.username, {"role": user.role})
