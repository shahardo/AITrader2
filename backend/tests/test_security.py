# test_security.py — unit tests for password hashing and JWT create/decode.

import pytest

from app.core import security


def test_password_hash_roundtrip():
    hashed = security.hash_password("hunter22")
    assert hashed != "hunter22"
    assert security.verify_password("hunter22", hashed)
    assert not security.verify_password("wrong", hashed)


def test_verify_password_bad_hash_returns_false():
    assert not security.verify_password("x", "not-a-bcrypt-hash")


def test_token_roundtrip_and_kind_enforcement():
    access = security.create_token(7, "access")
    refresh = security.create_token(7, "refresh")
    assert security.decode_token(access, "access") == 7
    assert security.decode_token(refresh, "refresh") == 7
    import jwt

    with pytest.raises(jwt.InvalidTokenError):
        security.decode_token(access, "refresh")


def test_create_token_rejects_unknown_kind():
    with pytest.raises(ValueError):
        security.create_token(1, "session")
