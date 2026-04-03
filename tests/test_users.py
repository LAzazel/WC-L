from fastapi.testclient import TestClient

from tests.conftest import TestingSessionLocal
from app.models.user import User
from app.core.security import get_password_hash


def _make_user(username: str, email: str, password: str) -> dict:
    db = TestingSessionLocal()
    try:
        user = User(
            username=username,
            email=email,
            hashed_password=get_password_hash(password),
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


class TestGetUser:
    def test_get_existing_user(self, client):
        user = _make_user("player1", "player1@example.com", "pass1")
        token = _get_token(client, "player1", "pass1")
        resp = client.get(
            f"/users/{user['id']}", headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 200
        assert resp.json()["username"] == "player1"

    def test_get_nonexistent_user(self, client):
        user = _make_user("player1", "player1@example.com", "pass1")
        token = _get_token(client, "player1", "pass1")
        resp = client.get("/users/9999", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 404

    def test_get_user_unauthenticated(self, client):
        user = _make_user("player1", "player1@example.com", "pass1")
        resp = client.get(f"/users/{user['id']}")
        assert resp.status_code == 401


class TestUpdateMe:
    def test_update_email(self, client):
        _make_user("player1", "player1@example.com", "pass1")
        token = _get_token(client, "player1", "pass1")
        resp = client.patch(
            "/users/me",
            json={"email": "new@example.com"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["email"] == "new@example.com"

    def test_update_password(self, client):
        _make_user("player1", "player1@example.com", "pass1")
        token = _get_token(client, "player1", "pass1")
        resp = client.patch(
            "/users/me",
            json={"password": "newpass456"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        # Verify new password works
        login = client.post("/auth/login", data={"username": "player1", "password": "newpass456"})
        assert login.status_code == 200

    def test_update_email_conflict(self, client):
        _make_user("player1", "player1@example.com", "pass1")
        _make_user("player2", "player2@example.com", "pass2")
        token = _get_token(client, "player1", "pass1")
        resp = client.patch(
            "/users/me",
            json={"email": "player2@example.com"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 409
