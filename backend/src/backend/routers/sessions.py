from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.auth import get_current_user
from backend.models import CreateSessionInput, InterviewSession, SessionDetails, UpdateSessionInput, User
from backend.routers.errors import api_error

router = APIRouter(prefix="/sessions", tags=["Sessions"])


def require_owner(session_id: str, user: User) -> None:
    from backend.main import store

    record = store.get_record(session_id)
    if record is None:
        raise api_error(404, "not_found", "Session not found.")
    if record.session.owner_user_id != user.id:
        raise api_error(403, "forbidden", "Only the session owner can perform this action.")


@router.get("", response_model=list[InterviewSession])
def list_sessions(user: User = Depends(get_current_user)) -> list[InterviewSession]:
    from backend.main import store

    return store.list_sessions_for_user(user.id)


@router.post("", response_model=InterviewSession, status_code=201)
def create_session(payload: CreateSessionInput, user: User = Depends(get_current_user)) -> InterviewSession:
    from backend.main import store

    session = store.create_session(user.id, payload.title, payload.prompt, payload.scheduled_at)
    store.join_owner(session.id, user)
    return session


@router.get("/{id}", response_model=SessionDetails)
def get_session(id: str, user: User = Depends(get_current_user)) -> SessionDetails:
    from backend.main import store

    record = store.get_record(id)
    if record is None:
        raise api_error(404, "not_found", "Session not found.")
    if record.session.owner_user_id != user.id:
        raise api_error(403, "forbidden", "You do not have access to this session.")
    return SessionDetails(session=record.session, participants=record.participants, guest_links=record.guest_links)


@router.patch("/{id}", response_model=InterviewSession)
def update_session(id: str, payload: UpdateSessionInput, user: User = Depends(get_current_user)) -> InterviewSession:
    from backend.main import connection_manager, store

    require_owner(id, user)
    if payload.model_dump(exclude_none=True) == {}:
        raise api_error(400, "empty_update", "At least one field must be provided.")
    updated = store.update_session(id, **payload.model_dump())
    if updated is None:
        raise api_error(404, "not_found", "Session not found.")
    if payload.candidate_editing_enabled is not None:
        connection_manager.broadcast_json(
            id,
            {
                "type": "permission_changed",
                "session_id": id,
                "candidate_editing_enabled": payload.candidate_editing_enabled,
            },
        )
    return updated


@router.post("/{id}/start", response_model=InterviewSession)
def start_session(id: str, user: User = Depends(get_current_user)) -> InterviewSession:
    from backend.main import store

    require_owner(id, user)
    session = store.start_session(id)
    if session is None:
        raise api_error(404, "not_found", "Session not found.")
    return session


@router.post("/{id}/end", response_model=InterviewSession)
def end_session(id: str, user: User = Depends(get_current_user)) -> InterviewSession:
    from backend.main import connection_manager, store

    require_owner(id, user)
    session = store.end_session(id)
    if session is None:
        raise api_error(404, "not_found", "Session not found.")
    connection_manager.broadcast_json(id, {"type": "session_ended", "session_id": id})
    return session


@router.post("/{id}/archive", response_model=InterviewSession)
def archive_session(id: str, user: User = Depends(get_current_user)) -> InterviewSession:
    from backend.main import store

    require_owner(id, user)
    session = store.archive_session(id)
    if session is None:
        raise api_error(404, "not_found", "Session not found.")
    return session


@router.post("/{id}/duplicate", response_model=InterviewSession, status_code=201)
def duplicate_session(id: str, user: User = Depends(get_current_user)) -> InterviewSession:
    from backend.main import store

    require_owner(id, user)
    session = store.duplicate_session(id, user.id)
    if session is None:
        raise api_error(404, "not_found", "Session not found.")
    store.join_owner(session.id, user)
    return session
