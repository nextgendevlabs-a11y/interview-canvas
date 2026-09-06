import { useState } from 'react';
import { getService } from '@/services';
import type { AuthResult } from '@/services/types';

interface AuthScreenProps {
  onAuthed: (result: AuthResult) => void;
}

export function AuthScreen({ onAuthed }: AuthScreenProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const svc = getService();
      const result = mode === 'signup'
        ? await svc.signUp(email, password, displayName || email.split('@')[0])
        : await svc.signIn(email, password);
      onAuthed(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-500 rounded-2xl mb-4 shadow-lg shadow-blue-500/30">
            <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x={3} y={3} width={18} height={18} rx={2} />
              <path d="M9 9 H15 M9 13 H15 M9 17 H13" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Design Interview</h1>
          <p className="text-slate-400 mt-1">Collaborative system design interviews</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex gap-2 mb-6 bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setMode('signup')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${mode === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              Sign Up
            </button>
            <button
              onClick={() => setMode('signin')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${mode === 'signin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              Sign In
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2.5 rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {loading ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <p className="text-xs text-slate-400 text-center mt-4">
            This is a demo. Use any email and password to create an account.
          </p>
        </div>
      </div>
    </div>
  );
}
