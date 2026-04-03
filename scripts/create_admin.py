#!/usr/bin/env python
"""Bootstrap script: create an admin user interactively.

Usage:
    python scripts/create_admin.py
"""
import sys
from pathlib import Path

# Ensure the project root is on sys.path so that `app` can be imported.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from getpass import getpass

from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.database import SessionLocal
from app.models.user import User


def create_admin() -> None:
    print("=== WC-L: Create Admin User ===")
    username = input("Username: ").strip()
    email = input("Email: ").strip()
    password = getpass("Password: ")
    confirm = getpass("Confirm password: ")

    if password != confirm:
        print("Passwords do not match. Aborting.", file=sys.stderr)
        sys.exit(1)

    if not username or not email or not password:
        print("All fields are required. Aborting.", file=sys.stderr)
        sys.exit(1)

    db: Session = SessionLocal()
    try:
        if db.query(User).filter(User.username == username).first():
            print(f"User '{username}' already exists.", file=sys.stderr)
            sys.exit(1)
        if db.query(User).filter(User.email == email).first():
            print(f"Email '{email}' is already registered.", file=sys.stderr)
            sys.exit(1)

        admin = User(
            username=username,
            email=email,
            hashed_password=get_password_hash(password),
            is_admin=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        print(f"Admin user '{username}' (id={admin.id}) created successfully.")
    finally:
        db.close()


if __name__ == "__main__":
    create_admin()
