from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import RLock
from uuid import uuid4

from backend.auth import hash_password, new_token, verify_password
from backend.models import (
    CanvasOperation,
    CanvasSnapshotData,
    GuestLink,
    InterviewSession,
    Participant,
    ParticipantRole,
    User,
)

PARTICIPANT_COLORS = [
    "#3b82f6",
    "#ef4444",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#84cc16",
]


@dataclass
class SessionRecord:
    session: InterviewSession
    participants: list[Participant] = field(default_factory=list)
    guest_links: list[GuestLink] = field(default_factory=list)
    canvas: CanvasSnapshotData = field(default_factory=lambda: CanvasSnapshotData(items={}, item_order=[], schema_version=1))
    presence: dict[str, dict] = field(default_factory=dict)


class MemoryStore:
    def __init__(self, seed: bool = True) -> None:
        self._lock = RLock()
        self.users: dict[str, User] = {}
        self.password_hashes: dict[str, str] = {}
        self.email_to_user_id: dict[str, str] = {}
        self.bearer_tokens: dict[str, str] = {}
        self.participant_tokens: dict[str, str] = {}
        self.guest_token_to_link_id: dict[str, str] = {}
        self.sessions: dict[str, SessionRecord] = {}
        self._color_index = 0
        if seed:
            self.seed()

    def reset(self, seed: bool = True) -> None:
        with self._lock:
            self.__init__(seed=seed)

    def seed(self) -> None:
        demo = self.create_user("demo@interview.dev", "password", "Demo Interviewer")
        other = self.create_user("alex@example.com", "password", "Alex Reviewer")
        live = self.create_session(
            demo.id,
            "Design a URL Shortener",
            "Design a globally available URL shortening service with analytics and abuse controls.",
        )
        self.start_session(live.id)
        self.join_owner(live.id, demo)
        self.add_participant(live.id, "Candidate Sam", "candidate")
        self.create_guest_link(live.id, "candidate")
        self.save_canvas(
            live.id,
            CanvasSnapshotData(
                schema_version=1,
                item_order=["client", "api", "db", "cache"],
                items={
                    "client": {
                        "kind": "shape",
                        "id": "client",
                        "shape_type": "client",
                        "x": 80,
                        "y": 120,
                        "width": 150,
                        "height": 80,
                        "label": "Browser Client",
                        "description": "",
                        "color": "#3b82f6",
                        "z": 1,
                    },
                    "api": {
                        "kind": "shape",
                        "id": "api",
                        "shape_type": "api_gateway",
                        "x": 330,
                        "y": 120,
                        "width": 160,
                        "height": 80,
                        "label": "API Gateway",
                        "description": "",
                        "color": "#10b981",
                        "z": 2,
                    },
                    "db": {
                        "kind": "shape",
                        "id": "db",
                        "shape_type": "database",
                        "x": 580,
                        "y": 80,
                        "width": 160,
                        "height": 80,
                        "label": "URL Store",
                        "description": "",
                        "color": "#8b5cf6",
                        "z": 3,
                    },
                    "cache": {
                        "kind": "shape",
                        "id": "cache",
                        "shape_type": "cache",
                        "x": 580,
                        "y": 220,
                        "width": 160,
                        "height": 80,
                        "label": "Redis Cache",
                        "description": "",
                        "color": "#f59e0b",
                        "z": 4,
                    },
                },
            ),
        )
        draft = self.create_session(demo.id, "Design a Notification System", "Discuss fanout, preferences, and delivery guarantees.")
        self.join_owner(draft.id, demo)
        self.create_guest_link(draft.id, "candidate")
        ended = self.create_session(other.id, "Design a Chat App", "Cover realtime delivery, offline sync, and moderation.")
        self.start_session(ended.id)
        self.end_session(ended.id)
        self.join_owner(ended.id, other)

    @staticmethod
    def now() -> datetime:
        return datetime.now(UTC)

    @staticmethod
    def new_id() -> str:
        return str(uuid4())

    def create_user(self, email: str, password: str, display_name: str) -> User:
        email_key = email.lower()
        with self._lock:
            if email_key in self.email_to_user_id:
                raise ValueError("email_exists")
            user = User(id=self.new_id(), email=email_key, display_name=display_name, created_at=self.now())
            self.users[user.id] = user
            self.email_to_user_id[email_key] = user.id
            self.password_hashes[user.id] = hash_password(password)
            return user

    def authenticate(self, email: str, password: str) -> User | None:
        with self._lock:
            user_id = self.email_to_user_id.get(email.lower())
            if not user_id:
                return None
            if not verify_password(password, self.password_hashes[user_id]):
                return None
            return self.users[user_id]

    def issue_bearer(self, user_id: str) -> str:
        token = new_token()
        with self._lock:
            self.bearer_tokens[token] = user_id
        return token

    def revoke_bearer(self, token: str) -> None:
        with self._lock:
            self.bearer_tokens.pop(token, None)

    def user_for_token(self, token: str) -> User | None:
        with self._lock:
            user_id = self.bearer_tokens.get(token)
            return self.users.get(user_id) if user_id else None

    def participant_for_token(self, token: str) -> str | None:
        with self._lock:
            return self.participant_tokens.get(token)

    def create_session(self, owner_user_id: str, title: str, prompt: str, scheduled_at: datetime | None = None) -> InterviewSession:
        ts = self.now()
        session = InterviewSession(
            id=self.new_id(),
            owner_user_id=owner_user_id,
            title=title,
            prompt=prompt,
            state="draft",
            candidate_editing_enabled=True,
            scheduled_at=scheduled_at,
            started_at=None,
            ended_at=None,
            created_at=ts,
            updated_at=ts,
        )
        with self._lock:
            self.sessions[session.id] = SessionRecord(session=session)
        return session

    def list_sessions_for_user(self, user_id: str) -> list[InterviewSession]:
        with self._lock:
            sessions = [record.session for record in self.sessions.values() if record.session.owner_user_id == user_id]
        return sorted(sessions, key=lambda item: item.updated_at, reverse=True)

    def get_record(self, session_id: str) -> SessionRecord | None:
        with self._lock:
            return self.sessions.get(session_id)

    def update_session(self, session_id: str, **updates: object) -> InterviewSession | None:
        with self._lock:
            record = self.sessions.get(session_id)
            if record is None:
                return None
            data = record.session.model_dump()
            data.update({key: value for key, value in updates.items() if value is not None})
            data["updated_at"] = self.now()
            record.session = InterviewSession(**data)
            return record.session

    def start_session(self, session_id: str) -> InterviewSession | None:
        with self._lock:
            record = self.sessions.get(session_id)
            if record is None:
                return None
            ts = self.now()
            record.session = record.session.model_copy(update={"state": "live", "started_at": ts, "updated_at": ts})
            return record.session

    def end_session(self, session_id: str) -> InterviewSession | None:
        with self._lock:
            record = self.sessions.get(session_id)
            if record is None:
                return None
            ts = self.now()
            record.session = record.session.model_copy(update={"state": "ended", "ended_at": ts, "updated_at": ts})
            return record.session

    def archive_session(self, session_id: str) -> InterviewSession | None:
        with self._lock:
            record = self.sessions.get(session_id)
            if record is None:
                return None
            record.session = record.session.model_copy(update={"state": "archived", "updated_at": self.now()})
            return record.session

    def duplicate_session(self, session_id: str, owner_user_id: str) -> InterviewSession | None:
        with self._lock:
            record = self.sessions.get(session_id)
            if record is None:
                return None
            new_session = self.create_session(owner_user_id, f"{record.session.title} (Copy)", record.session.prompt, record.session.scheduled_at)
            new_record = self.sessions[new_session.id]
            new_record.canvas = deepcopy(record.canvas)
            return new_session

    def create_guest_link(self, session_id: str, role: ParticipantRole = "candidate") -> GuestLink | None:
        with self._lock:
            record = self.sessions.get(session_id)
            if record is None:
                return None
            link = GuestLink(
                id=self.new_id(),
                session_id=session_id,
                token=new_token(),
                role_granted=role,
                expires_at=None,
                max_uses=None,
                revoked_at=None,
                created_at=self.now(),
            )
            record.guest_links.append(link)
            self.guest_token_to_link_id[link.token] = link.id
            return link

    def revoke_guest_link(self, session_id: str, link_id: str) -> bool:
        with self._lock:
            record = self.sessions.get(session_id)
            if record is None:
                return False
            for index, link in enumerate(record.guest_links):
                if link.id == link_id:
                    record.guest_links[index] = link.model_copy(update={"revoked_at": self.now()})
                    return True
            return False

    def link_for_token(self, token: str) -> tuple[SessionRecord, GuestLink] | None:
        with self._lock:
            link_id = self.guest_token_to_link_id.get(token)
            if not link_id:
                return None
            for record in self.sessions.values():
                for link in record.guest_links:
                    if link.id == link_id:
                        return record, link
            return None

    def active_participant_count(self, session_id: str) -> int:
        record = self.sessions[session_id]
        return len([p for p in record.participants if p.left_at is None])

    def next_color(self) -> str:
        color = PARTICIPANT_COLORS[self._color_index % len(PARTICIPANT_COLORS)]
        self._color_index += 1
        return color

    def add_participant(self, session_id: str, display_name: str, role: ParticipantRole, user_id: str | None = None) -> Participant:
        participant = Participant(
            id=self.new_id(),
            session_id=session_id,
            user_id=user_id,
            display_name=display_name,
            role=role,
            color=self.next_color(),
            joined_at=self.now(),
            left_at=None,
            is_active=True,
        )
        with self._lock:
            self.sessions[session_id].participants.append(participant)
        return participant

    def join_owner(self, session_id: str, user: User) -> Participant:
        return self.add_participant(session_id, user.display_name, "owner", user.id)

    def issue_participant_token(self, participant_id: str) -> str:
        token = new_token()
        with self._lock:
            self.participant_tokens[token] = participant_id
        return token

    def get_canvas(self, session_id: str) -> CanvasSnapshotData | None:
        with self._lock:
            record = self.sessions.get(session_id)
            return deepcopy(record.canvas) if record else None

    def save_canvas(self, session_id: str, snapshot: CanvasSnapshotData) -> bool:
        with self._lock:
            record = self.sessions.get(session_id)
            if record is None:
                return False
            record.canvas = deepcopy(snapshot)
            record.session = record.session.model_copy(update={"updated_at": self.now()})
            return True

    def apply_operation(self, session_id: str, operation: CanvasOperation) -> CanvasSnapshotData | None:
        with self._lock:
            record = self.sessions.get(session_id)
            if record is None:
                return None
            snapshot = record.canvas.model_copy(deep=True)
            match operation.op:
                case "add" | "update":
                    item = operation.item
                    snapshot.items[item.id] = item
                    if item.id not in snapshot.item_order:
                        snapshot.item_order.append(item.id)
                case "delete":
                    snapshot.items.pop(operation.id, None)
                    snapshot.item_order = [item_id for item_id in snapshot.item_order if item_id != operation.id]
                case "move":
                    for item_id in operation.ids:
                        item = snapshot.items.get(item_id)
                        if item and hasattr(item, "x") and hasattr(item, "y"):
                            item.x += operation.dx
                            item.y += operation.dy
                case "resize":
                    item = snapshot.items.get(operation.id)
                    if item and hasattr(item, "width") and hasattr(item, "height"):
                        item.width = operation.width
                        item.height = operation.height
                case "relabel":
                    item = snapshot.items.get(operation.id)
                    if item and hasattr(item, "label"):
                        item.label = operation.label
                case "clear":
                    snapshot = CanvasSnapshotData(items={}, item_order=[], schema_version=snapshot.schema_version)
            record.canvas = snapshot
            record.session = record.session.model_copy(update={"updated_at": self.now()})
            return deepcopy(snapshot)

    def can_access_session(self, session_id: str, user: User | None, participant_id: str | None) -> bool:
        record = self.sessions.get(session_id)
        if record is None:
            return False
        if user and record.session.owner_user_id == user.id:
            return True
        if participant_id and any(p.id == participant_id and p.session_id == session_id for p in record.participants):
            return True
        return False
