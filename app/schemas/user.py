from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserBase(BaseModel):
    username: str
    email: EmailStr


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    password: str | None = None


class UserOut(UserBase):
    id: int
    is_active: bool
    is_banned: bool
    is_admin: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserAdminOut(UserOut):
    """Extended user view for admins.

    Reserved for future admin-only fields (e.g. last_login, ban_reason).
    Using a distinct schema keeps the admin and public response shapes
    independently extensible without breaking existing consumers.
    """
