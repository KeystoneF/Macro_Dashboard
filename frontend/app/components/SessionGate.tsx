'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { COLOR, FONT } from '../theme';
import { me, signOut, type User } from '../lib/session';

type Ctx = { user: User; end: () => void };

const SessionContext = createContext<Ctx | null>(null);

// Only ever called from inside the gate, so a user is guaranteed there.
export function useSession(): Ctx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionGate');
  return ctx;
}

// The cookie is httpOnly, so the only way to know whether there is a session is
// to ask the API. That is one round trip before the desk can draw, which is why
// this waits rather than flashing the shell at someone about to be redirected.
//
// This is a convenience, not the guard. The real one is on the server: every
// /api route except health and auth answers 401 without a valid token, so a
// visitor who skips this by typing a URL gets an empty page and nothing else.
export default function SessionGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let live = true;
    me()
      .then((m) => {
        if (!live) return;
        setUser(m.user);
        setChecked(true);
        if (!m.user) router.replace('/login');
      })
      .catch(() => {
        if (!live) return;
        setChecked(true);
        router.replace('/login');
      });
    return () => {
      live = false;
    };
  }, [router]);

  const end = useCallback(() => {
    signOut().finally(() => {
      setUser(null);
      router.replace('/login');
    });
  }, [router]);

  const value = useMemo(() => (user ? { user, end } : null), [user, end]);

  if (!value) return <Waiting label={checked ? 'Redirecting to sign in' : 'Checking session'} />;

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function Waiting({ label }: { label: string }) {
  return <div style={waiting}>{label}</div>;
}

const waiting = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: COLOR.bg,
  color: COLOR.dim,
  fontFamily: FONT.body,
  fontSize: 12,
} as const;
