from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter

from backend.models import JoinSessionRequest, JoinSessionResult, ValidateTokenResult
from backend.routers.errors import api_error

router = APIRouter(prefix="/join", tags=["Join"])


def validate_link_or_error(token: str):
    from backend.main import store

    result = store.link_for_token(token)
    if result is None:
        raise api_error(404, "invalid_token", "Invalid or expired link.")
    record, link = result
    if link.revoked_at is not None:
        raise api_error(409, "link_revoked", "This link has been revoked.")
    if link.expires_at is not None and link.expires_at < datetime.now(UTC):
        raise api_error(409, "link_expired", "This link has expired.")
    if record.session.state == "archived":
        raise api_error(409, "session_archived", "This session has been archived.")
    if store.active_participant_count(record.session.id) >= 10:
        raise api_error(409, "capacity_reached", "This session is at maximum capacity (10 participants).")
    return record, link


@router.post("/{token}/validate", response_model=ValidateTokenResult)
def validate_token(token: str) -> ValidateTokenResult:
    record, link = validate_link_or_error(token)
    return ValidateTokenResult(session_id=record.session.id, session_title=record.session.title, role=link.role_granted)


@router.post("/{token}", response_model=JoinSessionResult)
def join_session(token: str, payload: JoinSessionRequest) -> JoinSessionResult:
    from backend.main import connection_manager, store

    record, link = validate_link_or_error(token)
    participant = store.add_participant(record.session.id, payload.display_name.strip(), link.role_granted)
    participant_token = store.issue_participant_token(participant.id)
    connection_manager.broadcast_json(
        record.session.id,
        {
            "type": "participant_joined",
            "session_id": record.session.id,
            "participant": {
                "participant_id": participant.id,
                "display_name": participant.display_name,
                "color": participant.color,
                "cursor": None,
                "selected_ids": [],
            },
        },
    )
    return JoinSessionResult(participant=participant, session=record.session, participant_token=participant_token)
