from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


# This table stores site users, their login identity, and account status.
class User(Base):
    __tablename__ = "users"

    # Primary key used by both the website and the launcher to refer to one user.
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    # Public username shown in UI and used for login.
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    # Email is kept unique so the account can also be identified by email.
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    # Passwords are never stored in plain text; this column keeps the secure hash.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # Admin flag controls access to `/api/v1/admin/*` endpoints.
    is_admin: Mapped[bool] = mapped_column(default=False, nullable=False)
    # Banned users cannot log in or use protected endpoints.
    is_banned: Mapped[bool] = mapped_column(default=False, nullable=False)
    # Chosen profile avatar style (mc-heads / local asset id); None means default in the client.
    mc_avatar_variant: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # `created_at` is filled automatically when the row is first inserted.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # `updated_at` changes automatically whenever the row is edited.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

