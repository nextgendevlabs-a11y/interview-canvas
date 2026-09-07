import { useState, useEffect, useRef, useCallback } from 'react';
import { getService } from '@/services';
import type { CanvasSnapshotData, CanvasOperation, InterviewSession, Participant, WsOutboundMessage } from '@/services/types';
import { Canvas } from '@/components/Canvas';
import { createEmptySnapshot, applyOperation } from '@/canvas/reducer';

interface InterviewRoomProps {
  sessionId: string;
  participantId: string;
  participantColor: string;
  participantName: string;
  isOwner: boolean;
  onLeave: () => void;
}

export function InterviewRoom({ sessionId, participantId, participantColor, participantName, isOwner, onLeave }: InterviewRoomProps) {
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [snapshot, setSnapshot] = useState<CanvasSnapshotData>(createEmptySnapshot());
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'offline'>('reconnecting');
  const [elapsed, setElapsed] = useState(0);
  const [roomColor, setRoomColor] = useState(participantColor);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const ownerColorRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSnapshotRef = useRef<CanvasSnapshotData | null>(null);

  const loadSession = useCallback(async () => {
    const svc = getService();
    const details = await svc.getSession(sessionId);
    setSession(details.session);
    const ownerParticipant = details.participants.find((p) => p.role === 'owner');
    if (ownerParticipant && isOwner) setRoomColor(ownerParticipant.color);
    // Some guest/session responses contain only guest participants. Keep the
    // session owner visible to every participant in the room.
    const owner: Participant = {
      id: `owner-${details.session.owner_user_id}`,
      session_id: details.session.id,
      user_id: details.session.owner_user_id,
      display_name: isOwner ? participantName : 'Owner',
      role: 'owner',
      color: ownerParticipant?.color ?? ownerColorRef.current ?? participantColor,
      joined_at: details.session.created_at,
      left_at: null,
      is_active: true,
    };
    setParticipants(details.participants.some((p) => p.role === 'owner')
      ? details.participants
      : [owner, ...details.participants]);
  }, [sessionId, isOwner, participantName, participantColor]);

  useEffect(() => {
    loadSession();
    const svc = getService();
    svc.getCanvasSnapshot(sessionId).then((snap) => setSnapshot(snap));

    const sub = svc.subscribe(sessionId, participantId, {
      onMessage: (msg: WsOutboundMessage) => handleWsMessage(msg),
      onStatusChange: (status) => setConnectionStatus(status),
    });
    subscriptionRef.current = sub;

    return () => {
      sub.unsubscribe();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sessionId, participantId, loadSession]);

  useEffect(() => {
    const interval = setInterval(async () => {
      if (pendingSnapshotRef.current) return;
      try {
        const svc = getService();
        const serverSnapshot = await svc.getCanvasSnapshot(sessionId);
        setSnapshot(serverSnapshot);
      } catch {
        // The websocket reconnect loop owns visible connection status.
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionId]);

  useEffect(() => {
    if (!isOwner) return;
    const interval = setInterval(() => {
      loadSession().catch(() => {});
    }, 2000);

    return () => clearInterval(interval);
  }, [isOwner, loadSession]);

  useEffect(() => {
    if (session?.state === 'live' && session.started_at) {
      const raw = session.started_at;
      const start = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`).getTime();
      setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
      const interval = setInterval(() => {
        setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
      }, 1000);
      return () => clearInterval(interval);
    }
    setElapsed(0);
  }, [session?.state, session?.started_at]);

  const handleWsMessage = (msg: WsOutboundMessage) => {
    switch (msg.type) {
      case 'room_joined':
        setSnapshot(msg.snapshot);
        if (!isOwner) {
          const ownerPresence = msg.participants.find((p) => p.participant_id !== participantId);
          if (ownerPresence) {
            ownerColorRef.current = ownerPresence.color;
            setParticipants((prev) => prev.map((p) => p.role === 'owner'
              ? { ...p, display_name: ownerPresence.display_name, color: ownerPresence.color }
              : p));
          }
        }
        setConnectionStatus('connected');
        break;
      case 'document_update':
        setSnapshot((prev) => {
          const next = applyOperation(prev, msg.operation);
          if (pendingSnapshotRef.current) {
            pendingSnapshotRef.current = next;
          }
          return next;
        });
        break;
      case 'presence_update':
        break;
      case 'presence_snapshot':
        break;
      case 'participant_joined':
        setParticipants((prev) => {
          if (prev.some((p) => p.id === msg.participant.participant_id)) return prev;
          return [
            ...prev,
            {
              id: msg.participant.participant_id,
              session_id: msg.session_id,
              user_id: null,
              display_name: msg.participant.display_name,
              role: 'candidate',
              color: msg.participant.color,
              joined_at: new Date().toISOString(),
              left_at: null,
              is_active: true,
            },
          ];
        });
        break;
      case 'participant_left':
        setParticipants((prev) => prev.map((p) => p.id === msg.participant_id ? { ...p, is_active: false, left_at: new Date().toISOString() } : p));
        break;
      case 'session_ended':
        setSession((prev) => prev ? { ...prev, state: 'ended' } : null);
        break;
      case 'permission_changed':
        setSession((prev) => prev ? { ...prev, candidate_editing_enabled: msg.candidate_editing_enabled } : null);
        break;
      case 'pong':
        break;
    }
  };

  const handleSnapshotChange = (newSnapshot: CanvasSnapshotData) => {
    setSnapshot(newSnapshot);
    pendingSnapshotRef.current = newSnapshot;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (pendingSnapshotRef.current) {
        const svc = getService();
        await svc.saveCanvasSnapshot(sessionId, pendingSnapshotRef.current);
        pendingSnapshotRef.current = null;
      }
    }, 500);
  };

  const handleOperation = (op: CanvasOperation) => {
    const svc = getService();
    svc.send({ type: 'document_update', session_id: sessionId, operation: op });
  };

  const handleStart = async () => {
    const svc = getService();
    const updated = await svc.startSession(sessionId);
    setElapsed(0);
    setSession(updated);
  };

  const handleEnd = async () => {
    const svc = getService();
    const updated = await svc.endSession(sessionId);
    setSession(updated);
    setShowEndConfirm(false);
    await svc.saveCanvasSnapshot(sessionId, snapshot);
  };

  const handleToggleEditLock = async () => {
    if (!session) return;
    const svc = getService();
    const updated = await svc.updateSession(sessionId, { candidate_editing_enabled: !session.candidate_editing_enabled });
    setSession(updated);
  };

  const handleClearCanvas = () => {
    const op: CanvasOperation = { op: 'clear' };
    handleSnapshotChange(createEmptySnapshot());
    handleOperation(op);
    setShowClearConfirm(false);
  };

  const handleCreateLink = async () => {
    const svc = getService();
    const link = await svc.createGuestLink(sessionId);
    setLinkUrl(`${window.location.origin}/#/join/${link.token}`);
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(linkUrl);
  };

  const canEdit = session ? (isOwner || session.candidate_editing_enabled) : false;
  const isEnded = session?.state === 'ended';
  const isLive = session?.state === 'live';

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const statusColors = {
    connected: 'bg-green-400',
    reconnecting: 'bg-amber-400',
    offline: 'bg-red-400',
  };

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center justify-between gap-4 z-30">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onLeave}
            className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
            title="Leave session"
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12 H5 M12 19 L5 12 L12 5" />
            </svg>
          </button>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-slate-800 truncate">{session?.title ?? 'Loading...'}</h1>
            {session?.state && (
              <span className={`text-xs ${isLive ? 'text-green-600' : isEnded ? 'text-amber-600' : 'text-slate-400'}`}>
                {isLive ? 'Live' : isEnded ? 'Ended' : 'Draft'}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Connection status */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className={`w-2 h-2 rounded-full ${statusColors[connectionStatus]} ${connectionStatus === 'reconnecting' ? 'animate-pulse' : ''}`} />
            <span className="hidden sm:inline">{connectionStatus}</span>
          </div>

          {/* Timer */}
          {isLive && (
            <div className="text-sm font-mono text-slate-600 tabular-nums">{formatTime(elapsed)}</div>
          )}

          {/* Participants */}
          <div className="flex items-center -space-x-2">
            {participants.slice(0, 5).map((p) => (
              <div
                key={p.id}
                className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-xs font-medium text-white"
                style={{ backgroundColor: p.color }}
                title={p.display_name}
              >
                {p.display_name[0]?.toUpperCase()}
              </div>
            ))}
            {participants.length > 5 && (
              <div className="w-7 h-7 rounded-full border-2 border-white bg-slate-200 flex items-center justify-center text-xs font-medium text-slate-600">
                +{participants.length - 5}
              </div>
            )}
          </div>

          {/* Share button */}
          {isOwner && (
            <button
              onClick={() => { setShowLinkModal(true); handleCreateLink(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx={18} cy={5} r={3} />
                <circle cx={6} cy={12} r={3} />
                <circle cx={18} cy={19} r={3} />
                <path d="M8.6 13.5 L15.4 17.5 M15.4 6.5 L8.6 10.5" />
              </svg>
              <span className="hidden sm:inline">Share</span>
            </button>
          )}

          {/* Start / End controls */}
          {isOwner && !isLive && !isEnded && (
            <button
              onClick={handleStart}
              className="px-3 py-1.5 text-sm font-medium bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
            >
              Start
            </button>
          )}
          {isOwner && isLive && (
            <button
              onClick={() => setShowEndConfirm(true)}
              className="px-3 py-1.5 text-sm font-medium bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            >
              End
            </button>
          )}
          {isOwner && (
            <button
              onClick={handleToggleEditLock}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                session?.candidate_editing_enabled
                  ? 'text-amber-600 hover:bg-amber-50'
                  : 'text-green-600 hover:bg-green-50'
              }`}
              title={session?.candidate_editing_enabled ? 'Lock candidate editing' : 'Unlock candidate editing'}
            >
              {session?.candidate_editing_enabled ? 'Lock' : 'Unlock'}
            </button>
          )}
        </div>
      </header>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 relative">
          <Canvas
            snapshot={snapshot}
            onSnapshotChange={handleSnapshotChange}
            participantColor={roomColor}
            participantName={participantName}
            canEdit={canEdit && !isEnded}
            onOperation={handleOperation}
          />
        </div>

        {/* Right panel */}
        <div className="w-72 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
          {/* Interview prompt */}
          <div className="p-4 border-b border-slate-200">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Interview Prompt</h3>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
              {session?.prompt || 'No prompt provided for this session.'}
            </p>
          </div>

          {/* Participants list */}
          <div className="p-4 border-b border-slate-200">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Participants</h3>
            <div className="space-y-2">
              {participants.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium text-white" style={{ backgroundColor: p.color }}>
                    {p.display_name[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-700 truncate">{p.display_name}</div>
                    <div className="text-xs text-slate-400 capitalize">{p.role}</div>
                  </div>
                  {p.is_active && <span className="w-2 h-2 bg-green-400 rounded-full" />}
                </div>
              ))}
              {participants.length === 0 && (
                <p className="text-sm text-slate-400">No participants yet</p>
              )}
            </div>
          </div>

          {/* Clear canvas (owner only) */}
          {isOwner && (
            <div className="p-4 mt-auto">
              <button
                onClick={() => setShowClearConfirm(true)}
                className="w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-200"
              >
                Clear Canvas
              </button>
            </div>
          )}
        </div>
      </div>

      {/* End session confirmation */}
      {showEndConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">End Interview?</h3>
            <p className="text-sm text-slate-500 mb-6">
              The session will become read-only for candidates. A final snapshot will be saved.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowEndConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEnd}
                className="px-4 py-2 text-sm font-medium bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                End Interview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear canvas confirmation */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Clear Canvas?</h3>
            <p className="text-sm text-slate-500 mb-6">
              All elements will be removed. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleClearCanvas}
                className="px-4 py-2 text-sm font-medium bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share link modal */}
      {showLinkModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Candidate Link</h3>
            <p className="text-sm text-slate-500 mb-4">
              Share this link with the candidate. They can join as a guest without an account.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={linkUrl}
                className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none"
              />
              <button
                onClick={handleCopyLink}
                className="px-4 py-2 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                Copy
              </button>
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowLinkModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
