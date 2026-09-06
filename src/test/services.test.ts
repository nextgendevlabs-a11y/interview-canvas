import { describe, it, expect, beforeEach } from 'vitest';
import { resetMockService, getMockService } from '@/services/mockInterviewService';
import { createEmptySnapshot, createShape, applyOperation } from '@/canvas/reducer';

describe('MockInterviewService - auth', () => {
  beforeEach(() => {
    resetMockService();
  });

  it('signs up a new user', async () => {
    const svc = getMockService();
    const result = await svc.signUp('test@example.com', 'password', 'Test User');
    expect(result.user.email).toBe('test@example.com');
    expect(result.user.display_name).toBe('Test User');
    expect(result.token).toBeTruthy();
    expect(svc.getCurrentUser()?.id).toBe(result.user.id);
  });

  it('rejects duplicate signup', async () => {
    const svc = getMockService();
    await svc.signUp('dup@example.com', 'password', 'User 1');
    await expect(svc.signUp('dup@example.com', 'password', 'User 2')).rejects.toThrow('already exists');
  });

  it('signs in existing user', async () => {
    const svc = getMockService();
    await svc.signUp('login@example.com', 'password', 'Login User');
    await svc.signOut();
    expect(svc.getCurrentUser()).toBeNull();
    const result = await svc.signIn('login@example.com', 'password');
    expect(result.user.email).toBe('login@example.com');
    expect(svc.getCurrentUser()?.id).toBe(result.user.id);
  });

  it('rejects sign in for non-existent user', async () => {
    const svc = getMockService();
    await expect(svc.signIn('nobody@example.com', 'password')).rejects.toThrow('No account');
  });

  it('signs out', async () => {
    const svc = getMockService();
    await svc.signUp('out@example.com', 'password', 'Out User');
    await svc.signOut();
    expect(svc.getCurrentUser()).toBeNull();
  });
});

describe('MockInterviewService - sessions', () => {
  beforeEach(() => {
    resetMockService();
  });

  it('creates a session', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    const session = await svc.createSession({ title: 'Test Interview', prompt: 'Design Twitter' });
    expect(session.title).toBe('Test Interview');
    expect(session.prompt).toBe('Design Twitter');
    expect(session.state).toBe('draft');
    expect(session.owner_user_id).toBe(svc.getCurrentUser()!.id);
  });

  it('lists sessions for the current user', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    await svc.createSession({ title: 'Session 1', prompt: 'P1' });
    await svc.createSession({ title: 'Session 2', prompt: 'P2' });
    const sessions = await svc.listSessions();
    expect(sessions).toHaveLength(2);
  });

  it('starts and ends a session', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    const session = await svc.createSession({ title: 'Test', prompt: 'P' });
    const started = await svc.startSession(session.id);
    expect(started.state).toBe('live');
    expect(started.started_at).toBeTruthy();
    const ended = await svc.endSession(session.id);
    expect(ended.state).toBe('ended');
    expect(ended.ended_at).toBeTruthy();
  });

  it('updates session fields', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    const session = await svc.createSession({ title: 'Test', prompt: 'P' });
    const updated = await svc.updateSession(session.id, { title: 'Updated', candidate_editing_enabled: false });
    expect(updated.title).toBe('Updated');
    expect(updated.candidate_editing_enabled).toBe(false);
  });

  it('archives a session', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    const session = await svc.createSession({ title: 'Test', prompt: 'P' });
    const archived = await svc.archiveSession(session.id);
    expect(archived.state).toBe('archived');
  });

  it('duplicates a session', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    const session = await svc.createSession({ title: 'Original', prompt: 'P' });
    const dup = await svc.duplicateSession(session.id);
    expect(dup.id).not.toBe(session.id);
    expect(dup.title).toBe('Original (Copy)');
    expect(dup.state).toBe('draft');
  });

  it('rejects session creation without auth', async () => {
    const svc = getMockService();
    await expect(svc.createSession({ title: 'T', prompt: 'P' })).rejects.toThrow('signed in');
  });
});

describe('MockInterviewService - guest links', () => {
  beforeEach(() => {
    resetMockService();
  });

  it('creates and validates a guest link', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    const session = await svc.createSession({ title: 'Test', prompt: 'P' });
    const link = await svc.createGuestLink(session.id);
    expect(link.token).toBeTruthy();
    expect(link.role_granted).toBe('candidate');
    const validated = await svc.validateToken(link.token);
    expect(validated.session_id).toBe(session.id);
    expect(validated.session_title).toBe('Test');
  });

  it('rejects revoked links', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    const session = await svc.createSession({ title: 'Test', prompt: 'P' });
    const link = await svc.createGuestLink(session.id);
    await svc.revokeGuestLink(session.id, link.id);
    await expect(svc.validateToken(link.token)).rejects.toThrow('revoked');
  });

  it('rejects join to archived session', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    const session = await svc.createSession({ title: 'Test', prompt: 'P' });
    const link = await svc.createGuestLink(session.id);
    await svc.archiveSession(session.id);
    await expect(svc.validateToken(link.token)).rejects.toThrow('archived');
  });
});

describe('MockInterviewService - join and participants', () => {
  beforeEach(() => {
    resetMockService();
  });

  it('joins a session with a display name', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    const session = await svc.createSession({ title: 'Test', prompt: 'P' });
    const link = await svc.createGuestLink(session.id);
    const { participant, session: joinedSession } = await svc.joinSession(link.token, 'Alice');
    expect(participant.display_name).toBe('Alice');
    expect(participant.role).toBe('candidate');
    expect(participant.color).toBeTruthy();
    expect(joinedSession.id).toBe(session.id);
  });

  it('rejects join with invalid token', async () => {
    const svc = getMockService();
    await expect(svc.joinSession('invalid-token', 'Alice')).rejects.toThrow('Invalid');
  });

  it('enforces max capacity of 10', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    const session = await svc.createSession({ title: 'Test', prompt: 'P' });
    const link = await svc.createGuestLink(session.id);
    for (let i = 0; i < 10; i++) {
      await svc.joinSession(link.token, `User ${i}`);
    }
    await expect(svc.joinSession(link.token, 'User 11')).rejects.toThrow('maximum capacity');
  });
});

describe('MockInterviewService - canvas', () => {
  beforeEach(() => {
    resetMockService();
  });

  it('returns an empty canvas for a new session', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    const session = await svc.createSession({ title: 'Test', prompt: 'P' });
    const canvas = await svc.getCanvasSnapshot(session.id);
    expect(canvas.items).toEqual({});
    expect(canvas.item_order).toEqual([]);
  });

  it('saves and retrieves a canvas snapshot', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    const session = await svc.createSession({ title: 'Test', prompt: 'P' });
    const snap = createEmptySnapshot();
    const shape = createShape('service', 100, 100, 160, 80, 'API', '#3b82f6');
    const updated = applyOperation(snap, { op: 'add', item: shape });
    await svc.saveCanvasSnapshot(session.id, updated);
    const retrieved = await svc.getCanvasSnapshot(session.id);
    expect(retrieved.items[shape.id]).toBeDefined();
    expect(retrieved.item_order).toContain(shape.id);
  });
});

describe('MockInterviewService - realtime subscription', () => {
  beforeEach(() => {
    resetMockService();
  });

  it('receives room_joined on subscribe', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    const session = await svc.createSession({ title: 'Test', prompt: 'P' });
    const link = await svc.createGuestLink(session.id);
    const { participant } = await svc.joinSession(link.token, 'Alice');

    const messages: any[] = [];
    let status = '';
    const sub = svc.subscribe(session.id, participant.id, {
      onMessage: (msg) => messages.push(msg),
      onStatusChange: (s) => { status = s; },
    });

    expect(status).toBe('connected');
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('room_joined');
    expect(messages[0].snapshot).toBeDefined();
    sub.unsubscribe();
  });

  it('broadcasts document updates to subscribers', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    const session = await svc.createSession({ title: 'Test', prompt: 'P' });
    const link = await svc.createGuestLink(session.id);
    const { participant } = await svc.joinSession(link.token, 'Alice');

    const messages: any[] = [];
    const sub = svc.subscribe(session.id, participant.id, {
      onMessage: (msg) => messages.push(msg),
      onStatusChange: () => {},
    });

    const shape = createShape('service', 0, 0, 160, 80, 'API', '#3b82f6');
    svc.send({
      type: 'document_update',
      session_id: session.id,
      operation: { op: 'add', item: shape },
    });

    const docUpdate = messages.find((m) => m.type === 'document_update');
    expect(docUpdate).toBeDefined();
    expect(docUpdate.operation.op).toBe('add');
    sub.unsubscribe();
  });

  it('responds to ping with pong', async () => {
    const svc = getMockService();
    await svc.signUp('owner@example.com', 'pw', 'Owner');
    const session = await svc.createSession({ title: 'Test', prompt: 'P' });
    const link = await svc.createGuestLink(session.id);
    const { participant } = await svc.joinSession(link.token, 'Alice');

    const messages: any[] = [];
    const sub = svc.subscribe(session.id, participant.id, {
      onMessage: (msg) => messages.push(msg),
      onStatusChange: () => {},
    });

    svc.send({ type: 'ping' });
    const pong = messages.find((m) => m.type === 'pong');
    expect(pong).toBeDefined();
    sub.unsubscribe();
  });
});
