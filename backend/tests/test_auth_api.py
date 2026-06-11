# test_auth_api.py — API tests for signup, login, refresh, and the /me profile flow.

SIGNUP = {"email": "a@b.com", "password": "longenough1"}


def test_signup_login_me_flow(client):
    resp = client.post("/api/v1/auth/signup", json=SIGNUP)
    assert resp.status_code == 201
    tokens = resp.json()
    assert tokens["access_token"] and tokens["refresh_token"]

    resp = client.post("/api/v1/auth/login", json=SIGNUP)
    assert resp.status_code == 200

    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    me = client.get("/api/v1/me", headers=headers)
    assert me.status_code == 200
    body = me.json()
    assert body["email"] == "a@b.com"
    assert body["risk_level"] == "balanced"
    assert body["telegram_linked"] is False


def test_signup_duplicate_email_conflict(client):
    assert client.post("/api/v1/auth/signup", json=SIGNUP).status_code == 201
    assert client.post("/api/v1/auth/signup", json=SIGNUP).status_code == 409


def test_login_wrong_password_rejected(client):
    client.post("/api/v1/auth/signup", json=SIGNUP)
    resp = client.post("/api/v1/auth/login", json={"email": "a@b.com", "password": "wrongwrong"})
    assert resp.status_code == 401


def test_refresh_issues_new_pair(client):
    tokens = client.post("/api/v1/auth/signup", json=SIGNUP).json()
    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert resp.status_code == 200
    assert resp.json()["access_token"]


def test_refresh_rejects_access_token(client):
    tokens = client.post("/api/v1/auth/signup", json=SIGNUP).json()
    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["access_token"]})
    assert resp.status_code == 401


def test_me_requires_auth(client):
    assert client.get("/api/v1/me").status_code == 401


def test_patch_me_updates_profile(client, auth_headers):
    resp = client.patch(
        "/api/v1/me", json={"risk_level": "aggressive", "markets": "us"}, headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["risk_level"] == "aggressive"
    assert resp.json()["markets"] == "us"
