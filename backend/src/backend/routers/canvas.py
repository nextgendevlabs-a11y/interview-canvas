from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.auth import get_optional_auth_context
from backend.models import CanvasSnapshotData, User
from backend.routers.errors import api_error

router = APIRouter(prefix="/sessions/{id}/canvas", tags=["Canvas"])


def require_session_access(id: str, context: tuple[User | None, str | None]) -> None:
    from backend.main import store

    user, participant_id = context
    if store.get_record(id) is None:
        raise api_error(404, "not_found", "Session not found.")
    if not store.can_access_session(id, user, participant_id):
        raise api_error(401, "unauthorized", "Valid bearer or participant authentication is required.")


@router.get("", response_model=CanvasSnapshotData)
def get_canvas(id: str, context: tuple[User | None, str | None] = Depends(get_optional_auth_context)) -> CanvasSnapshotData:
    from backend.main import store

    require_session_access(id, context)
    snapshot = store.get_canvas(id)
    if snapshot is None:
        raise api_error(404, "not_found", "Session not found.")
    return snapshot


@router.put("", status_code=204)
def save_canvas(
    id: str,
    payload: CanvasSnapshotData,
    context: tuple[User | None, str | None] = Depends(get_optional_auth_context),
) -> None:
    from backend.main import store

    require_session_access(id, context)
    if not store.save_canvas(id, payload):
        raise api_error(404, "not_found", "Session not found.")
