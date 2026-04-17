from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.mc_avatar import ALLOWED_MC_AVATAR_VARIANTS
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.schemas.auth import UserCreate, UserSelfUpdate

settings = get_settings()


# Small custom exception so the router can turn auth failures into nice HTTP errors.
class AuthError(Exception):
    pass


def create_user(db: Session, data: UserCreate) -> User:
    # Reserve the configured admin username so nobody can claim it through public signup.
    if data.username == settings.admin_username:
        raise AuthError("This username is reserved")

    # Prevent duplicate accounts by checking username and email before insert.
    existing_user = db.scalar(
        select(User).where(or_(User.username == data.username, User.email == data.email))
    )
    if existing_user is not None:
        raise AuthError("Username or email already exists")

    # Create the user with a hashed password so the database never stores plain text.
    user = User(
        username=data.username,
        email=str(data.email),
        password_hash=hash_password(data.password),
        is_banned=False,
    )
    # Save the new user immediately so the caller can get the generated id back.
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, login: str, password: str) -> User | None:
    # Allow users to sign in with either username or email.
    user = db.scalar(select(User).where(or_(User.username == login, User.email == login)))
    if user is None:
        return None
    # Only banned users are blocked at login.
    if user.is_banned:
        return None
    # Reject the login if the password does not match the stored hash.
    if not verify_password(password, user.password_hash):
        return None
    return user


def build_access_token_for_user(user: User) -> str:
    # The JWT only needs the user id as subject; the dependency resolves the rest.
    return create_access_token(subject=str(user.id))


def update_self_profile(db: Session, user: User, data: UserSelfUpdate) -> User:
    if data.username is None and data.mc_avatar_variant is None:
        raise AuthError("No fields to update")

    if data.username is not None:
        new_username = data.username.strip()
        if len(new_username) < 3:
            raise AuthError("Username must be at least 3 characters")
        if new_username != user.username:
            if new_username == settings.admin_username:
                raise AuthError("This username is reserved")
            taken = db.scalar(select(User).where(User.username == new_username))
            if taken is not None and taken.id != user.id:
                raise AuthError("Username already taken")
            user.username = new_username

    if data.mc_avatar_variant is not None:
        variant = data.mc_avatar_variant.strip()
        if variant not in ALLOWED_MC_AVATAR_VARIANTS:
            raise AuthError("Invalid avatar variant")
        user.mc_avatar_variant = variant

    db.commit()
    db.refresh(user)
    return user


def change_user_password(db: Session, user: User, current_password: str, new_password: str) -> None:
    # UI/copy-paste can accidentally add surrounding spaces.
    # Keep strict check first; then allow a trimmed retry only if it differs.
    current_ok = verify_password(current_password, user.password_hash)
    if not current_ok:
        trimmed_current = current_password.strip()
        if trimmed_current != current_password:
            current_ok = verify_password(trimmed_current, user.password_hash)
    if not current_ok:
        raise AuthError("Current password is incorrect")
    if current_password == new_password:
        raise AuthError("New password must differ from the current password")
    user.password_hash = hash_password(new_password)
    db.commit()


