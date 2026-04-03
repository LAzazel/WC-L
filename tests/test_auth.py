import pytest
from fastapi.testclient import TestClient


def register_user(client: TestClient, username: str, email: str, password: str):
    return client.post(
        "/auth/register",
        json={"username": username, "email": email, "password": password},
    )


def login_user(client: TestClient, username: str, password: str):
    return client.post(
        "/auth/login",
        data={"username": username, "password": password},
    )


class TestRegister:
    def test_register_success(self, client):
        resp = register_user(client, "player1", "player1@example.com", "secret123")
        assert resp.status_code == 201
        data = resp.json()
        assert data["username"] == "player1"
        assert data["email"] == "player1@example.com"
        assert data["is_admin"] is False
        assert data["is_banned"] is False
        assert "hashed_password" not in data

    def test_register_duplicate_username(self, client):
        register_user(client, "player1", "player1@example.com", "secret123")
        resp = register_user(client, "player1", "other@example.com", "secret123")
        assert resp.status_code == 409
        assert "Username" in resp.json()["detail"]

    def test_register_duplicate_email(self, client):
        register_user(client, "player1", "player1@example.com", "secret123")
        resp = register_user(client, "player2", "player1@example.com", "secret456")
        assert resp.status_code == 409
        assert "Email" in resp.json()["detail"]


class TestLogin:
    def test_login_success(self, client):
        register_user(client, "player1", "player1@example.com", "secret123")
        resp = login_user(client, "player1", "secret123")
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    def test_login_wrong_password(self, client):
        register_user(client, "player1", "player1@example.com", "secret123")
        resp = login_user(client, "player1", "wrongpass")
        assert resp.status_code == 401

    def test_login_unknown_user(self, client):
        resp = login_user(client, "nobody", "secret123")
        assert resp.status_code == 401

    def test_login_banned_user(self, client):
        register_user(client, "player1", "player1@example.com", "secret123")
        # Manually ban via DB
        from tests.conftest import TestingSessionLocal
        from app.models.user import User

        db = TestingSessionLocal()
        user = db.query(User).filter(User.username == "player1").first()
        user.is_banned = True
        db.commit()
        db.close()

        resp = login_user(client, "player1", "secret123")
        assert resp.status_code == 403


class TestGetMe:
    def test_get_me(self, client):
        register_user(client, "player1", "player1@example.com", "secret123")
        token = login_user(client, "player1", "secret123").json()["access_token"]
        resp = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["username"] == "player1"

    def test_get_me_unauthenticated(self, client):
        resp = client.get("/auth/me")
        assert resp.status_code == 401

    def test_get_me_invalid_token(self, client):
        resp = client.get("/auth/me", headers={"Authorization": "Bearer invalidtoken"})
        assert resp.status_code == 401
