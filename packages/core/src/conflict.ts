/**
 * Deterministic conflict resolution for synced records.
 *
 * A write is a conflict when the client based it on an older server version
 * than the one currently stored (someone else wrote in between). Conflicts are
 * resolved by last-write-wins on `updatedAt`, with deviceId as a deterministic
 * tie-breaker. The losing version is returned so the caller can keep it in a
 * conflict log; nothing is silently destroyed.
 */

export interface Versioned {
  updatedAt: string;
  deviceId: string;
  version: number;
}

/** >0 if a is newer than b, <0 if older, 0 only when identical. */
export function compareWrites(a: Pick<Versioned, 'updatedAt' | 'deviceId'>, b: Pick<Versioned, 'updatedAt' | 'deviceId'>): number {
  const ta = Date.parse(a.updatedAt);
  const tb = Date.parse(b.updatedAt);
  if (ta !== tb) return ta - tb;
  return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
}

export type Resolution<T> =
  | { kind: 'insert'; winner: T }
  | { kind: 'fast_forward'; winner: T }
  | { kind: 'conflict'; winner: T; loser: T; incomingWon: boolean };

/**
 * @param stored     record currently on the server (or null)
 * @param incoming   record sent by the client
 * @param baseVersion version the client last saw for this record
 */
export function resolveWrite<T extends Versioned>(stored: T | null, incoming: T, baseVersion: number): Resolution<T> {
  if (!stored) return { kind: 'insert', winner: incoming };
  if (stored.version <= baseVersion) return { kind: 'fast_forward', winner: incoming };
  const incomingWon = compareWrites(incoming, stored) > 0;
  return incomingWon
    ? { kind: 'conflict', winner: incoming, loser: stored, incomingWon }
    : { kind: 'conflict', winner: stored, loser: incoming, incomingWon };
}
