import { v4 as uuid } from 'uuid';

const KEY = 'sos-device-id';
let cached: string | null = null;

/** Stable per-browser id used for sync attribution and conflict tie-breaking. */
export function deviceId(): string {
  if (cached) return cached;
  try {
    cached = localStorage.getItem(KEY);
    if (!cached) {
      cached = uuid();
      localStorage.setItem(KEY, cached);
    }
  } catch {
    cached = uuid();
  }
  return cached;
}
