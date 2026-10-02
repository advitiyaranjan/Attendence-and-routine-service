import { apiBase, authToken, isNative } from './platform';

/** Errors carry a message that is safe to show to the user. */
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
  get offline() {
    return this.code === 'offline';
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  const base = apiBase();
  if (isNative && !base) {
    throw new ApiError('Set your server address in Settings → Account & sync to use online features.', 'no_server', 0);
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ApiError("You're offline. This needs an internet connection.", 'offline', 0);
  }
  let res: Response;
  try {
    const token = authToken();
    res = await fetch(`${base}${path}`, {
      method: init.method ?? (init.body || init.form ? 'POST' : 'GET'),
      credentials: 'include',
      headers: {
        'X-Requested-With': 'student-os',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError("Can't reach the server right now. Your data is safe locally.", 'offline', 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(e?.message ?? 'Something went wrong. Please try again.', e?.code ?? 'error', res.status);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}
