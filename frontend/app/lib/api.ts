'use client';

export class Unauthorized extends Error {
  constructor() {
    super('session expired');
    this.name = 'Unauthorized';
  }
}

export async function requestJson<T>(url: string, options: RequestInit = {}, timeoutMs = 120_000): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (res.status === 401) throw new Unauthorized();

    const body = await res.json().catch(() => null);
    if (body && typeof body === 'object' && body.error) throw new Error(String(body.error));
    if (!res.ok) throw new Error(`Request failed (${res.status}). Please try again.`);
    if (body === null) throw new Error('The server returned an invalid response. Please try again.');
    return body as T;
  } catch (err) {
    if (controller.signal.aborted) throw new Error('The request timed out or was cancelled. Please try again.');
    if (err instanceof TypeError) throw new Error('Cannot reach the server. Check your connection and try again.');
    throw err;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

// Protected data requests share one session-expiry path.
export async function getJson<T>(url: string, options?: RequestInit): Promise<T> {
  try {
    return await requestJson<T>(url, options);
  } catch (err) {
    if (err instanceof Unauthorized && typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.replace('/login');
    }
    throw err;
  }
}
