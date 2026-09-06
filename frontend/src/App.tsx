import { useState, useEffect } from 'react';
import { getService } from '@/services';
import type { AuthResult, User } from '@/services/types';
import { AuthScreen } from '@/components/AuthScreen';
import { Dashboard } from '@/components/Dashboard';
import { CreateSession } from '@/components/CreateSession';
import { Lobby } from '@/components/Lobby';
import { InterviewRoom } from '@/components/InterviewRoom';
import { PARTICIPANT_COLORS } from '@/canvas/palette';

type Route =
  | { name: 'auth' }
  | { name: 'dashboard' }
  | { name: 'create' }
  | { name: 'lobby'; token: string }
  | { name: 'room'; sessionId: string; participantId: string; color: string; participantName: string; isOwner: boolean };

function parseHash(): { route: Route; token?: string } {
  const hash = window.location.hash.slice(1);
  if (hash.startsWith('/join/')) {
    const token = hash.slice('/join/'.length);
    return { route: { name: 'lobby', token }, token };
  }
  return { route: { name: 'auth' } };
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [route, setRoute] = useState<Route>({ name: 'auth' });
  const [participantColor, setParticipantColor] = useState(PARTICIPANT_COLORS[0]);

  useEffect(() => {
    const svc = getService();
    const currentUser = svc.getCurrentUser();
    if (currentUser) {
      setUser(currentUser);
      setRoute({ name: 'dashboard' });
    } else {
      const { route: parsed } = parseHash();
      setRoute(parsed);
    }
  }, []);

  useEffect(() => {
    if (route.name === 'lobby') {
      window.location.hash = `/join/${route.token}`;
    } else if (route.name === 'auth') {
      const hash = window.location.hash.slice(1);
      if (hash.startsWith('/join/')) {
        // Keep the hash for lobby
      } else {
        window.location.hash = '';
      }
    }
  }, [route]);

  const handleAuthed = (result: AuthResult) => {
    setUser(result.user);
    setRoute({ name: 'dashboard' });
  };

  const handleSignOut = async () => {
    const svc = getService();
    await svc.signOut();
    setUser(null);
    setRoute({ name: 'auth' });
  };

  const handleNewSession = () => {
    setRoute({ name: 'create' });
  };

  const handleSessionCreated = (id: string) => {
    setParticipantColor(PARTICIPANT_COLORS[0]);
    setRoute({ name: 'room', sessionId: id, participantId: 'owner', color: PARTICIPANT_COLORS[0], participantName: user?.display_name ?? 'Owner', isOwner: true });
  };

  const handleOpenSession = (id: string) => {
    setParticipantColor(PARTICIPANT_COLORS[0]);
    setRoute({ name: 'room', sessionId: id, participantId: 'owner', color: PARTICIPANT_COLORS[0], participantName: user?.display_name ?? 'Owner', isOwner: true });
  };

  const handleJoined = (participantId: string, sessionId: string) => {
    const svc = getService();
    const colorIdx = Math.floor(Math.random() * PARTICIPANT_COLORS.length);
    const color = PARTICIPANT_COLORS[colorIdx];
    setParticipantColor(color);
    const currentUser = svc.getCurrentUser();
    const name = currentUser?.display_name ?? 'Participant';
    setRoute({ name: 'room', sessionId, participantId, color, participantName: name, isOwner: false });
  };

  const handleLeave = () => {
    if (user) {
      setRoute({ name: 'dashboard' });
    } else {
      setRoute({ name: 'auth' });
    }
  };

  if (route.name === 'auth') {
    return <AuthScreen onAuthed={handleAuthed} />;
  }

  if (route.name === 'dashboard') {
    return (
      <Dashboard
        userId={user!.id}
        onOpenSession={handleOpenSession}
        onNewSession={handleNewSession}
        onSignOut={handleSignOut}
      />
    );
  }

  if (route.name === 'create') {
    return (
      <CreateSession
        onCreated={handleSessionCreated}
        onCancel={() => setRoute({ name: 'dashboard' })}
      />
    );
  }

  if (route.name === 'lobby') {
    return (
      <Lobby
        token={route.token}
        onJoined={handleJoined}
        onError={() => {}}
      />
    );
  }

  if (route.name === 'room') {
    return (
      <InterviewRoom
        sessionId={route.sessionId}
        participantId={route.participantId}
        participantColor={route.color}
        participantName={route.participantName}
        isOwner={route.isOwner}
        onLeave={handleLeave}
      />
    );
  }

  return <AuthScreen onAuthed={handleAuthed} />;
}

export default App;
