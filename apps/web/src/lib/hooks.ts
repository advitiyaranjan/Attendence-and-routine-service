import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { todayISO, type AttendanceOverview, type ClassOccurrence, type EntityMap, type EntityName, type ISODate, type Settings, type Subject } from '@student-os/core';
import { db } from './db';
import { computeAttendance, occurrencesBetween } from './queries';
import { defaultSettings, normalizeSettings, SETTINGS_ID } from './repo';

export { computeAttendance, occurrencesBetween } from './queries';
export { rulesFrom, thresholdsFor, trackingStart, type AttendanceOverview, type SubjectAttendance } from '@student-os/core';

/** Live list of non-deleted records of an entity. */
export function useAll<E extends EntityName>(entity: E): EntityMap[E][] | undefined {
  return useLiveQuery(async () => (await db.entity(entity).toArray()).filter((r) => !r.deletedAt), [entity]);
}

export function useSettings(): Settings {
  const s = useLiveQuery(() => db.entity('settings').get(SETTINGS_ID), []);
  return useMemo(() => (s ? normalizeSettings(s) : FALLBACK_SETTINGS), [s]);
}
const FALLBACK_SETTINGS = defaultSettings();

/** Re-renders at midnight (and every minute) so "today" stays correct in long-lived tabs. */
export function useToday(): ISODate {
  const [today, setToday] = useState(todayISO());
  useEffect(() => {
    const t = setInterval(() => setToday(todayISO()), 60_000);
    return () => clearInterval(t);
  }, []);
  return today;
}

export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Classes (scheduled + stored) between two dates, kept live. */
export function useOccurrences(from: ISODate, to: ISODate): ClassOccurrence[] | undefined {
  const settings = useSettings();
  return useLiveQuery(() => occurrencesBetween(from, to, settings), [from, to, settings]);
}

export function useAttendance(): AttendanceOverview | undefined {
  const settings = useSettings();
  const today = useToday();
  return useLiveQuery(() => computeAttendance(settings, today), [settings, today]);
}

export function useSubjectMap(): Map<string, Subject> {
  const subjects = useAll('subject');
  return new Map((subjects ?? []).map((s) => [s.id, s]));
}

/** True while a CSS media query matches, e.g. useMedia('(min-width: 768px)'). */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
