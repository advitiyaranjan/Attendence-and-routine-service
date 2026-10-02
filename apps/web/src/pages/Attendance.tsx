import { AskAI } from '../components/AskAI';
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addMonths,
  classesNeededToReach,
  eachDay,
  endOfMonth,
  fmtPct,
  riskLevel,
  startOfMonth,
  startOfWeek,
  whatIf,
  WEEKDAY_SHORT,
  type ClassOccurrence,
} from '@student-os/core';
import { ClassRow } from '../components/ClassRow';
import { Card, EmptyState, Field, Input, Meter, PageHeader, RiskPill, riskColor, Select, SectionTitle, Stat, SubjectDot, cn } from '../components/ui';
import { thresholdsFor, useAttendance, useOccurrences, useSettings, useSubjectMap, useToday, type SubjectAttendance } from '../lib/hooks';

export default function Attendance() {
  const att = useAttendance();
  const settings = useSettings();
  const subjects = useSubjectMap();
  const today = useToday();

  if (!att) return null;
  if (att.subjects.length === 0) {
    return (
      <>
        <PageHeader title="Attendance" />
        <EmptyState title="No subjects yet" body="Import your timetable to start tracking attendance automatically." />
      </>
    );
  }

  const below = att.subjects.filter((s) => s.summary.risk === 'below_min').length;
  const atRisk = att.subjects.filter((s) => s.summary.risk === 'at_risk').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        subtitle={`Minimum ${settings.minAttendance}% · target ${settings.targetAttendance}%. Cancelled and rescheduled classes don't count.`}
      />
      <AskAI placeholder="Ask AI about my attendance…" prompts={['How is my attendance?', 'Which subjects are at risk?', 'Can I skip tomorrow?']} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Overall" value={fmtPct(att.overall.percent)} sub={`${att.overall.present}/${att.overall.conducted} classes`} />
        <Stat label="Below minimum" value={below} sub="subjects" />
        <Stat label="At risk" value={atRisk} sub="subjects" />
        <Stat label="Unmarked" value={att.overall.unmarked} sub="past classes" />
      </div>

      <section>
        <SectionTitle>By subject</SectionTitle>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {att.subjects
            .slice()
            .sort((a, b) => (a.summary.percent ?? 101) - (b.summary.percent ?? 101))
            .map((s) => (
              <SubjectCard key={s.subject.id} data={s} min={s.subject.minAttendance ?? settings.minAttendance} />
            ))}
        </div>
      </section>

      <WhatIf subjects={att.subjects} />

      {att.unmarked.length > 0 && (
        <Card>
          <SectionTitle action={<span className="text-xs text-muted">{att.unmarked.length} classes</span>}>Needs marking</SectionTitle>
          <div className="divide-y divide-line">
            {att.unmarked
              .slice()
              .reverse()
              .slice(0, 30)
              .map((o) => (
                <div key={o.id}>
                  <div className="pt-2 text-[11px] text-muted">{o.date === today ? 'Today' : o.date}</div>
                  <ClassRow occ={o} subject={subjects.get(o.subjectId)} compact />
                </div>
              ))}
          </div>
        </Card>
      )}

      <AttendanceCalendar />
    </div>
  );
}

function SubjectCard({ data: { subject, summary }, min }: { data: SubjectAttendance; min: number }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <SubjectDot color={subject.color} />
          <span className="truncate font-medium">{subject.name}</span>
        </div>
        <RiskPill risk={summary.risk} />
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-2xl font-semibold tabular">{fmtPct(summary.percent)}</span>
        <span className="text-xs text-ink-2 tabular">
          {summary.present} present · {summary.absent} absent · {summary.cancelled} cancelled
        </span>
      </div>
      <div className="mt-2">
        <Meter value={summary.percent} color={riskColor(summary.risk)} marker={min} label={`${subject.name} attendance`} />
      </div>
      <p className="mt-2 text-xs text-ink-2">{summary.advice}</p>
      {summary.unmarked > 0 && <p className="mt-1 text-xs text-muted">{summary.unmarked} class(es) not marked yet.</p>}
    </Card>
  );
}

function WhatIf({ subjects }: { subjects: SubjectAttendance[] }) {
  const settings = useSettings();
  const [subjectId, setSubjectId] = useState(subjects[0]?.subject.id ?? '');
  const [miss, setMiss] = useState(2);
  const [attend, setAttend] = useState(0);
  const [target, setTarget] = useState(settings.targetAttendance);
  const s = subjects.find((x) => x.subject.id === subjectId) ?? subjects[0];
  if (!s) return null;
  const th = thresholdsFor(settings, s.subject);
  const after = whatIf(s.summary.present, s.summary.conducted, attend, miss);
  const risk = riskLevel(after, th);
  const needed = classesNeededToReach(s.summary.present, s.summary.conducted, target);

  return (
    <Card>
      <SectionTitle>What if?</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Subject">
          <Select value={s.subject.id} onChange={(e) => setSubjectId(e.target.value)}>
            {subjects.map((x) => (
              <option key={x.subject.id} value={x.subject.id}>
                {x.subject.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="I attend the next">
          <Input type="number" min={0} max={200} value={attend} onChange={(e) => setAttend(Math.max(0, Number(e.target.value)))} />
        </Field>
        <Field label="…and miss">
          <Input type="number" min={0} max={200} value={miss} onChange={(e) => setMiss(Math.max(0, Number(e.target.value)))} />
        </Field>
      </div>
      <div className="mt-4 grid gap-4 rounded-lg bg-surface-2 p-3 sm:grid-cols-2">
        <div>
          <div className="text-xs text-ink-2">Current</div>
          <div className="text-lg font-semibold tabular">
            {fmtPct(s.summary.percent)} <span className="text-sm font-normal text-ink-2">({s.summary.present}/{s.summary.conducted})</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-ink-2">
            After attending {attend} and missing {miss}
          </div>
          <div className="flex items-center gap-2 text-lg font-semibold tabular">
            {fmtPct(after)} <RiskPill risk={risk} />
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="To reach (%)">
          <Input type="number" min={1} max={100} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="w-24" />
        </Field>
        <p className="pb-2 text-sm">
          {needed === 0
            ? `You're already at or above ${target}%.`
            : Number.isFinite(needed)
              ? `Attend the next ${needed} ${s.subject.name} class${needed === 1 ? '' : 'es'} in a row to reach ${target}%.`
              : `${target}% is no longer reachable.`}
          {s.summary.projection && Number.isFinite(needed) && needed > s.summary.projection.remaining && needed > 0 && (
            <span className="text-critical-ink"> Only {s.summary.projection.remaining} classes remain this semester.</span>
          )}
        </p>
      </div>
    </Card>
  );
}

function AttendanceCalendar() {
  const today = useToday();
  const settings = useSettings();
  const [month, setMonth] = useState(startOfMonth(today));
  const from = startOfWeek(month, settings.weekStartsOn);
  const to = endOfMonth(month);
  const occ = useOccurrences(from, to < today ? to : today) ?? [];
  const byDate = new Map<string, ClassOccurrence[]>();
  for (const o of occ) {
    if (!byDate.has(o.date)) byDate.set(o.date, []);
    byDate.get(o.date)!.push(o);
  }
  const days = eachDay(from, to);
  const headers = Array.from({ length: 7 }, (_, i) => WEEKDAY_SHORT[(i + settings.weekStartsOn) % 7]);

  return (
    <Card>
      <SectionTitle
        action={
          <div className="flex items-center gap-1">
            <button className="rounded p-1 hover:bg-surface-2" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
              <ChevronLeft className="size-4" />
            </button>
            <span className="w-28 text-center text-sm">{new Date(`${month}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
            <button className="rounded p-1 hover:bg-surface-2" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
              <ChevronRight className="size-4" />
            </button>
          </div>
        }
      >
        Attendance calendar
      </SectionTitle>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {headers.map((h) => (
          <div key={h} className="py-1 text-muted">
            {h}
          </div>
        ))}
        {days.map((d) => {
          const list = byDate.get(d) ?? [];
          const p = list.filter((o) => o.status === 'present').length;
          const a = list.filter((o) => o.status === 'absent').length;
          const u = list.filter((o) => o.status === null || o.status === 'unsure').length;
          const inMonth = d.startsWith(month.slice(0, 7));
          return (
            <div
              key={d}
              className={cn('min-h-12 rounded-md border border-line p-1', !inMonth && 'opacity-40', d === today && 'border-accent')}
              title={`${d}: ${p} present, ${a} absent${u ? `, ${u} unmarked` : ''}`}
            >
              <div className="text-[11px] text-ink-2">{Number(d.slice(8))}</div>
              <div className="mt-0.5 flex flex-wrap justify-center gap-0.5">
                {list.map((o) => (
                  <span
                    key={o.id}
                    className="size-1.5 rounded-full"
                    style={{
                      background:
                        o.status === 'present'
                          ? 'var(--color-good)'
                          : o.status === 'absent'
                            ? 'var(--color-critical)'
                            : o.status === 'cancelled' || o.status === 'rescheduled'
                              ? 'transparent'
                              : 'var(--muted)',
                      border: o.status === 'cancelled' || o.status === 'rescheduled' ? '1px solid var(--muted)' : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-2">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ background: 'var(--color-good)' }} /> Present
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ background: 'var(--color-critical)' }} /> Absent
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-muted" /> Not marked
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full border border-muted" /> Cancelled / moved
        </span>
      </div>
    </Card>
  );
}
