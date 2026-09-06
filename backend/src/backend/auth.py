from __future__ import annotations

import hashlib
import hmac
import secrets

from fastapi import Depends, Header
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.models import User

PASSWORD_ITERATIONS = 260_000
TOKEN_BYTES = 32
_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("ascii"),
        PASSWORD_ITERATIONS,
    ).hex()
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt}${digest}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations, salt, expected = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("ascii"),
            int(iterations),
        ).hex()
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, expected)


def new_token() -> str:
    return secrets.token_hex(TOKEN_BYTES)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User:
    from backend.main import store
    from backend.routers.errors import api_error

    if credentials is None:
        raise api_error(401, "unauthorized", "Authentication is required.")
    user = store.user_for_token(credentials.credentials)
    if user is None:
        raise api_error(401, "unauthorized", "Invalid or expired bearer token.")
    return user


def get_optional_auth_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    x_participant_token: str | None = Header(default=None, alias="X-Participant-Token"),
) -> tuple[User | None, str | None]:
    from backend.main import store

    user = store.user_for_token(credentials.credentials) if credentials else None
    participant_id = store.participant_for_token(x_participant_token) if x_participant_token else None
    return user, participant_id
