from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class ApiError(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ApiError


class SignInRequest(BaseModel):
    email: str
    password: str


class SignUpRequest(BaseModel):
    email: str
    password: str
    display_name: str = Field(min_length=1)


class User(BaseModel):
    id: str
    email: str
    display_name: str
    created_at: datetime


class AuthResult(BaseModel):
    user: User
    token: str


SessionState = Literal["draft", "live", "ended", "archived"]
ParticipantRole = Literal["owner", "interviewer", "candidate", "observer"]


class InterviewSession(BaseModel):
    id: str
    owner_user_id: str
    title: str
    prompt: str
    state: SessionState
    candidate_editing_enabled: bool
    scheduled_at: datetime | None
    started_at: datetime | None
    ended_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CreateSessionInput(BaseModel):
    title: str = Field(min_length=1)
    prompt: str
    scheduled_at: datetime | None = None


class UpdateSessionInput(BaseModel):
    title: str | None = None
    prompt: str | None = None
    candidate_editing_enabled: bool | None = None


class GuestLink(BaseModel):
    id: str
    session_id: str
    token: str
    role_granted: ParticipantRole
    expires_at: datetime | None
    max_uses: int | None
    revoked_at: datetime | None
    created_at: datetime


class CreateGuestLinkRequest(BaseModel):
    role: ParticipantRole = "candidate"


class Participant(BaseModel):
    id: str
    session_id: str
    user_id: str | None
    display_name: str
    role: ParticipantRole
    color: str
    joined_at: datetime
    left_at: datetime | None
    is_active: bool


class SessionDetails(BaseModel):
    session: InterviewSession
    participants: list[Participant]
    guest_links: list[GuestLink]


class ValidateTokenResult(BaseModel):
    session_id: str
    session_title: str
    role: ParticipantRole


class JoinSessionRequest(BaseModel):
    display_name: str = Field(min_length=1)


class JoinSessionResult(BaseModel):
    participant: Participant
    session: InterviewSession
    participant_token: str | None = None


class Point(BaseModel):
    x: float
    y: float


class ShapeElement(BaseModel):
    kind: Literal["shape"]
    id: str
    shape_type: str
    x: float
    y: float
    width: float
    height: float
    label: str
    description: str
    color: str
    z: float


class ConnectorElement(BaseModel):
    kind: Literal["connector"]
    id: str
    from_id: str | None
    to_id: str | None
    from_point: Point | None
    to_point: Point | None
    label: str
    style: Literal["straight", "elbow", "curved"]
    arrow_start: bool
    arrow_end: bool
    dashed: bool
    color: str
    z: float


class FreehandStroke(BaseModel):
    kind: Literal["freehand"]
    id: str
    points: list[Point]
    color: str
    width: float
    opacity: float = Field(ge=0, le=1)
    z: float


class TextLabelElement(BaseModel):
    kind: Literal["text"]
    id: str
    x: float
    y: float
    text: str
    font_size: float
    color: str
    z: float


class StickyNoteElement(BaseModel):
    kind: Literal["sticky"]
    id: str
    x: float
    y: float
    width: float
    height: float
    text: str
    color: str
    z: float


CanvasItem = Annotated[
    ShapeElement | ConnectorElement | FreehandStroke | TextLabelElement | StickyNoteElement,
    Field(discriminator="kind"),
]


class CanvasSnapshotData(BaseModel):
    items: dict[str, CanvasItem]
    item_order: list[str]
    schema_version: int = Field(ge=1)


class AddOperation(BaseModel):
    op: Literal["add"]
    item: CanvasItem


class UpdateOperation(BaseModel):
    op: Literal["update"]
    item: CanvasItem


class DeleteOperation(BaseModel):
    op: Literal["delete"]
    id: str


class MoveOperation(BaseModel):
    op: Literal["move"]
    ids: list[str]
    dx: float
    dy: float


class ResizeOperation(BaseModel):
    op: Literal["resize"]
    id: str
    width: float
    height: float


class RelabelOperation(BaseModel):
    op: Literal["relabel"]
    id: str
    label: str


class ClearOperation(BaseModel):
    op: Literal["clear"]


CanvasOperation = Annotated[
    AddOperation
    | UpdateOperation
    | DeleteOperation
    | MoveOperation
    | ResizeOperation
    | RelabelOperation
    | ClearOperation,
    Field(discriminator="op"),
]


class PresenceState(BaseModel):
    participant_id: str
    display_name: str
    color: str
    cursor: Point | None
    selected_ids: list[str]


class WsJoinRoom(BaseModel):
    type: Literal["join_room"]
    session_id: str


class WsDocumentUpdateIn(BaseModel):
    type: Literal["document_update"]
    session_id: str
    operation: CanvasOperation


class WsPresenceUpdateIn(BaseModel):
    type: Literal["presence_update"]
    session_id: str
    cursor: Point | None
    selected_ids: list[str]


class WsPing(BaseModel):
    type: Literal["ping"]


WsInboundMessage = Annotated[
    WsJoinRoom | WsDocumentUpdateIn | WsPresenceUpdateIn | WsPing,
    Field(discriminator="type"),
]


class WsRoomJoined(BaseModel):
    type: Literal["room_joined"] = "room_joined"
    session_id: str
    snapshot: CanvasSnapshotData
    participants: list[PresenceState]


class WsDocumentUpdateOut(WsDocumentUpdateIn):
    pass


class WsPresenceSnapshot(BaseModel):
    type: Literal["presence_snapshot"] = "presence_snapshot"
    session_id: str
    participants: list[PresenceState]


class WsPresenceUpdateOut(BaseModel):
    type: Literal["presence_update"] = "presence_update"
    session_id: str
    participant_id: str
    cursor: Point | None
    selected_ids: list[str]


class WsPermissionChanged(BaseModel):
    type: Literal["permission_changed"] = "permission_changed"
    session_id: str
    candidate_editing_enabled: bool


class WsSessionEnded(BaseModel):
    type: Literal["session_ended"] = "session_ended"
    session_id: str


class WsParticipantJoined(BaseModel):
    type: Literal["participant_joined"] = "participant_joined"
    session_id: str
    participant: PresenceState


class WsParticipantLeft(BaseModel):
    type: Literal["participant_left"] = "participant_left"
    session_id: str
    participant_id: str


class WsError(BaseModel):
    type: Literal["error"] = "error"
    code: str
    message: str


class WsPong(BaseModel):
    type: Literal["pong"] = "pong"


class ModelBase(BaseModel):
    model_config = ConfigDict(use_enum_values=True)
