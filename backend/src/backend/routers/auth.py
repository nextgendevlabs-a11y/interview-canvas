from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.auth import get_current_user
from backend.models import AuthResult, SignInRequest, SignUpRequest, User
from backend.routers.errors import api_error

router = APIRouter(prefix="/auth", tags=["Auth"])
bearer = HTTPBearer(auto_error=False)


@router.post("/sign-in", response_model=AuthResult)
def sign_in(payload: SignInRequest) -> AuthResult:
    from backend.main import store

    user = store.authenticate(payload.email, payload.password)
    if user is None:
        raise api_error(401, "invalid_credentials", "No account found with that email and password.")
    return AuthResult(user=user, token=store.issue_bearer(user.id))


@router.post("/sign-up", response_model=AuthResult, status_code=201)
def sign_up(payload: SignUpRequest) -> AuthResult:
    from backend.main import store

    try:
        user = store.create_user(payload.email, payload.password, payload.display_name)
    except ValueError:
        raise api_error(409, "email_exists", "An account with that email already exists.") from None
    return AuthResult(user=user, token=store.issue_bearer(user.id))


@router.post("/sign-out", status_code=204)
def sign_out(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> None:
    from backend.main import store

    if credentials:
        store.revoke_bearer(credentials.credentials)


@router.get("/me", response_model=User)
def me(user: User = Depends(get_current_user)) -> User:
    return user
