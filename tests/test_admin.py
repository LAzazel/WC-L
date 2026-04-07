from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app


settings = get_settings()
ADMIN_USERNAME = settings.admin_username
ADMIN_PASSWORD = "AdminPass123"


def _login(client: TestClient, username: str, password: str) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json={"login": username, "password": password},
    )
    assert response.status_code == 200
    data = response.json()
    assert data.get("access_token")
    return data["access_token"]


# This test covers the main admin flow: list users, grant/revoke admin, ban/unban, and verify access control.
def test_admin_can_list_and_ban_user() -> None:
    with TestClient(app) as client:
        admin_token = _login(client, ADMIN_USERNAME, ADMIN_PASSWORD)

        suffix = uuid4().hex[:8]
        username = f"member_{suffix}"
        email = f"{username}@example.com"
        password = "strongpassword123"

        register_response = client.post(
            "/api/v1/auth/register",
            json={"username": username, "email": email, "password": password},
        )
        assert register_response.status_code == 201
        created_user = register_response.json()
        user_id = created_user["id"]
        assert created_user["is_admin"] is False
        assert created_user["is_banned"] is False

        user_token = _login(client, username, password)

        users_response = client.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert users_response.status_code == 200
        users = users_response.json()
        assert any(user["username"] == username for user in users)

        grant_admin_response = client.patch(
            f"/api/v1/admin/users/{user_id}/admin",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"is_admin": True},
        )
        assert grant_admin_response.status_code == 200
        assert grant_admin_response.json()["is_admin"] is True

        revoke_admin_response = client.patch(
            f"/api/v1/admin/users/{user_id}/admin",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"is_admin": False},
        )
        assert revoke_admin_response.status_code == 200
        assert revoke_admin_response.json()["is_admin"] is False

        ban_response = client.patch(
            f"/api/v1/admin/users/{user_id}/ban",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"is_banned": True},
        )
        assert ban_response.status_code == 200
        assert ban_response.json()["is_banned"] is True

        me_response = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert me_response.status_code == 403

        login_again = client.post(
            "/api/v1/auth/login",
            json={"login": username, "password": password},
        )
        assert login_again.status_code == 401


# Non-admin users must not be allowed into the admin endpoints.
def test_non_admin_cannot_access_admin_api() -> None:
    with TestClient(app) as client:
        suffix = uuid4().hex[:8]
        username = f"player_{suffix}"
        email = f"{username}@example.com"
        password = "strongpassword123"

        register_response = client.post(
            "/api/v1/auth/register",
            json={"username": username, "email": email, "password": password},
        )
        assert register_response.status_code == 201

        user_token = _login(client, username, password)

        users_response = client.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert users_response.status_code == 403
        assert users_response.json()["detail"] == "Admin privileges required"


def test_admin_users_filter_by_is_admin() -> None:
    with TestClient(app) as client:
        admin_token = _login(client, ADMIN_USERNAME, ADMIN_PASSWORD)

        suffix = uuid4().hex[:8]
        username = f"filter_{suffix}"
        email = f"{username}@example.com"
        password = "strongpassword123"

        register_response = client.post(
            "/api/v1/auth/register",
            json={"username": username, "email": email, "password": password},
        )
        assert register_response.status_code == 201
        user_id = register_response.json()["id"]

        grant_admin_response = client.patch(
            f"/api/v1/admin/users/{user_id}/admin",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"is_admin": True},
        )
        assert grant_admin_response.status_code == 200

        admins_response = client.get(
            "/api/v1/admin/users?is_admin=true",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert admins_response.status_code == 200
        admins = admins_response.json()
        assert admins
        assert all(user["is_admin"] is True for user in admins)
        assert any(user["id"] == user_id for user in admins)

        non_admins_response = client.get(
            "/api/v1/admin/users?is_admin=false",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert non_admins_response.status_code == 200
        non_admins = non_admins_response.json()
        assert all(user["is_admin"] is False for user in non_admins)
        assert all(user["id"] != user_id for user in non_admins)


def test_admin_can_unban_user() -> None:
    with TestClient(app) as client:
        admin_token = _login(client, ADMIN_USERNAME, ADMIN_PASSWORD)

        suffix = uuid4().hex[:8]
        username = f"banned_{suffix}"
        email = f"{username}@example.com"
        password = "strongpassword123"

        register_response = client.post(
            "/api/v1/auth/register",
            json={"username": username, "email": email, "password": password},
        )
        assert register_response.status_code == 201
        user_id = register_response.json()["id"]

        ban_response = client.patch(
            f"/api/v1/admin/users/{user_id}/ban",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"is_banned": True},
        )
        assert ban_response.status_code == 200
        assert ban_response.json()["is_banned"] is True

        login_banned = client.post(
            "/api/v1/auth/login",
            json={"login": username, "password": password},
        )
        assert login_banned.status_code == 401

        unban_response = client.patch(
            f"/api/v1/admin/users/{user_id}/ban",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"is_banned": False},
        )
        assert unban_response.status_code == 200
        assert unban_response.json()["is_banned"] is False

        login_unbanned = client.post(
            "/api/v1/auth/login",
            json={"login": username, "password": password},
        )
        assert login_unbanned.status_code == 200


