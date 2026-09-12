'use client';

import { requestJson, Unauthorized } from './api';

// The browser handles the httpOnly session cookie.
export type User = { id: string; email: string; name: string };
export type Provider = string;
export type Me = { user: User | null; provider: Provider };

export const me = () => requestJson<Me>('/api/auth/me', {}, 15_000);

export async function signIn(email: string, password: string, remember = true): Promise<User> {
  try {
    const body = await requestJson<{ user: User }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, remember }),
    }, 15_000);
    return body.user;
  } catch (err) {
    if (err instanceof Unauthorized) throw new Error('Email or password is incorrect.');
    throw err;
  }
}

export async function signOut(): Promise<void> {
  await requestJson('/api/auth/logout', { method: 'POST' }, 15_000);
}
