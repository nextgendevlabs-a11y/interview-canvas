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
import type { CanvasSubscription, InterviewService } from './interviewService';

type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';

type ApiErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

type JoinSessionResponse = {
  participant: Participant;
  session: InterviewSession;
  participant_token?: string | null;
};

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8091/v1';
const AUTH_TOKEN_KEY = 'interview_canvas.auth_token';
const USER_KEY = 'interview_canvas.user';
const PARTICIPANT_TOKEN_KEY = 'interview_canvas.participant_token';

function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  const withoutTrailingSlash = configured.replace(/\/$/, '');
  return withoutTrailingSlash.endsWith('/v1') ? withoutTrailingSlash : `${withoutTrailingSlash}/v1`;
}

function wsBaseUrl(httpBaseUrl: string): string {
  const configured = import.meta.env.VITE_WS_BASE_URL;
  if (configured) return configured.replace(/\/$/, '').replace(/\/v1$/, '');

  const url = new URL(httpBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = url.pathname.replace(/\/v1\/?$/, '');
  return url.toString().replace(/\/$/, '');
}

function storageGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function storageSet<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export class BackendInterviewService implements InterviewService {
  private readonly baseUrl = apiBaseUrl();
  private readonly socketBaseUrl = wsBaseUrl(this.baseUrl);
  private authToken: string | null = localStorage.getItem(AUTH_TOKEN_KEY);
  private participantToken: string | null = localStorage.getItem(PARTICIPANT_TOKEN_KEY);
  private currentUser: User | null = storageGet<User>(USER_KEY);
  private socket: WebSocket | null = null;
  private activeSubscription: {
    session_id: string;
    participant_id: string;
    handlers: {
      onMessage: (msg: WsOutboundMessage) => void;
      onStatusChange: (status: ConnectionStatus) => void;
    };
  } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private queuedMessages: WsInboundMessage[] = [];
  private cachedGuestDetails: Map<string, SessionDetails> = new Map();

  async signIn(email: string, password: string): Promise<AuthResult> {
    const result = await this.request<AuthResult>('/auth/sign-in', {
      method: 'POST',
      body: { email, password },
    });
    this.setAuth(result);
    return result;
  }

  async signUp(email: string, password: string, display_name: string): Promise<AuthResult> {
    const result = await this.request<AuthResult>('/auth/sign-up', {
      method: 'POST',
      body: { email, password, display_name },
    });
    this.setAuth(result);
    return result;
  }

  async signOut(): Promise<void> {
    try {
      await this.request<void>('/auth/sign-out', { method: 'POST' });
    } finally {
      this.authToken = null;
      this.currentUser = null;
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  }

  getCurrentUser(): User | null {
    return this.currentUser;
  }

  createSession(input: CreateSessionInput): Promise<InterviewSession> {
    return this.request<InterviewSession>('/sessions', { method: 'POST', body: input });
  }

  listSessions(): Promise<InterviewSession[]> {
    return this.request<InterviewSession[]>('/sessions');
  }

  async getSession(id: string): Promise<SessionDetails> {
    if (!this.authToken) {
      const cached = this.cachedGuestDetails.get(id);
      if (cached) return cached;
    }
    return this.request<SessionDetails>(`/sessions/${encodeURIComponent(id)}`);
  }

  updateSession(id: string, input: UpdateSessionInput): Promise<InterviewSession> {
    return this.request<InterviewSession>(`/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: input });
  }

  startSession(id: string): Promise<InterviewSession> {
    return this.request<InterviewSession>(`/sessions/${encodeURIComponent(id)}/start`, { method: 'POST' });
  }

  endSession(id: string): Promise<InterviewSession> {
    return this.request<InterviewSession>(`/sessions/${encodeURIComponent(id)}/end`, { method: 'POST' });
  }

  archiveSession(id: string): Promise<InterviewSession> {
    return this.request<InterviewSession>(`/sessions/${encodeURIComponent(id)}/archive`, { method: 'POST' });
  }

  duplicateSession(id: string): Promise<InterviewSession> {
    return this.request<InterviewSession>(`/sessions/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
  }

  createGuestLink(session_id: string, role: ParticipantRole = 'candidate'): Promise<GuestLink> {
    return this.request<GuestLink>(`/sessions/${encodeURIComponent(session_id)}/guest-links`, {
      method: 'POST',
      body: { role },
    });
  }

  revokeGuestLink(session_id: string, link_id: string): Promise<void> {
    return this.request<void>(
      `/sessions/${encodeURIComponent(session_id)}/guest-links/${encodeURIComponent(link_id)}`,
      { method: 'DELETE' },
    );
  }

  validateToken(token: string): Promise<{ session_id: string; session_title: string; role: ParticipantRole }> {
    return this.request(`/join/${encodeURIComponent(token)}/validate`, { method: 'POST' });
  }

  async joinSession(token: string, display_name: string): Promise<JoinSessionResponse> {
    const result = await this.request<JoinSessionResponse>(`/join/${encodeURIComponent(token)}`, {
      method: 'POST',
      body: { display_name },
    });
    this.participantToken = result.participant_token ?? null;
    if (this.participantToken) localStorage.setItem(PARTICIPANT_TOKEN_KEY, this.participantToken);
    this.cachedGuestDetails.set(result.session.id, {
      session: result.session,
      participants: [result.participant],
      guest_links: [],
    });
    return result;
  }

  getCanvasSnapshot(session_id: string): Promise<CanvasSnapshotData> {
    return this.request<CanvasSnapshotData>(`/sessions/${encodeURIComponent(session_id)}/canvas`);
  }

  saveCanvasSnapshot(session_id: string, snapshot: CanvasSnapshotData): Promise<void> {
    return this.request<void>(`/sessions/${encodeURIComponent(session_id)}/canvas`, { method: 'PUT', body: snapshot });
  }

  subscribe(
    session_id: string,
    participant_id: string,
    handlers: {
      onMessage: (msg: WsOutboundMessage) => void;
      onStatusChange: (status: ConnectionStatus) => void;
    },
  ): CanvasSubscription {
    this.closeSocket();
    this.queuedMessages = [];
    this.reconnectAttempts = 0;
    this.activeSubscription = { session_id, participant_id, handlers };
    this.openSocket();

    return {
      unsubscribe: () => {
        this.activeSubscription = null;
        this.closeSocket();
      },
    };
  }

  send(message: WsInboundMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    this.queuedMessages.push(message);
  }

  private openSocket(): void {
    const subscription = this.activeSubscription;
    if (!subscription) return;
    const { session_id, participant_id, handlers } = subscription;

    const params = new URLSearchParams({ participant_id });
    if (this.authToken) params.set('access_token', this.authToken);
    if (this.participantToken) params.set('participant_token', this.participantToken);

    const socket = new WebSocket(`${this.socketBaseUrl}/v1/ws/sessions/${encodeURIComponent(session_id)}?${params}`);
    this.socket = socket;
    handlers.onStatusChange('reconnecting');

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      handlers.onStatusChange('connected');
      socket.send(JSON.stringify({ type: 'join_room', session_id }));
      for (const message of this.queuedMessages) {
        socket.send(JSON.stringify(message));
      }
      this.queuedMessages = [];
    };
    socket.onmessage = (event) => {
      handlers.onMessage(JSON.parse(event.data) as WsOutboundMessage);
    };
    socket.onerror = () => {
      handlers.onStatusChange('offline');
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      handlers.onStatusChange('offline');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.activeSubscription || this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private closeSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.onclose = null;
      socket.close();
    }
  }

  private setAuth(result: AuthResult): void {
    this.authToken = result.token;
    this.currentUser = result.user;
    localStorage.setItem(AUTH_TOKEN_KEY, result.token);
    storageSet(USER_KEY, result.user);
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers = new Headers();
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (this.authToken) headers.set('Authorization', `Bearer ${this.authToken}`);
    if (this.participantToken) headers.set('X-Participant-Token', this.participantToken);

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (!response.ok) {
      throw new Error(await this.errorMessage(response));
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  private async errorMessage(response: Response): Promise<string> {
    try {
      const payload = (await response.json()) as ApiErrorResponse;
      return payload.error?.message ?? `Request failed with status ${response.status}`;
    } catch {
      return `Request failed with status ${response.status}`;
    }
  }
}

let _instance: BackendInterviewService | null = null;

export function getBackendService(): BackendInterviewService {
  if (!_instance) _instance = new BackendInterviewService();
  return _instance;
}
