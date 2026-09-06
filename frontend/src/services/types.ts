export type SessionState = 'draft' | 'live' | 'ended' | 'archived';

export type ParticipantRole = 'owner' | 'interviewer' | 'candidate' | 'observer';

export interface User {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
}

export interface InterviewSession {
  id: string;
  owner_user_id: string;
  title: string;
  prompt: string;
  state: SessionState;
  candidate_editing_enabled: boolean;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GuestLink {
  id: string;
  session_id: string;
  token: string;
  role_granted: ParticipantRole;
  expires_at: string | null;
  max_uses: number | null;
  revoked_at: string | null;
  created_at: string;
}

export interface Participant {
  id: string;
  session_id: string;
  user_id: string | null;
  display_name: string;
  role: ParticipantRole;
  color: string;
  joined_at: string;
  left_at: string | null;
  is_active: boolean;
}

export interface SessionDetails {
  session: InterviewSession;
  participants: Participant[];
  guest_links: GuestLink[];
}

export interface CreateSessionInput {
  title: string;
  prompt: string;
  scheduled_at?: string | null;
}

export interface UpdateSessionInput {
  title?: string;
  prompt?: string;
  candidate_editing_enabled?: boolean;
}

export interface AuthResult {
  user: User;
  token: string;
}

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';

export interface PresenceState {
  participant_id: string;
  display_name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selected_ids: string[];
}

export type WsInboundMessage =
  | { type: 'join_room'; session_id: string }
  | { type: 'document_update'; session_id: string; operation: CanvasOperation }
  | { type: 'presence_update'; session_id: string; cursor: { x: number; y: number } | null; selected_ids: string[] }
  | { type: 'ping' };

export type WsOutboundMessage =
  | { type: 'room_joined'; session_id: string; snapshot: CanvasSnapshotData; participants: PresenceState[] }
  | { type: 'document_update'; session_id: string; operation: CanvasOperation }
  | { type: 'presence_snapshot'; session_id: string; participants: PresenceState[] }
  | { type: 'presence_update'; session_id: string; participant_id: string; cursor: { x: number; y: number } | null; selected_ids: string[] }
  | { type: 'permission_changed'; session_id: string; candidate_editing_enabled: boolean }
  | { type: 'session_ended'; session_id: string }
  | { type: 'participant_joined'; session_id: string; participant: PresenceState }
  | { type: 'participant_left'; session_id: string; participant_id: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' };

export interface CanvasSnapshotData {
  items: Record<string, CanvasItem>;
  item_order: string[];
  schema_version: number;
}

export type CanvasItem =
  | ShapeElement
  | ConnectorElement
  | FreehandStroke
  | TextLabelElement
  | StickyNoteElement;

export interface ShapeElement {
  id: string;
  kind: 'shape';
  shape_type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  description: string;
  color: string;
  z: number;
}

export interface ConnectorElement {
  id: string;
  kind: 'connector';
  from_id: string | null;
  to_id: string | null;
  from_point: { x: number; y: number } | null;
  to_point: { x: number; y: number } | null;
  label: string;
  style: 'straight' | 'elbow' | 'curved';
  arrow_start: boolean;
  arrow_end: boolean;
  dashed: boolean;
  color: string;
  z: number;
}

export interface FreehandStroke {
  id: string;
  kind: 'freehand';
  points: { x: number; y: number }[];
  color: string;
  width: number;
  opacity: number;
  z: number;
}

export interface TextLabelElement {
  id: string;
  kind: 'text';
  x: number;
  y: number;
  text: string;
  font_size: number;
  color: string;
  z: number;
}

export interface StickyNoteElement {
  id: string;
  kind: 'sticky';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
  z: number;
}

export type CanvasOperation =
  | { op: 'add'; item: CanvasItem }
  | { op: 'update'; item: CanvasItem }
  | { op: 'delete'; id: string }
  | { op: 'move'; ids: string[]; dx: number; dy: number }
  | { op: 'resize'; id: string; width: number; height: number }
  | { op: 'relabel'; id: string; label: string }
  | { op: 'clear' };
