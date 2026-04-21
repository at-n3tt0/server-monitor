from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models.user import User


class UserRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def count(self) -> int:
        return len(list(self.db.scalars(select(User.id))))

    def get_by_username(self, username: str) -> User | None:
        return self.db.scalar(select(User).where(User.username == username))

    def create(self, **kwargs) -> User:
        user = User(**kwargs)
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user
