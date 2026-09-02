'use client';

// The session lives in an httpOnly cookie the browser sends on every request to
// /api. Page scripts cannot read it, which is the point: a token in
// localStorage is readable by anything that manages to run on the page.
//
// So there is no token here. This module asks the API who the caller is and
// tells it to start or end a session; the browser handles the rest.

export type User = { id: string; email: string; name: string };

// Which backend answered. `local` is our own users table; anything else means
// MacroDesk is verifying a token issued somewhere it does not control, and the
// sign-in form belongs to that provider rather than to us.
export type Provider = string;

export type Me = { user: User | null; provider: Provider };

export async function me(): Promise<Me> {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (!res.ok) return { user: null, provider: 'local' };
  return res.json();
}

// `remember` false asks for a cookie that dies with the browser session. The
// token's own expiry still caps how long either kind is good for.
export async function signIn(email: string, password: string, remember = true): Promise<User> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, remember }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && body.error) || `sign-in failed (${res.status})`);
  return body.user as User;
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
}
