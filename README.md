# WC-L

FastAPI backend starter for a Minecraft server website and launcher integration.

## Features

- **JWT Authentication** – register, login, and `/auth/me` endpoints
- **Admin endpoints** – list users, ban/unban, promote; protected by DB-stored `is_admin` flag
- **User ban/unban management** – banned users are blocked from all protected routes
- **SQLAlchemy models** – `User` model with `is_active`, `is_banned`, `is_admin` fields
- **Alembic migrations** – auto-generated migration for the `users` table
- **Tests** – pytest test suite covering auth, admin, and user endpoints
- **Bootstrap tooling** – `.env.example` and `scripts/create_admin.py`

## Quick start

```bash
# 1. Copy and edit environment variables
cp .env.example .env

# 2. Install dependencies
pip install -r requirements.txt

# 3. Apply database migrations
alembic upgrade head

# 4. Create your first admin user
python scripts/create_admin.py

# 5. Run the development server
uvicorn app.main:app --reload
```

## Running tests

```bash
pytest
```

## Project structure

```
app/
  config.py          – Pydantic settings (reads .env)
  database.py        – SQLAlchemy engine / session / Base
  main.py            – FastAPI application factory
  models/
    user.py          – User ORM model
  schemas/
    auth.py          – Token schemas
    user.py          – User I/O schemas
  core/
    security.py      – JWT creation/verification, password hashing
    dependencies.py  – FastAPI dependencies (get_current_user, require_admin)
  routers/
    auth.py          – /auth/register, /auth/login, /auth/me
    admin.py         – /admin/users, /admin/users/{id}/ban|unban|promote
    users.py         – /users/{id}, /users/me (PATCH)
alembic/             – Alembic migration environment
scripts/
  create_admin.py    – Interactive admin-user bootstrap script
tests/               – pytest test suite
.env.example         – Environment variable template
requirements.txt     – Python dependencies
```
