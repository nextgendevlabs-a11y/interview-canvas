import { useState, useEffect } from 'react';
import { getService } from '@/services';
import type { ParticipantRole } from '@/services/types';

interface LobbyProps {
  token: string;
  onJoined: (participantId: string, sessionId: string, participantName: string, color: string) => void;
  onError: (message: string) => void;
}

export function Lobby({ token, onJoined, onError }: LobbyProps) {
  const [sessionTitle, setSessionTitle] = useState('');
  const [role, setRole] = useState<ParticipantRole>('candidate');
  const [sessionId, setSessionId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    validateToken();
  }, []);

  const validateToken = async () => {
    try {
      const svc = getService();
      const result = await svc.validateToken(token);
      setSessionTitle(result.session_title);
      setRole(result.role);
      setSessionId(result.session_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid link');
      onError(err instanceof Error ? err.message : 'Invalid link');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!displayName.trim()) {
      setError('Please enter your name');
      return;
    }
    setJoining(true);
    setError('');
    try {
      const svc = getService();
      const { participant } = await svc.joinSession(token, displayName.trim());
      onJoined(participant.id, sessionId, participant.display_name, participant.color);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join');
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400">Validating link...</div>
      </div>
    );
  }

  if (error && !sessionTitle) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-red-50 rounded-full mb-4">
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx={12} cy={12} r={10} />
              <path d="M15 9 L9 15 M9 9 L15 15" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Cannot Join</h2>
          <p className="text-slate-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-500 rounded-2xl mb-4 shadow-lg shadow-blue-500/30">
            <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x={3} y={3} width={18} height={18} rx={2} />
              <path d="M9 9 H15 M9 13 H15 M9 17 H13" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white">Design Interview</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="mb-6">
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Interview Session</div>
            <h2 className="text-lg font-bold text-slate-800">{sessionTitle}</h2>
            <div className="inline-flex items-center gap-1.5 mt-2 text-xs text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
              Joining as {role}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Your Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && accepted) handleJoin(); }}
                placeholder="Enter your name"
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                autoFocus
              />
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
              />
              <span className="text-xs text-slate-500 leading-relaxed">
                I understand that canvas activity is saved for interviewer review. My contributions will be visible to the interview team.
              </span>
            </label>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2.5 rounded-lg">
                {error}
              </div>
            )}

            <button
              onClick={handleJoin}
              disabled={!accepted || joining || !displayName.trim()}
              className="w-full py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {joining ? 'Joining...' : 'Join Interview'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
