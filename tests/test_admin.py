import pytest
from fastapi.testclient import TestClient

from tests.conftest import TestingSessionLocal
from app.models.user import User
from app.core.security import get_password_hash


def _make_user(username: str, email: str, password: str, is_admin: bool = False) -> dict:
    db = TestingSessionLocal()
    try:
        user = User(
            username=username,
            email=email,
            hashed_password=get_password_hash(password),
            is_admin=is_admin,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return {"id": user.id, "username": username, "password": password}
    finally:
        db.close()


def _get_token(client: TestClient, username: str, password: str) -> str:
    resp = client.post("/auth/login", data={"username": username, "password": password})
    return resp.json()["access_token"]


class TestAdminListUsers:
    def test_list_users_as_admin(self, client):
        admin = _make_user("admin", "admin@example.com", "adminpass", is_admin=True)
        _make_user("player1", "player1@example.com", "pass1")
        token = _get_token(client, "admin", "adminpass")
        resp = client.get("/admin/users", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_list_users_as_regular_user(self, client):
        _make_user("player1", "player1@example.com", "pass1")
        token = _get_token(client, "player1", "pass1")
        resp = client.get("/admin/users", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    def test_list_users_unauthenticated(self, client):
        resp = client.get("/admin/users")
        assert resp.status_code == 401


class TestBanUnban:
    def test_ban_user(self, client):
        admin = _make_user("admin", "admin@example.com", "adminpass", is_admin=True)
        player = _make_user("player1", "player1@example.com", "pass1")
        token = _get_token(client, "admin", "adminpass")
        resp = client.post(
            f"/admin/users/{player['id']}/ban",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["is_banned"] is True

    def test_unban_user(self, client):
        admin = _make_user("admin", "admin@example.com", "adminpass", is_admin=True)
        player = _make_user("player1", "player1@example.com", "pass1")
        # Ban first
        token = _get_token(client, "admin", "adminpass")
        client.post(
            f"/admin/users/{player['id']}/ban",
            headers={"Authorization": f"Bearer {token}"},
        )
        # Now unban
        resp = client.post(
            f"/admin/users/{player['id']}/unban",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["is_banned"] is False

    def test_ban_nonexistent_user(self, client):
        admin = _make_user("admin", "admin@example.com", "adminpass", is_admin=True)
        token = _get_token(client, "admin", "adminpass")
        resp = client.post(
            "/admin/users/9999/ban",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    def test_ban_self_forbidden(self, client):
        admin = _make_user("admin", "admin@example.com", "adminpass", is_admin=True)
        token = _get_token(client, "admin", "adminpass")
        resp = client.post(
            f"/admin/users/{admin['id']}/ban",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400

    def test_banned_user_cannot_access_protected(self, client):
        admin = _make_user("admin", "admin@example.com", "adminpass", is_admin=True)
        player = _make_user("player1", "player1@example.com", "pass1")
        player_token = _get_token(client, "player1", "pass1")
        admin_token = _get_token(client, "admin", "adminpass")
        # Ban player
        client.post(
            f"/admin/users/{player['id']}/ban",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        # Player tries to access /auth/me
        resp = client.get("/auth/me", headers={"Authorization": f"Bearer {player_token}"})
        assert resp.status_code == 403


class TestPromote:
    def test_promote_user(self, client):
        admin = _make_user("admin", "admin@example.com", "adminpass", is_admin=True)
        player = _make_user("player1", "player1@example.com", "pass1")
        token = _get_token(client, "admin", "adminpass")
        resp = client.post(
            f"/admin/users/{player['id']}/promote",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["is_admin"] is True

    def test_promote_as_regular_user_forbidden(self, client):
        _make_user("player1", "player1@example.com", "pass1")
        player2 = _make_user("player2", "player2@example.com", "pass2")
        token = _get_token(client, "player1", "pass1")
        resp = client.post(
            f"/admin/users/{player2['id']}/promote",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403
