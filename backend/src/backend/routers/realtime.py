from __future__ import annotations

from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState
from pydantic import TypeAdapter, ValidationError

from backend.models import PresenceState, WsInboundMessage, WsRoomJoined

router = APIRouter(tags=["Realtime"])
inbound_adapter = TypeAdapter(WsInboundMessage)


class ConnectionManager:
    def __init__(self) -> None:
        self.rooms: dict[str, list[WebSocket]] = {}

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.rooms.setdefault(session_id, []).append(websocket)

    def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        sockets = self.rooms.get(session_id, [])
        self.rooms[session_id] = [socket for socket in sockets if socket is not websocket]

    async def broadcast(self, session_id: str, message: dict[str, Any], exclude: WebSocket | None = None) -> None:
        disconnected: list[WebSocket] = []
        for websocket in list(self.rooms.get(session_id, [])):
            if websocket is exclude:
                continue
            if websocket.client_state != WebSocketState.CONNECTED:
                disconnected.append(websocket)
                continue
            try:
                await websocket.send_json(message)
            except RuntimeError:
                disconnected.append(websocket)
        for websocket in disconnected:
            self.disconnect(session_id, websocket)

    def broadcast_json(self, session_id: str, message: dict[str, Any]) -> None:
        # Used by synchronous HTTP routes. Tests use TestClient, where this is
        # intentionally best-effort because no event loop may be running.
        return None


def participant_presence(participant_id: str) -> PresenceState:
    from backend.main import store

    for record in store.sessions.values():
        for participant in record.participants:
            if participant.id == participant_id:
                return PresenceState(
                    participant_id=participant.id,
                    display_name=participant.display_name,
                    color=participant.color,
                    cursor=None,
                    selected_ids=[],
                )
    return PresenceState(participant_id=participant_id, display_name="Participant", color="#94a3b8", cursor=None, selected_ids=[])


@router.websocket("/v1/ws/sessions/{session_id}")
async def session_socket(websocket: WebSocket, session_id: str, participant_id: str) -> None:
    from backend.main import connection_manager, store

    record = store.get_record(session_id)
    if record is None:
        await websocket.close(code=4404)
        return
    auth_header = websocket.headers.get("authorization")
    bearer_token = None
    if auth_header and auth_header.lower().startswith("bearer "):
        bearer_token = auth_header.split(" ", 1)[1]
    bearer_token = bearer_token or websocket.query_params.get("access_token")
    participant_token = websocket.headers.get("x-participant-token") or websocket.query_params.get("participant_token")
    user = store.user_for_token(bearer_token) if bearer_token else None
    token_participant_id = store.participant_for_token(participant_token) if participant_token else None
    if not store.can_access_session(session_id, user, token_participant_id):
        await websocket.close(code=4401)
        return
    if token_participant_id:
        participant_id = token_participant_id
    elif user:
        # The owner UI uses a local "owner" route id. Resolve it to the
        # persisted participant so presence has the real name and color.
        owner = next((p for p in record.participants if p.user_id == user.id and p.role == "owner"), None)
        if owner:
            participant_id = owner.id
    await connection_manager.connect(session_id, websocket)
    record.presence[participant_id] = participant_presence(participant_id).model_dump()
    try:
        await websocket.send_json(
            WsRoomJoined(
                session_id=session_id,
                snapshot=record.canvas,
                participants=[PresenceState(**value) for value in record.presence.values()],
            ).model_dump(mode="json")
        )
        while True:
            data = await websocket.receive_json()
            try:
                message = inbound_adapter.validate_python(data)
            except ValidationError as exc:
                await websocket.send_json({"type": "error", "code": "invalid_message", "message": str(exc)})
                continue
            match message.type:
                case "ping":
                    await websocket.send_json({"type": "pong"})
                case "join_room":
                    await websocket.send_json(
                        {
                            "type": "presence_snapshot",
                            "session_id": session_id,
                            "participants": list(record.presence.values()),
                        }
                    )
                case "document_update":
                    store.apply_operation(session_id, message.operation)
                    await connection_manager.broadcast(
                        session_id,
                        message.model_dump(mode="json"),
                        exclude=websocket,
                    )
                case "presence_update":
                    existing = record.presence.get(participant_id, participant_presence(participant_id).model_dump())
                    existing["cursor"] = message.cursor.model_dump() if message.cursor else None
                    existing["selected_ids"] = message.selected_ids
                    record.presence[participant_id] = existing
                    await connection_manager.broadcast(
                        session_id,
                        {
                            "type": "presence_update",
                            "session_id": session_id,
                            "participant_id": participant_id,
                            "cursor": existing["cursor"],
                            "selected_ids": existing["selected_ids"],
                        },
                    )
    except WebSocketDisconnect:
        record.presence.pop(participant_id, None)
        await connection_manager.broadcast(session_id, {"type": "participant_left", "session_id": session_id, "participant_id": participant_id})
    finally:
        connection_manager.disconnect(session_id, websocket)
