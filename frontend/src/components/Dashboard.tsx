import { useState, useEffect } from 'react';
import { getService } from '@/services';
import type { InterviewSession, SessionState } from '@/services/types';

interface DashboardProps {
  userId: string;
  onOpenSession: (id: string) => void;
  onNewSession: () => void;
  onSignOut: () => void;
}

const STATE_STYLES: Record<SessionState, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Draft' },
  live: { bg: 'bg-green-100', text: 'text-green-700', label: 'Live' },
  ended: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Ended' },
  archived: { bg: 'bg-slate-200', text: 'text-slate-500', label: 'Archived' },
};

export function Dashboard({ userId, onOpenSession, onNewSession, onSignOut }: DashboardProps) {
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [linkMap, setLinkMap] = useState<Record<string, string>>({});

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    setLoading(true);
    const svc = getService();
    const result = await svc.listSessions();
    setSessions(result);
    setLoading(false);
  };

  const handleCopyLink = async (sessionId: string) => {
    const svc = getService();
    let token = linkMap[sessionId];
    if (!token) {
      const link = await svc.createGuestLink(sessionId);
      token = link.token;
      setLinkMap((prev) => ({ ...prev, [sessionId]: token }));
    }
    const url = `${window.location.origin}/#/join/${token}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(sessionId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDuplicate = async (sessionId: string) => {
    const svc = getService();
    await svc.duplicateSession(sessionId);
    await loadSessions();
  };

  const handleArchive = async (sessionId: string) => {
    const svc = getService();
    await svc.archiveSession(sessionId);
    await loadSessions();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-500 rounded-lg flex items-center justify-center">
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x={3} y={3} width={18} height={18} rx={2} />
                <path d="M9 9 H15 M9 13 H15 M9 17 H13" />
              </svg>
            </div>
            <h1 className="text-lg font-bold text-slate-800">Design Interview</h1>
          </div>
          <button
            onClick={onSignOut}
            className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Your Interviews</h2>
            <p className="text-slate-500 text-sm mt-1">Create and manage system design interview sessions</p>
          </div>
          <button
            onClick={onNewSession}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5 V19 M5 12 H19" />
            </svg>
            New Interview
          </button>
        </div>

        {loading ? (
          <div className="text-center py-20 text-slate-400">Loading...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-100 rounded-full mb-4">
              <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x={3} y={3} width={18} height={18} rx={2} />
                <path d="M9 9 H15 M9 13 H15 M9 17 H13" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-slate-600 mb-1">No interviews yet</h3>
            <p className="text-slate-400 text-sm">Create your first interview session to get started</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {sessions.map((session) => {
              const style = STATE_STYLES[session.state];
              return (
                <div
                  key={session.id}
                  className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="text-base font-semibold text-slate-800 truncate">{session.title}</h3>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>
                          {style.label}
                        </span>
                      </div>
                      {session.prompt && (
                        <p className="text-sm text-slate-500 truncate">{session.prompt}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                        <span>Created {new Date(session.created_at).toLocaleDateString()}</span>
                        {session.started_at && <span>Started {new Date(session.started_at).toLocaleDateString()}</span>}
                        <span>Updated {new Date(session.updated_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-4">
                      <button
                        onClick={() => onOpenSession(session.id)}
                        className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        Open
                      </button>
                      <button
                        onClick={() => handleCopyLink(session.id)}
                        className="px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                        title="Copy candidate link"
                      >
                        {copiedId === session.id ? 'Copied!' : 'Copy Link'}
                      </button>
                      <button
                        onClick={() => handleDuplicate(session.id)}
                        className="px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                        title="Duplicate"
                      >
                        Duplicate
                      </button>
                      {session.state !== 'archived' && (
                        <button
                          onClick={() => handleArchive(session.id)}
                          className="px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Archive"
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
