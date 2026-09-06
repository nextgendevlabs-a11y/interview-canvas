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
  PresenceState,
} from './types';
import type { CanvasSubscription, InterviewService } from './interviewService';
import { PARTICIPANT_COLORS } from '@/canvas/palette';
import { createEmptySnapshot, applyOperation } from '@/canvas/reducer';

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function now(): string {
  return new Date().toISOString();
}

interface MockSessionData {
  session: InterviewSession;
  participants: Participant[];
  guest_links: GuestLink[];
  canvas: CanvasSnapshotData;
  presence: Map<string, PresenceState>;
}

type SubscriptionHandlers = {
  onMessage: (msg: WsOutboundMessage) => void;
  onStatusChange: (status: 'connected' | 'reconnecting' | 'offline') => void;
};

interface MockSubscription {
  session_id: string;
  participant_id: string;
  handlers: SubscriptionHandlers;
}

export class MockInterviewService implements InterviewService {
  private currentUser: User | null = null;
  private users: Map<string, User> = new Map();
  private sessions: Map<string, MockSessionData> = new Map();
  private subscriptions: Map<string, MockSubscription[]> = new Map();
  private currentSubscription: MockSubscription | null = null;
  private tokenToSession: Map<string, { session_id: string; role: ParticipantRole }> = new Map();
  private participantColorIndex = 0;

  constructor() {
    // Pre-seed a demo user
    const demoUser: User = {
      id: 'demo-user-001',
      email: 'demo@interview.dev',
      display_name: 'Demo Interviewer',
      created_at: now(),
    };
    this.users.set(demoUser.id, demoUser);
  }

  async signIn(email: string, _password: string): Promise<AuthResult> {
    await this.delay();
    const existing = Array.from(this.users.values()).find((u) => u.email === email);
    if (existing) {
      this.currentUser = existing;
      return { user: existing, token: generateToken() };
    }
    throw new Error('No account found with that email. Try signing up.');
  }

  async signUp(email: string, _password: string, display_name: string): Promise<AuthResult> {
    await this.delay();
    const existing = Array.from(this.users.values()).find((u) => u.email === email);
    if (existing) {
      throw new Error('An account with that email already exists.');
    }
    const user: User = {
      id: generateId(),
      email,
      display_name,
      created_at: now(),
    };
    this.users.set(user.id, user);
    this.currentUser = user;
    return { user, token: generateToken() };
  }

  async signOut(): Promise<void> {
    this.currentUser = null;
  }

  getCurrentUser(): User | null {
    return this.currentUser;
  }

  async createSession(input: CreateSessionInput): Promise<InterviewSession> {
    await this.delay();
    if (!this.currentUser) throw new Error('Must be signed in to create a session.');
    const id = generateId();
    const ts = now();
    const session: InterviewSession = {
      id,
      owner_user_id: this.currentUser.id,
      title: input.title,
      prompt: input.prompt,
      state: 'draft',
      candidate_editing_enabled: true,
      scheduled_at: input.scheduled_at ?? null,
      started_at: null,
      ended_at: null,
      created_at: ts,
      updated_at: ts,
    };
    this.sessions.set(id, {
      session,
      participants: [],
      guest_links: [],
      canvas: createEmptySnapshot(),
      presence: new Map(),
    });
    return session;
  }

  async listSessions(): Promise<InterviewSession[]> {
    await this.delay();
    if (!this.currentUser) return [];
    return Array.from(this.sessions.values())
      .map((d) => d.session)
      .filter((s) => s.owner_user_id === this.currentUser!.id)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async getSession(id: string): Promise<SessionDetails> {
    await this.delay();
    const data = this.sessions.get(id);
    if (!data) throw new Error('Session not found.');
    return { session: data.session, participants: data.participants, guest_links: data.guest_links };
  }

  async updateSession(id: string, input: UpdateSessionInput): Promise<InterviewSession> {
    await this.delay();
    const data = this.sessions.get(id);
    if (!data) throw new Error('Session not found.');
    data.session = {
      ...data.session,
      ...input,
      updated_at: now(),
    };
    return data.session;
  }

  async startSession(id: string): Promise<InterviewSession> {
    await this.delay();
    const data = this.sessions.get(id);
    if (!data) throw new Error('Session not found.');
    data.session = {
      ...data.session,
      state: 'live',
      started_at: now(),
      updated_at: now(),
    };
    return data.session;
  }

  async endSession(id: string): Promise<InterviewSession> {
    await this.delay();
    const data = this.sessions.get(id);
    if (!data) throw new Error('Session not found.');
    data.session = {
      ...data.session,
      state: 'ended',
      ended_at: now(),
      updated_at: now(),
    };
    this.broadcast(id, { type: 'session_ended', session_id: id });
    return data.session;
  }

  async archiveSession(id: string): Promise<InterviewSession> {
    await this.delay();
    const data = this.sessions.get(id);
    if (!data) throw new Error('Session not found.');
    data.session = { ...data.session, state: 'archived', updated_at: now() };
    return data.session;
  }

  async duplicateSession(id: string): Promise<InterviewSession> {
    await this.delay();
    const data = this.sessions.get(id);
    if (!data) throw new Error('Session not found.');
    if (!this.currentUser) throw new Error('Must be signed in.');
    const newId = generateId();
    const ts = now();
    const newSession: InterviewSession = {
      ...data.session,
      id: newId,
      title: `${data.session.title} (Copy)`,
      state: 'draft',
      started_at: null,
      ended_at: null,
      created_at: ts,
      updated_at: ts,
    };
    this.sessions.set(newId, {
      session: newSession,
      participants: [],
      guest_links: [],
      canvas: { ...data.canvas, items: { ...data.canvas.items }, item_order: [...data.canvas.item_order] },
      presence: new Map(),
    });
    return newSession;
  }

  async createGuestLink(session_id: string, role: ParticipantRole = 'candidate'): Promise<GuestLink> {
    await this.delay();
    const data = this.sessions.get(session_id);
    if (!data) throw new Error('Session not found.');
    const token = generateToken();
    const link: GuestLink = {
      id: generateId(),
      session_id,
      token,
      role_granted: role,
      expires_at: null,
      max_uses: null,
      revoked_at: null,
      created_at: now(),
    };
    data.guest_links.push(link);
    this.tokenToSession.set(token, { session_id, role });
    return link;
  }

  async revokeGuestLink(session_id: string, link_id: string): Promise<void> {
    await this.delay();
    const data = this.sessions.get(session_id);
    if (!data) throw new Error('Session not found.');
    const link = data.guest_links.find((l) => l.id === link_id);
    if (!link) throw new Error('Guest link not found.');
    link.revoked_at = now();
    // Keep the token mapping so validateToken can detect revocation
  }

  async validateToken(token: string): Promise<{ session_id: string; session_title: string; role: ParticipantRole }> {
    await this.delay();
    const entry = this.tokenToSession.get(token);
    if (!entry) throw new Error('Invalid or expired link.');
    const data = this.sessions.get(entry.session_id);
    if (!data) throw new Error('Session not found.');
    if (data.session.state === 'archived') throw new Error('This session has been archived.');
    const link = data.guest_links.find((l) => l.token === token);
    if (link && link.revoked_at) throw new Error('This link has been revoked.');
    if (link && link.expires_at && new Date(link.expires_at) < new Date()) {
      throw new Error('This link has expired.');
    }
    if (data.participants.filter((p) => p.left_at === null).length >= 10) {
      throw new Error('This session is at maximum capacity (10 participants).');
    }
    return { session_id: entry.session_id, session_title: data.session.title, role: entry.role };
  }

  async joinSession(token: string, display_name: string): Promise<{ participant: Participant; session: InterviewSession }> {
    await this.delay();
    const entry = this.tokenToSession.get(token);
    if (!entry) throw new Error('Invalid or expired link.');
    const data = this.sessions.get(entry.session_id);
    if (!data) throw new Error('Session not found.');
    const link = data.guest_links.find((l) => l.token === token);
    if (link && link.revoked_at) throw new Error('This link has been revoked.');
    if (data.session.state === 'archived') throw new Error('This session has been archived.');
    const activeCount = data.participants.filter((p) => p.left_at === null).length;
    if (activeCount >= 10) throw new Error('Session is at maximum capacity.');

    const color = PARTICIPANT_COLORS[this.participantColorIndex % PARTICIPANT_COLORS.length];
    this.participantColorIndex++;

    const participant: Participant = {
      id: generateId(),
      session_id: entry.session_id,
      user_id: null,
      display_name,
      role: entry.role,
      color,
      joined_at: now(),
      left_at: null,
      is_active: true,
    };
    data.participants.push(participant);
    return { participant, session: data.session };
  }

  async getCanvasSnapshot(session_id: string): Promise<CanvasSnapshotData> {
    await this.delay();
    const data = this.sessions.get(session_id);
    if (!data) throw new Error('Session not found.');
    return { ...data.canvas, items: { ...data.canvas.items }, item_order: [...data.canvas.item_order] };
  }

  async saveCanvasSnapshot(session_id: string, snapshot: CanvasSnapshotData): Promise<void> {
    await this.delay();
    const data = this.sessions.get(session_id);
    if (!data) throw new Error('Session not found.');
    data.canvas = { ...snapshot, items: { ...snapshot.items }, item_order: [...snapshot.item_order] };
  }

  subscribe(
    session_id: string,
    participant_id: string,
    handlers: SubscriptionHandlers,
  ): CanvasSubscription {
    const sub: MockSubscription = { session_id, participant_id, handlers };
    this.currentSubscription = sub;

    const subs = this.subscriptions.get(session_id) ?? [];
    subs.push(sub);
    this.subscriptions.set(session_id, subs);

    const data = this.sessions.get(session_id);
    if (data) {
      const presenceList = Array.from(data.presence.values());
      handlers.onStatusChange('connected');
      handlers.onMessage({
        type: 'room_joined',
        session_id,
        snapshot: { ...data.canvas, items: { ...data.canvas.items }, item_order: [...data.canvas.item_order] },
        participants: presenceList,
      });
    }

    return {
      unsubscribe: () => {
        const subs = this.subscriptions.get(session_id) ?? [];
        this.subscriptions.set(
          session_id,
          subs.filter((s) => s !== sub),
        );
        this.currentSubscription = null;
      },
    };
  }

  send(message: WsInboundMessage): void {
    const sub = this.currentSubscription;
    if (!sub) return;

    switch (message.type) {
      case 'ping':
        sub.handlers.onMessage({ type: 'pong' });
        break;
      case 'document_update': {
        const data = this.sessions.get(message.session_id);
        if (!data) return;
        data.canvas = applyOperation(data.canvas, message.operation);
        this.broadcast(message.session_id, {
          type: 'document_update',
          session_id: message.session_id,
          operation: message.operation,
        });
        break;
      }
      case 'presence_update': {
        const data = this.sessions.get(message.session_id);
        if (!data) return;
        const existing = data.presence.get(sub.participant_id);
        const updated: PresenceState = {
          participant_id: sub.participant_id,
          display_name: existing?.display_name ?? 'Participant',
          color: existing?.color ?? '#3b82f6',
          cursor: message.cursor,
          selected_ids: message.selected_ids,
        };
        data.presence.set(sub.participant_id, updated);
        this.broadcast(message.session_id, {
          type: 'presence_update',
          session_id: message.session_id,
          participant_id: sub.participant_id,
          cursor: message.cursor,
          selected_ids: message.selected_ids,
        });
        break;
      }
      case 'join_room':
        // Already handled by subscribe
        break;
    }
  }

  private broadcast(session_id: string, msg: WsOutboundMessage) {
    const subs = this.subscriptions.get(session_id) ?? [];
    for (const s of subs) {
      s.handlers.onMessage(msg);
    }
  }

  private delay(ms = 150): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
let _instance: MockInterviewService | null = null;

export function getMockService(): MockInterviewService {
  if (!_instance) _instance = new MockInterviewService();
  return _instance;
}

export function resetMockService(): void {
  _instance = new MockInterviewService();
}
