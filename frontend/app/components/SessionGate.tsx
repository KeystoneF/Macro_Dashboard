'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { COLOR, FONT, control } from '../theme';
import { me, signOut, type User } from '../lib/session';

type Ctx = { user: User; end: () => void; ending: boolean };
const SessionContext = createContext<Ctx | null>(null);

export function useSession(): Ctx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionGate');
  return ctx;
}

// This gate handles navigation; the API enforces access.
export default function SessionGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [ending, setEnding] = useState(false);
  const signingOut = useRef(false);

  useEffect(() => {
    let live = true;
    me()
      .then((session) => {
        if (!live) return;
        setUser(session.user);
        setChecked(true);
        if (!session.user) router.replace('/login');
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not check your session.');
      });
    return () => { live = false; };
  }, [router, attempt]);

  const end = useCallback(() => {
    if (signingOut.current) return;
    signingOut.current = true;
    setEnding(true);
    setError(null);
    signOut()
      .then(() => {
        setUser(null);
        router.replace('/login');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not sign out. Please try again.'))
      .finally(() => {
        signingOut.current = false;
        setEnding(false);
      });
  }, [router]);

  const value = useMemo(() => user ? { user, end, ending } : null, [user, end, ending]);

  if (!user) return (
    <div style={waiting}>
      <p role={error ? 'alert' : 'status'}>{error || (checked ? 'Redirecting to sign in' : 'Checking session')}</p>
      {error && <button style={control} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button>}
    </div>
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {error && (
        <div role="alert" style={notice}>
          <span>{error}</span>
          <button style={control} onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
    </SessionContext.Provider>
  );
}

const waiting = {
  minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 16,
  alignItems: 'center', justifyContent: 'center', padding: 24,
  background: COLOR.bg, color: COLOR.dim, fontFamily: FONT.body, fontSize: 14,
} as const;

const notice = {
  position: 'fixed', bottom: 16, right: 16, zIndex: 20,
  display: 'flex', alignItems: 'center', gap: 16, padding: 16,
  maxWidth: 'calc(100vw - 32px)', background: COLOR.panel,
  color: COLOR.ink, border: `1px solid ${COLOR.bad}`, borderRadius: 12,
} as const;
