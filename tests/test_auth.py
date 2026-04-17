from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app

settings = get_settings()


def _access_token_after_password_login(client: TestClient, login: str, password: str) -> str:
    login_response = client.post(
        "/api/v1/auth/login",
        json={"login": login, "password": password},
    )
    assert login_response.status_code == 200
    data = login_response.json()
    assert data.get("access_token")
    return data["access_token"]


# This test covers the full auth flow: register, login, then fetch `/me`.
def test_register_login_me_flow() -> None:
    with TestClient(app) as client:
        suffix = uuid4().hex[:8]
        username = f"player_{suffix}"
        email = f"{username}@example.com"
        password = "strongpassword123"

        # Step 1: create a new account.
        register_response = client.post(
            "/api/v1/auth/register",
            json={
                "username": username,
                "email": email,
                "password": password,
            },
        )

        assert register_response.status_code == 201
        user_payload = register_response.json()
        assert user_payload["username"] == username
        assert user_payload["email"] == email
        assert user_payload["is_admin"] is False
        assert user_payload["is_banned"] is False

        # Step 2: log in with the same credentials to get a bearer token.
        token_payload = client.post(
            "/api/v1/auth/login",
            json={"login": username, "password": password},
        ).json()
        assert token_payload["token_type"] == "bearer"
        assert token_payload["access_token"]

        # Step 3: use the token to call the protected `/me` endpoint.
        me_response = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token_payload['access_token']}"},
        )

        assert me_response.status_code == 200
        me_payload = me_response.json()
        assert me_payload["username"] == username
        assert me_payload["email"] == email
        assert me_payload["is_admin"] is False
        assert me_payload["is_banned"] is False
        assert me_payload.get("mc_avatar_variant") is None


# This test proves the login endpoint rejects bad passwords.
def test_login_rejects_invalid_password() -> None:
    with TestClient(app) as client:
        suffix = uuid4().hex[:8]
        username = f"badpass_{suffix}"
        email = f"{username}@example.com"

        # Create a valid account first so the failed login is meaningful.
        client.post(
            "/api/v1/auth/register",
            json={
                "username": username,
                "email": email,
                "password": "strongpassword123",
            },
        )

        login_response = client.post(
            "/api/v1/auth/login",
            json={"login": username, "password": "wrongpassword"},
        )

        assert login_response.status_code == 401
        assert login_response.json()["detail"] == "Invalid credentials"


def test_change_password_success() -> None:
    with TestClient(app) as client:
        suffix = uuid4().hex[:8]
        username = f"chgpw_{suffix}"
        email = f"{username}@example.com"
        password = "strongpassword123"
        new_password = "newstrongpass456"

        client.post(
            "/api/v1/auth/register",
            json={"username": username, "email": email, "password": password},
        )
        token = _access_token_after_password_login(client, username, password)

        patch_response = client.patch(
            "/api/v1/auth/me/password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": password, "new_password": new_password},
        )
        assert patch_response.status_code == 204
        assert patch_response.content == b""

        assert (
            client.post(
                "/api/v1/auth/login",
                json={"login": username, "password": password},
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/api/v1/auth/login",
                json={"login": username, "password": new_password},
            ).status_code
            == 200
        )


def test_change_password_rejects_wrong_current() -> None:
    with TestClient(app) as client:
        suffix = uuid4().hex[:8]
        username = f"badcur_{suffix}"
        email = f"{username}@example.com"
        password = "strongpassword123"

        client.post(
            "/api/v1/auth/register",
            json={"username": username, "email": email, "password": password},
        )
        token = _access_token_after_password_login(client, username, password)

        patch_response = client.patch(
            "/api/v1/auth/me/password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "wrongpassword123", "new_password": "otherpass999"},
        )
        assert patch_response.status_code == 400
        assert patch_response.json()["detail"] == "Current password is incorrect"


def test_change_password_accepts_current_with_outer_spaces() -> None:
    with TestClient(app) as client:
        suffix = uuid4().hex[:8]
        username = f"trimcur_{suffix}"
        email = f"{username}@example.com"
        password = "strongpassword123"
        new_password = "otherpass999"

        client.post(
            "/api/v1/auth/register",
            json={"username": username, "email": email, "password": password},
        )
        token = _access_token_after_password_login(client, username, password)

        patch_response = client.patch(
            "/api/v1/auth/me/password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": f"  {password}  ", "new_password": new_password},
        )
        assert patch_response.status_code == 204

        assert (
            client.post(
                "/api/v1/auth/login",
                json={"login": username, "password": new_password},
            ).status_code
            == 200
        )


def test_change_password_requires_auth() -> None:
    with TestClient(app) as client:
        response = client.patch(
            "/api/v1/auth/me/password",
            json={"current_password": "anypass123", "new_password": "otherpass999"},
        )
        assert response.status_code == 401


def test_patch_username_success() -> None:
    with TestClient(app) as client:
        suffix = uuid4().hex[:8]
        username = f"ren_{suffix}"
        email = f"{username}@example.com"
        password = "strongpassword123"
        new_name = f"renamed_{suffix}"

        client.post(
            "/api/v1/auth/register",
            json={"username": username, "email": email, "password": password},
        )
        token = _access_token_after_password_login(client, username, password)

        patch_response = client.patch(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            json={"username": new_name},
        )
        assert patch_response.status_code == 200
        assert patch_response.json()["username"] == new_name

        me = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        ).json()
        assert me["username"] == new_name

        assert (
            client.post(
                "/api/v1/auth/login",
                json={"login": new_name, "password": password},
            ).status_code
            == 200
        )


def test_patch_username_rejects_duplicate() -> None:
    with TestClient(app) as client:
        s1 = uuid4().hex[:8]
        s2 = uuid4().hex[:8]
        u1 = f"user1_{s1}"
        u2 = f"user2_{s2}"
        client.post(
            "/api/v1/auth/register",
            json={"username": u1, "email": f"{u1}@example.com", "password": "strongpassword123"},
        )
        client.post(
            "/api/v1/auth/register",
            json={"username": u2, "email": f"{u2}@example.com", "password": "strongpassword123"},
        )
        token = _access_token_after_password_login(client, u2, "strongpassword123")

        r = client.patch(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            json={"username": u1},
        )
        assert r.status_code == 400
        assert r.json()["detail"] == "Username already taken"


def test_patch_username_rejects_reserved_admin_name() -> None:
    with TestClient(app) as client:
        suffix = uuid4().hex[:8]
        username = f"pl_{suffix}"
        client.post(
            "/api/v1/auth/register",
            json={"username": username, "email": f"{username}@example.com", "password": "strongpassword123"},
        )
        token = _access_token_after_password_login(client, username, "strongpassword123")

        r = client.patch(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            json={"username": settings.admin_username},
        )
        assert r.status_code == 400
        assert r.json()["detail"] == "This username is reserved"


def test_patch_mc_avatar_variant_persists() -> None:
    with TestClient(app) as client:
        suffix = uuid4().hex[:8]
        username = f"av_{suffix}"
        client.post(
            "/api/v1/auth/register",
            json={"username": username, "email": f"{username}@example.com", "password": "strongpassword123"},
        )
        token = _access_token_after_password_login(client, username, "strongpassword123")

        r = client.patch(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            json={"mc_avatar_variant": "pig"},
        )
        assert r.status_code == 200
        assert r.json()["mc_avatar_variant"] == "pig"

        me = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        ).json()
        assert me["mc_avatar_variant"] == "pig"


def test_patch_mc_avatar_variant_rejects_unknown() -> None:
    with TestClient(app) as client:
        suffix = uuid4().hex[:8]
        username = f"badav_{suffix}"
        client.post(
            "/api/v1/auth/register",
            json={"username": username, "email": f"{username}@example.com", "password": "strongpassword123"},
        )
        token = _access_token_after_password_login(client, username, "strongpassword123")

        r = client.patch(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            json={"mc_avatar_variant": "not_a_real_variant"},
        )
        assert r.status_code == 400
        assert r.json()["detail"] == "Invalid avatar variant"


def test_patch_me_requires_at_least_one_field() -> None:
    with TestClient(app) as client:
        suffix = uuid4().hex[:8]
        username = f"empty_{suffix}"
        client.post(
            "/api/v1/auth/register",
            json={"username": username, "email": f"{username}@example.com", "password": "strongpassword123"},
        )
        token = _access_token_after_password_login(client, username, "strongpassword123")

        r = client.patch(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            json={},
        )
        assert r.status_code == 400
        assert r.json()["detail"] == "No fields to update"


