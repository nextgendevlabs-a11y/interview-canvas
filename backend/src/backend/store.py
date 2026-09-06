from __future__ import annotations

import json
import os
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import RLock
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine, delete, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import NullPool

from backend.auth import hash_password, new_token, verify_password
from backend.models import CanvasOperation, CanvasSnapshotData, GuestLink, InterviewSession, Participant, ParticipantRole, User

PARTICIPANT_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"]


class Base(DeclarativeBase):
    pass


class UserRow(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    display_name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class TokenRow(Base):
    __tablename__ = "tokens"
    token: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    participant_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)


class SessionRow(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    prompt: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(20))
    candidate_editing_enabled: Mapped[bool] = mapped_column(Boolean)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ParticipantRow(Base):
    __tablename__ = "participants"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    display_name: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))
    color: Mapped[str] = mapped_column(String(20))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean)


class GuestLinkRow(Base):
    __tablename__ = "guest_links"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    token: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    role_granted: Mapped[str] = mapped_column(String(20))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class CanvasRow(Base):
    __tablename__ = "canvases"
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), primary_key=True)
    snapshot: Mapped[str] = mapped_column(Text)


@dataclass
class SessionRecord:
    session: InterviewSession
    participants: list[Participant] = field(default_factory=list)
    guest_links: list[GuestLink] = field(default_factory=list)
    canvas: CanvasSnapshotData = field(default_factory=lambda: CanvasSnapshotData(items={}, item_order=[], schema_version=1))
    presence: dict[str, dict] = field(default_factory=dict)


class DatabaseStore:
    """Repository using SQLAlchemy; DATABASE_URL selects the database backend."""

    def __init__(self, database_url: str | None = None, seed: bool = True) -> None:
        self.database_url = database_url or os.getenv("DATABASE_URL", "sqlite:///./interview_canvas.db")
        is_sqlite = self.database_url.startswith("sqlite")
        args = {"check_same_thread": False} if is_sqlite else {}
        self.engine = create_engine(self.database_url, connect_args=args, poolclass=NullPool if is_sqlite else None)
        self.Session = sessionmaker(self.engine, expire_on_commit=False)
        Base.metadata.create_all(self.engine)
        self._lock = RLock()
        self._presence: dict[str, dict[str, dict]] = {}
        self._color_index = 0
        if seed and not self._has_data():
            self.seed()

    @staticmethod
    def now() -> datetime:
        return datetime.now(UTC)

    @staticmethod
    def new_id() -> str:
        return str(uuid4())

    def _has_data(self) -> bool:
        with self.Session() as db:
            return db.scalar(select(UserRow.id).limit(1)) is not None

    def reset(self, seed: bool = True) -> None:
        with self._lock:
            Base.metadata.drop_all(self.engine)
            Base.metadata.create_all(self.engine)
            self._presence.clear()
            self._color_index = 0
            if seed:
                self.seed()

    def seed(self) -> None:
        demo = self.create_user("demo@interview.dev", "password", "Demo Interviewer")
        other = self.create_user("alex@example.com", "password", "Alex Reviewer")
        live = self.create_session(demo.id, "Design a URL Shortener", "Design a globally available URL shortening service with analytics and abuse controls.")
        self.start_session(live.id)
        self.join_owner(live.id, demo)
        self.add_participant(live.id, "Candidate Sam", "candidate")
        self.create_guest_link(live.id)
        self.save_canvas(live.id, CanvasSnapshotData(items={}, item_order=[], schema_version=1))
        draft = self.create_session(demo.id, "Design a Notification System", "Discuss fanout, preferences, and delivery guarantees.")
        self.join_owner(draft.id, demo)
        self.create_guest_link(draft.id)
        ended = self.create_session(other.id, "Design a Chat App", "Cover realtime delivery, offline sync, and moderation.")
        self.start_session(ended.id)
        self.end_session(ended.id)
        self.join_owner(ended.id, other)

    @staticmethod
    def _user(row: UserRow) -> User:
        return User(id=row.id, email=row.email, display_name=row.display_name, created_at=row.created_at)

    @staticmethod
    def _session(row: SessionRow) -> InterviewSession:
        fields = ("id", "owner_user_id", "title", "prompt", "state", "candidate_editing_enabled", "scheduled_at", "started_at", "ended_at", "created_at", "updated_at")
        return InterviewSession.model_validate({key: getattr(row, key) for key in fields})

    @staticmethod
    def _participant(row: ParticipantRow) -> Participant:
        fields = ("id", "session_id", "user_id", "display_name", "role", "color", "joined_at", "left_at", "is_active")
        return Participant.model_validate({key: getattr(row, key) for key in fields})

    @staticmethod
    def _link(row: GuestLinkRow) -> GuestLink:
        fields = ("id", "session_id", "token", "role_granted", "expires_at", "max_uses", "revoked_at", "created_at")
        return GuestLink.model_validate({key: getattr(row, key) for key in fields})

    def create_user(self, email: str, password: str, display_name: str) -> User:
        row = UserRow(id=self.new_id(), email=email.lower(), password_hash=hash_password(password), display_name=display_name, created_at=self.now())
        with self.Session.begin() as db:
            if db.scalar(select(UserRow).where(UserRow.email == row.email)):
                raise ValueError("email_exists")
            db.add(row)
        return self._user(row)

    def authenticate(self, email: str, password: str) -> User | None:
        with self.Session() as db:
            row = db.scalar(select(UserRow).where(UserRow.email == email.lower()))
            return self._user(row) if row and verify_password(password, row.password_hash) else None

    def issue_bearer(self, user_id: str) -> str:
        token = new_token()
        with self.Session.begin() as db:
            db.add(TokenRow(token=token, user_id=user_id))
        return token

    def revoke_bearer(self, token: str) -> None:
        with self.Session.begin() as db:
            db.execute(delete(TokenRow).where(TokenRow.token == token, TokenRow.user_id.is_not(None)))

    def user_for_token(self, token: str) -> User | None:
        with self.Session() as db:
            row = db.scalar(select(UserRow).join(TokenRow, TokenRow.user_id == UserRow.id).where(TokenRow.token == token))
            return self._user(row) if row else None

    def participant_for_token(self, token: str) -> str | None:
        with self.Session() as db:
            return db.scalar(select(TokenRow.participant_id).where(TokenRow.token == token, TokenRow.participant_id.is_not(None)))

    def create_session(self, owner_user_id: str, title: str, prompt: str, scheduled_at: datetime | None = None) -> InterviewSession:
        ts = self.now()
        row = SessionRow(id=self.new_id(), owner_user_id=owner_user_id, title=title, prompt=prompt, state="draft", candidate_editing_enabled=True, scheduled_at=scheduled_at, started_at=None, ended_at=None, created_at=ts, updated_at=ts)
        with self.Session.begin() as db:
            db.add(row)
            db.add(CanvasRow(session_id=row.id, snapshot=json.dumps(CanvasSnapshotData(items={}, item_order=[], schema_version=1).model_dump(mode="json"))))
        return self._session(row)

    def list_sessions_for_user(self, user_id: str) -> list[InterviewSession]:
        with self.Session() as db:
            rows = db.scalars(select(SessionRow).where(SessionRow.owner_user_id == user_id).order_by(SessionRow.updated_at.desc())).all()
            return [self._session(row) for row in rows]

    def _record(self, db, session_id: str) -> SessionRecord | None:
        row = db.get(SessionRow, session_id)
        if row is None:
            return None
        participants = db.scalars(select(ParticipantRow).where(ParticipantRow.session_id == session_id)).all()
        links = db.scalars(select(GuestLinkRow).where(GuestLinkRow.session_id == session_id)).all()
        canvas = db.get(CanvasRow, session_id)
        snapshot = CanvasSnapshotData.model_validate(json.loads(canvas.snapshot)) if canvas else CanvasSnapshotData(items={}, item_order=[], schema_version=1)
        return SessionRecord(self._session(row), [self._participant(item) for item in participants], [self._link(item) for item in links], snapshot, self._presence.setdefault(session_id, {}))

    def get_record(self, session_id: str) -> SessionRecord | None:
        with self.Session() as db:
            return self._record(db, session_id)

    def update_session(self, session_id: str, **updates: object) -> InterviewSession | None:
        with self.Session.begin() as db:
            row = db.get(SessionRow, session_id)
            if row is None:
                return None
            for key, value in updates.items():
                if value is not None:
                    setattr(row, key, value)
            row.updated_at = self.now()
            return self._session(row)

    def _set_state(self, session_id: str, state: str, timestamp_field: str | None = None) -> InterviewSession | None:
        with self.Session.begin() as db:
            row = db.get(SessionRow, session_id)
            if row is None:
                return None
            ts = self.now()
            row.state = state
            row.updated_at = ts
            if timestamp_field:
                setattr(row, timestamp_field, ts)
            return self._session(row)

    def start_session(self, session_id: str) -> InterviewSession | None:
        return self._set_state(session_id, "live", "started_at")

    def end_session(self, session_id: str) -> InterviewSession | None:
        return self._set_state(session_id, "ended", "ended_at")

    def archive_session(self, session_id: str) -> InterviewSession | None:
        return self._set_state(session_id, "archived")

    def duplicate_session(self, session_id: str, owner_user_id: str) -> InterviewSession | None:
        with self.Session() as db:
            record = self._record(db, session_id)
        if record is None:
            return None
        duplicate = self.create_session(owner_user_id, f"{record.session.title} (Copy)", record.session.prompt, record.session.scheduled_at)
        self.save_canvas(duplicate.id, record.canvas)
        return duplicate

    def create_guest_link(self, session_id: str, role: ParticipantRole = "candidate") -> GuestLink | None:
        row = GuestLinkRow(id=self.new_id(), session_id=session_id, token=new_token(), role_granted=role, expires_at=None, max_uses=None, revoked_at=None, created_at=self.now())
        with self.Session.begin() as db:
            if db.get(SessionRow, session_id) is None:
                return None
            db.add(row)
        return self._link(row)

    def revoke_guest_link(self, session_id: str, link_id: str) -> bool:
        with self.Session.begin() as db:
            row = db.scalar(select(GuestLinkRow).where(GuestLinkRow.id == link_id, GuestLinkRow.session_id == session_id))
            if row is None:
                return False
            row.revoked_at = self.now()
            return True

    def link_for_token(self, token: str) -> tuple[SessionRecord, GuestLink] | None:
        with self.Session() as db:
            link = db.scalar(select(GuestLinkRow).where(GuestLinkRow.token == token, GuestLinkRow.revoked_at.is_(None)))
            if link is None:
                return None
            record = self._record(db, link.session_id)
            return (record, self._link(link)) if record else None

    def active_participant_count(self, session_id: str) -> int:
        with self.Session() as db:
            return len(db.scalars(select(ParticipantRow).where(ParticipantRow.session_id == session_id, ParticipantRow.left_at.is_(None))).all())

    def next_color(self) -> str:
        with self._lock:
            color = PARTICIPANT_COLORS[self._color_index % len(PARTICIPANT_COLORS)]
            self._color_index += 1
            return color

    def add_participant(self, session_id: str, display_name: str, role: ParticipantRole, user_id: str | None = None) -> Participant:
        row = ParticipantRow(id=self.new_id(), session_id=session_id, user_id=user_id, display_name=display_name, role=role, color=self.next_color(), joined_at=self.now(), left_at=None, is_active=True)
        with self.Session.begin() as db:
            db.add(row)
        return self._participant(row)

    def join_owner(self, session_id: str, user: User) -> Participant:
        return self.add_participant(session_id, user.display_name, "owner", user.id)

    def issue_participant_token(self, participant_id: str) -> str:
        token = new_token()
        with self.Session.begin() as db:
            db.add(TokenRow(token=token, participant_id=participant_id))
        return token

    def get_canvas(self, session_id: str) -> CanvasSnapshotData | None:
        with self.Session() as db:
            row = db.get(CanvasRow, session_id)
            return deepcopy(CanvasSnapshotData.model_validate(json.loads(row.snapshot))) if row else None

    def save_canvas(self, session_id: str, snapshot: CanvasSnapshotData) -> bool:
        with self.Session.begin() as db:
            session = db.get(SessionRow, session_id)
            if session is None:
                return False
            row = db.get(CanvasRow, session_id)
            serialized = json.dumps(snapshot.model_dump(mode="json"))
            if row is None:
                db.add(CanvasRow(session_id=session_id, snapshot=serialized))
            else:
                row.snapshot = serialized
            session.updated_at = self.now()
            return True

    def apply_operation(self, session_id: str, operation: CanvasOperation) -> CanvasSnapshotData | None:
        snapshot = self.get_canvas(session_id)
        if snapshot is None:
            return None
        match operation.op:
            case "add" | "update":
                snapshot.items[operation.item.id] = operation.item
                if operation.item.id not in snapshot.item_order:
                    snapshot.item_order.append(operation.item.id)
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
        self.save_canvas(session_id, snapshot)
        return deepcopy(snapshot)

    def can_access_session(self, session_id: str, user: User | None, participant_id: str | None) -> bool:
        with self.Session() as db:
            row = db.get(SessionRow, session_id)
            if row is None:
                return False
            if user and row.owner_user_id == user.id:
                return True
            return participant_id is not None and db.scalar(select(ParticipantRow.id).where(ParticipantRow.id == participant_id, ParticipantRow.session_id == session_id)) is not None

    @property
    def sessions(self) -> dict[str, SessionRecord]:
        with self.Session() as db:
            return {row.id: self._record(db, row.id) for row in db.scalars(select(SessionRow)).all()}

    @property
    def password_hashes(self) -> dict[str, str]:
        with self.Session() as db:
            return {row.id: row.password_hash for row in db.scalars(select(UserRow)).all()}
