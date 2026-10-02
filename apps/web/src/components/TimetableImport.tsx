import { useRef, useState } from 'react';
import { Check, FileUp, Merge, Plus, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import {
  addDays,
  normalizeTime,
  parseWeekday,
  timeToMinutes,
  todayISO,
  WEEKDAY_SHORT,
  type ClassType,
  type TimetableExtraction,
} from '@student-os/core';
import { extractTimetable } from '../lib/ai';
import { errorMessage } from '../lib/api';
import { db } from '../lib/db';
import { SUBJECT_COLORS } from '../lib/actions';
import { create, update } from '../lib/repo';
import { toast, useApp } from '../lib/store';
import { Button, Card, cn, Input, Select, Toggle } from './ui';

export interface ReviewRow {
  key: string;
  name: string;
  code: string;
  faculty: string;
  room: string;
  day: number;
  start: string;
  end: string;
  type: ClassType;
  credits: string;
}

const blankRow = (day = 1): ReviewRow => ({ key: uuid(), name: '', code: '', faculty: '', room: '', day, start: '09:00', end: '10:00', type: 'lecture', credits: '' });

function fromExtraction(x: TimetableExtraction): ReviewRow[] {
  return x.subjects.map((s) => ({
    key: uuid(),
    name: s.name,
    code: s.code ?? '',
    faculty: s.faculty ?? '',
    room: s.room ?? '',
    day: s.day,
    start: s.start_time,
    end: s.end_time,
    type: s.type,
    credits: s.credits?.toString() ?? '',
  }));
}

/** Offline fallback: CSV with a header row containing day/start/end/subject columns. */
export function parseTimetableCsv(text: string): ReviewRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const split = (l: string) => l.split(/,|\t|;/).map((c) => c.trim().replace(/^"|"$/g, ''));
  const header = split(lines[0]!).map((h) => h.toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const c = {
    day: col('day'),
    start: col('start', 'from'),
    end: col('end', 'to'),
    name: col('subject', 'course', 'name'),
    code: col('code'),
    faculty: col('faculty', 'teacher', 'professor', 'instructor'),
    room: col('room', 'venue', 'hall'),
    type: col('type'),
  };
  if (c.day < 0 || c.start < 0 || c.end < 0 || c.name < 0) return [];
  const rows: ReviewRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = split(line);
    const day = parseWeekday(cells[c.day] ?? '');
    const start = normalizeTime(cells[c.start] ?? '');
    const end = normalizeTime(cells[c.end] ?? '');
    const name = cells[c.name] ?? '';
    if (day === null || !start || !end || !name) continue;
    const type = (cells[c.type] ?? '').toLowerCase();
    rows.push({
      ...blankRow(day),
      name,
      code: c.code >= 0 ? (cells[c.code] ?? '') : '',
      faculty: c.faculty >= 0 ? (cells[c.faculty] ?? '') : '',
      room: c.room >= 0 ? (cells[c.room] ?? '') : '',
      start,
      end,
      type: type.includes('lab') ? 'lab' : type.includes('tut') ? 'tutorial' : 'lecture',
    });
  }
  return rows;
}

function sortRows(rows: ReviewRow[]) {
  return [...rows].sort((a, b) => a.day - b.day || timeToMinutes(a.start) - timeToMinutes(b.start));
}

function rowIssue(r: ReviewRow): string | null {
  if (!r.name.trim()) return 'Subject name is required';
  if (!/^\d{2}:\d{2}$/.test(r.start) || !/^\d{2}:\d{2}$/.test(r.end)) return 'Invalid time';
  if (r.start >= r.end) return 'End must be after start';
  return null;
}

/**
 * Upload → AI extraction → editable review → confirm.
 * Nothing is saved until the student confirms.
 */
export function TimetableImport({ onDone, mode }: { onDone: () => void; mode: 'onboarding' | 'replace' }) {
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replace, setReplace] = useState(mode === 'replace');
  const fileRef = useRef<HTMLInputElement>(null);
  const aiAvailable = useApp((s) => s.aiAvailable);
  const online = useApp((s) => s.online);

  async function onFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const isCsv = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
      if (isCsv) {
        const local = parseTimetableCsv(await file.text());
        if (local.length && (!online || !aiAvailable)) {
          setRows(sortRows(local));
          setWarnings(['Imported directly from CSV columns. Check every row.']);
          return;
        }
      }
      if (!online) throw new Error('offline');
      const result = await extractTimetable(file);
      if (result.subjects.length === 0) {
        setError("No classes were detected. Try a clearer image or add classes manually.");
        return;
      }
      setRows(sortRows(fromExtraction(result)));
      setWarnings(result.warnings);
    } catch (err) {
      setError(
        (err as Error).message === 'offline'
          ? 'AI import needs an internet connection. You can add classes manually, or upload a CSV with day/start/end/subject columns.'
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const set = (key: string, patch: Partial<ReviewRow>) => setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function mergeWithNext(index: number) {
    setRows((rs) => {
      const list = [...rs!];
      const a = list[index]!;
      const b = list[index + 1]!;
      list.splice(index, 2, { ...a, end: b.end > a.end ? b.end : a.end, start: a.start < b.start ? a.start : b.start, room: a.room || b.room, faculty: a.faculty || b.faculty });
      return list;
    });
  }

  async function confirm() {
    if (!rows) return;
    const valid = rows.filter((r) => !rowIssue(r));
    setBusy(true);
    try {
      const existing = (await db.entity('subject').toArray()).filter((s) => !s.deletedAt);
      const subjectIds = new Map<string, string>();
      let colorIndex = existing.length;
      for (const r of valid) {
        const key = r.name.trim().toLowerCase();
        if (subjectIds.has(key)) continue;
        const match = existing.find((s) => s.name.toLowerCase() === key || (r.code && s.code?.toLowerCase() === r.code.toLowerCase()));
        if (match) {
          subjectIds.set(key, match.id);
          continue;
        }
        const subject = await create('subject', {
          name: r.name.trim(),
          code: r.code || null,
          faculty: r.faculty || null,
          credits: r.credits ? Number(r.credits) : null,
          color: SUBJECT_COLORS[colorIndex++ % SUBJECT_COLORS.length],
        });
        subjectIds.set(key, subject.id);
      }

      const today = todayISO();
      if (replace) {
        // Keep history: old slots stop yesterday instead of being deleted.
        const old = (await db.entity('classSchedule').toArray()).filter((s) => !s.deletedAt && s.active && (!s.validUntil || s.validUntil >= today));
        for (const s of old) await update('classSchedule', s.id, { validUntil: addDays(today, -1) });
      }
      for (const r of valid) {
        await create('classSchedule', {
          subjectId: subjectIds.get(r.name.trim().toLowerCase())!,
          weekday: r.day,
          startTime: r.start,
          endTime: r.end,
          room: r.room || null,
          faculty: r.faculty || null,
          type: r.type,
          validFrom: replace ? today : null,
        });
      }
      toast(`Timetable saved: ${subjectIds.size} subjects, ${valid.length} weekly classes`, 'success');
      onDone();
    } catch (err) {
      console.error(err);
      toast("Couldn't save the timetable. Please try again.", 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!rows) {
    return (
      <div className="space-y-3">
        <div
          className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-6 py-10 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) void onFile(f);
          }}
        >
          <FileUp className="size-8 text-muted" />
          <div>
            <p className="font-medium">Upload your timetable</p>
            <p className="text-sm text-ink-2">PDF, image, screenshot, Excel or CSV. AI detects every class; you review before anything is saved.</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.xlsx,.csv,application/pdf,image/*"
            onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
          />
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" loading={busy} icon={<Sparkles className="size-4" />} onClick={() => fileRef.current?.click()}>
              {busy ? 'Reading timetable' : 'Choose file'}
            </Button>
            <Button variant="secondary" onClick={() => setRows([blankRow()])} icon={<Plus className="size-4" />}>
              Enter manually
            </Button>
          </div>
          {aiAvailable === false && online && <p className="text-xs text-muted">AI isn't configured on the server — CSV and manual entry still work.</p>}
        </div>
        {error && (
          <p className="flex items-start gap-2 text-sm text-critical-ink">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}
      </div>
    );
  }

  const issues = rows.map(rowIssue);
  const subjectCount = new Set(rows.filter((r) => r.name.trim()).map((r) => r.name.trim().toLowerCase())).size;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Review imported schedule</h3>
          <p className="text-sm text-ink-2">
            {subjectCount} subjects · {rows.length} weekly classes. Edit anything that looks wrong.
          </p>
        </div>
        <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setRows([...rows, blankRow(rows.at(-1)?.day ?? 1)])}>
          Add row
        </Button>
      </div>

      {warnings.length > 0 && (
        <Card className="border-warning/50 text-sm">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <TriangleAlert className="size-4" style={{ color: 'var(--color-warning)' }} /> Please double-check
          </div>
          <ul className="list-disc pl-5 text-ink-2">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-surface-2 text-left text-xs text-ink-2">
            <tr>
              <th className="px-2 py-2 font-medium">Day</th>
              <th className="px-2 py-2 font-medium">Start</th>
              <th className="px-2 py-2 font-medium">End</th>
              <th className="px-2 py-2 font-medium">Subject</th>
              <th className="px-2 py-2 font-medium">Code</th>
              <th className="px-2 py-2 font-medium">Faculty</th>
              <th className="px-2 py-2 font-medium">Room</th>
              <th className="px-2 py-2 font-medium">Type</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const next = rows[i + 1];
              const canMerge = next && next.day === r.day && next.name.trim().toLowerCase() === r.name.trim().toLowerCase() && next.start <= r.end;
              return (
                <tr key={r.key} className={cn('border-t border-line', issues[i] && 'bg-critical/5')}>
                  <td className="p-1">
                    <Select value={r.day} onChange={(e) => set(r.key, { day: Number(e.target.value) })} className="h-8 w-20" aria-label="Day">
                      {WEEKDAY_SHORT.map((d, idx) => (
                        <option key={d} value={idx}>
                          {d}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="p-1">
                    <Input type="time" value={r.start} onChange={(e) => set(r.key, { start: e.target.value })} className="h-8 w-28" aria-label="Start" />
                  </td>
                  <td className="p-1">
                    <Input type="time" value={r.end} onChange={(e) => set(r.key, { end: e.target.value })} className="h-8 w-28" aria-label="End" />
                  </td>
                  <td className="p-1">
                    <Input value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} className="h-8 min-w-40" aria-label="Subject" title={issues[i] ?? undefined} />
                  </td>
                  <td className="p-1">
                    <Input value={r.code} onChange={(e) => set(r.key, { code: e.target.value })} className="h-8 w-20" aria-label="Code" />
                  </td>
                  <td className="p-1">
                    <Input value={r.faculty} onChange={(e) => set(r.key, { faculty: e.target.value })} className="h-8 w-32" aria-label="Faculty" />
                  </td>
                  <td className="p-1">
                    <Input value={r.room} onChange={(e) => set(r.key, { room: e.target.value })} className="h-8 w-20" aria-label="Room" />
                  </td>
                  <td className="p-1">
                    <Select value={r.type} onChange={(e) => set(r.key, { type: e.target.value as ClassType })} className="h-8 w-28" aria-label="Type">
                      <option value="lecture">Lecture</option>
                      <option value="lab">Lab</option>
                      <option value="tutorial">Tutorial</option>
                      <option value="other">Other</option>
                    </Select>
                  </td>
                  <td className="whitespace-nowrap p-1">
                    {canMerge && (
                      <Button size="sm" variant="ghost" title="Merge with next row" aria-label="Merge with next row" onClick={() => mergeWithNext(i)}>
                        <Merge className="size-4" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" aria-label="Delete row" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {issues.some(Boolean) && <p className="text-sm text-critical-ink">{issues.filter(Boolean).length} row(s) have problems and will be skipped unless fixed.</p>}

      {mode === 'replace' && (
        <Toggle
          checked={replace}
          onChange={setReplace}
          label="Replace my current timetable"
          description="Current weekly classes end yesterday; past attendance is kept. Turn off to add these classes alongside."
        />
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setRows(null)}>
          Start over
        </Button>
        <Button variant="primary" loading={busy} disabled={!issues.some((x) => !x)} icon={<Check className="size-4" />} onClick={confirm}>
          Confirm timetable
        </Button>
      </div>
    </div>
  );
}
