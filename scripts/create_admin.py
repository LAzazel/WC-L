from __future__ import annotations

import argparse
import getpass
from pathlib import Path
import site
import sys


def _bootstrap_project_venv() -> None:
    """Allow running via system python by loading local .venv deps."""
    root = Path(__file__).resolve().parents[1]
    lib_dir = root / ".venv" / "lib"
    if not lib_dir.exists():
        return
    candidates = sorted(lib_dir.glob("python*/site-packages"))
    if not candidates:
        return
    site.addsitedir(str(candidates[-1]))


_bootstrap_project_venv()

from sqlalchemy import or_, select

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.user import User


def parse_args() -> argparse.Namespace:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Create or promote an admin user")
    parser.add_argument("--username", default=settings.admin_username, help="Admin username")
    parser.add_argument("--email", required=True, help="Admin email")
    parser.add_argument("--password", help="Admin password (if omitted, prompt securely)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    password = args.password or getpass.getpass("Admin password: ")
    if not password:
        raise SystemExit("Password cannot be empty")

    with SessionLocal() as db:
        user = db.scalar(
            select(User).where(or_(User.username == args.username, User.email == args.email))
        )

        if user is None:
            user = User(
                username=args.username,
                email=args.email,
                password_hash=hash_password(password),
                is_admin=True,
                is_banned=False,
            )
            db.add(user)
            action = "created"
        else:
            user.username = args.username
            user.email = args.email
            user.password_hash = hash_password(password)
            user.is_admin = True
            user.is_banned = False
            action = "updated"

        db.commit()
        db.refresh(user)

    print(f"Admin user {action}: id={user.id}, username={user.username}")


if __name__ == "__main__":
    main()

