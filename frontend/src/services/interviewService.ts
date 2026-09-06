import type {
  AuthResult,
  CanvasSnapshotData,
  CreateSessionInput,
  GuestLink,
  InterviewSession,
  Participant,
  ParticipantRole,
  SessionDetails,
  UpdateSessionInput,
  User,
  WsInboundMessage,
  WsOutboundMessage,
} from './types';

export interface CanvasSubscription {
  unsubscribe: () => void;
}

export interface InterviewService {
  // Auth
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string, display_name: string): Promise<AuthResult>;
  signOut(): Promise<void>;
  getCurrentUser(): User | null;

  // Sessions
  createSession(input: CreateSessionInput): Promise<InterviewSession>;
  listSessions(): Promise<InterviewSession[]>;
  getSession(id: string): Promise<SessionDetails>;
  updateSession(id: string, input: UpdateSessionInput): Promise<InterviewSession>;
  startSession(id: string): Promise<InterviewSession>;
  endSession(id: string): Promise<InterviewSession>;
  archiveSession(id: string): Promise<InterviewSession>;
  duplicateSession(id: string): Promise<InterviewSession>;

  // Guest links
  createGuestLink(session_id: string, role?: ParticipantRole): Promise<GuestLink>;
  revokeGuestLink(session_id: string, link_id: string): Promise<void>;

  // Join
  validateToken(token: string): Promise<{ session_id: string; session_title: string; role: ParticipantRole }>;
  joinSession(token: string, display_name: string): Promise<{ participant: Participant; session: InterviewSession; participant_token?: string | null }>;

  // Canvas
  getCanvasSnapshot(session_id: string): Promise<CanvasSnapshotData>;
  saveCanvasSnapshot(session_id: string, snapshot: CanvasSnapshotData): Promise<void>;

  // Realtime
  subscribe(
    session_id: string,
    participant_id: string,
    handlers: {
      onMessage: (msg: WsOutboundMessage) => void;
      onStatusChange: (status: 'connected' | 'reconnecting' | 'offline') => void;
    },
  ): CanvasSubscription;
  send(message: WsInboundMessage): void;
}
