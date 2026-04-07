from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.core.config import get_settings

settings = get_settings()


def _password_bytes(password: str) -> bytes:
    # Bcrypt only considers the first 72 bytes of the secret (UTF-8), same as passlib did.
    raw = password.encode("utf-8")
    return raw if len(raw) <= 72 else raw[:72]


def hash_password(password: str) -> str:
    # Always store only the hash, never the plain password.
    digest = bcrypt.hashpw(_password_bytes(password), bcrypt.gensalt())
    return digest.decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    # Compare a plain password to the stored hash in a timing-safe way.
    try:
        return bcrypt.checkpw(
            _password_bytes(password),
            password_hash.encode("ascii"),
        )
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    # Put the user id into `sub` and add an expiration so tokens do not live forever.
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)

