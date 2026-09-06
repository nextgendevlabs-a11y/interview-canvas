from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.auth import get_current_user
from backend.models import CreateGuestLinkRequest, GuestLink, User
from backend.routers.errors import api_error
from backend.routers.sessions import require_owner

router = APIRouter(prefix="/sessions/{id}/guest-links", tags=["Guest Links"])


@router.post("", response_model=GuestLink, status_code=201)
def create_guest_link(
    id: str,
    payload: CreateGuestLinkRequest | None = None,
    user: User = Depends(get_current_user),
) -> GuestLink:
    from backend.main import store

    require_owner(id, user)
    role = payload.role if payload else "candidate"
    link = store.create_guest_link(id, role)
    if link is None:
        raise api_error(404, "not_found", "Session not found.")
    return link


@router.delete("/{link_id}", status_code=204)
def revoke_guest_link(id: str, link_id: str, user: User = Depends(get_current_user)) -> None:
    from backend.main import store

    require_owner(id, user)
    if not store.revoke_guest_link(id, link_id):
        raise api_error(404, "not_found", "Guest link not found.")
