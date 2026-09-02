'use client';

// A session that has run out looks like a 401 on whatever the page asked for
// next. Handling it here rather than in each page means an analyst whose token
// expired gets sent to sign in, instead of six panels each rendering
// "not signed in" in a red box with no way forward.
function sessionLost() {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === '/login') return;
  window.location.replace('/login');
}

export class Unauthorized extends Error {
  constructor() {
    super('session expired');
    this.name = 'Unauthorized';
  }
}

// The API answers 200 with an { error } body when a source fails, so a bad
// FRED key looks like success to fetch. Unwrap that here rather than in six
// places that each remember to check it differently.
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);

  if (res.status === 401) {
    sessionLost();
    throw new Unauthorized();
  }

  const body = await res.json().catch(() => null);
  if (body && typeof body === 'object' && 'error' in body) {
    throw new Error(String((body as { error: unknown }).error));
  }
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return body as T;
}
