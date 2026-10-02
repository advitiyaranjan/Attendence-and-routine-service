import { Link } from 'react-router';
import { AlertTriangle, ArrowRight, CalendarClock, Clock, Flame, MapPin, Repeat } from 'lucide-react';
import {
  computeStreak,
  diffDays,
  fmtPct,
  formatMinutes,
  formatTime12,
  nowMinutes,
  rankTasks,
  timeToMinutes,
  type RecallRating,
  type RevisionSchedule,
} from '@student-os/core';
import { useState } from 'react';
import { AskAI } from '../components/AskAI';
import { ClassRow } from '../components/ClassRow';
import { Button, Card, Checkbox, cn, Meter, Modal, SectionTitle, SubjectDot, riskColor } from '../components/ui';
import { completeRevision } from '../lib/actions';
import { useAll, useAttendance, useNow, useOccurrences, useSettings, useSubjectMap, useToday } from '../lib/hooks';
import { update } from '../lib/repo';
import { toast } from '../lib/store';
import { RatingButtons } from './Revision';

function greeting(d: Date) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Home answers one question: what do I need to know right now? */
export function Dashboard() {
  const settings = useSettings();
  const today = useToday();
  const now = useNow();
  const subjects = useSubjectMap();
  const classes = useOccurrences(today, today) ?? [];
  const attendance = useAttendance();
  const tasks = useAll('task') ?? [];
  const revisions = useAll('revisionSchedule') ?? [];
  const topics = useAll('topic') ?? [];
  const sessions = useAll('studySession') ?? [];
  const events = useAll('calendarEvent') ?? [];
  const exams = useAll('exam') ?? [];
  const assignments = useAll('assignment') ?? [];
  const [rating, setRating] = useState<RevisionSchedule | null>(null);

  const activeClasses = classes.filter((c) => c.status !== 'cancelled' && c.status !== 'rescheduled');
  const minutesNow = nowMinutes(now);
  const nextClass = activeClasses.find((c) => timeToMinutes(c.endTime) > minutesNow);
  const nextSummary = nextClass && attendance?.subjects.find((s) => s.subject.id === nextClass.subjectId)?.summary;
  const inProgress = nextClass && timeToMinutes(nextClass.startTime) <= minutesNow;

  const openTasks = tasks.filter((t) => t.status !== 'done' && ((t.plannedDate && t.plannedDate <= today) || (t.dueDate && t.dueDate <= today)));
  const priorities = rankTasks(tasks, today).slice(0, 3);
  const dueRevisions = revisions.filter((r) => r.status === 'pending' && r.dueDate <= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdueRevisions = dueRevisions.filter((r) => r.dueDate < today).length;
  const topicTitle = (id: string) => topics.find((t) => t.id === id)?.title ?? 'Topic';

  const studyToday =
    sessions.filter((s) => s.date === today).reduce((a, s) => a + s.durationMinutes, 0) +
    events
      .filter((e) => e.date === today && e.type === 'study' && e.completedAt && e.startTime && e.endTime)
      .reduce((a, e) => a + (timeToMinutes(e.endTime!) - timeToMinutes(e.startTime!)), 0);

  const studyDates = [
    ...sessions.map((s) => s.date),
    ...revisions.filter((r) => r.completedAt).map((r) => r.completedAt!.slice(0, 10)),
    ...tasks.filter((t) => t.completedAt && t.category !== 'Personal').map((t) => t.completedAt!.slice(0, 10)),
  ];
  const streak = computeStreak(studyDates, today);

  const subjectAttendance = (attendance?.subjects ?? []).filter((s) => s.summary.conducted > 0 || s.summary.risk !== 'no_data');
  const unmarked = (attendance?.unmarked ?? []).filter((o) => o.date < today || timeToMinutes(o.endTime) <= minutesNow);
  const upcomingExams = exams.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  const dueSoon = assignments.filter((a) => a.status !== 'submitted' && diffDays(today, a.deadline) <= 7).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const firstName = settings.profile.name.split(' ')[0];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {greeting(now)}
          {firstName ? `, ${firstName}` : ''} 👋
        </h1>
        <p className="mt-1 text-sm text-ink-2">{dateLabel}</p>
      </div>

      <AskAI placeholder="Ask AI anything…" prompts={['What do I need to do today?', 'Plan my day', 'How is my attendance?']} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          {/* Next class */}
          <section className="relative overflow-hidden rounded-3xl bg-accent p-5 text-accent-ink shadow-pop sm:p-6">
            <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-white/10" />
            <div aria-hidden className="pointer-events-none absolute -bottom-20 right-20 size-40 rounded-full bg-white/5" />
            <div className="relative">
              <div className="text-xs font-semibold uppercase tracking-wider opacity-80">{inProgress ? 'Happening now' : 'Next class'}</div>
              {nextClass ? (
                <>
                  <div className="mt-2 text-2xl font-semibold tracking-tight">{subjects.get(nextClass.subjectId)?.name ?? 'Class'}</div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm opacity-90">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="size-4" /> {formatTime12(nextClass.startTime)} – {formatTime12(nextClass.endTime)}
                    </span>
                    {nextClass.room && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="size-4" /> Room {nextClass.room}
                      </span>
                    )}
                    {!inProgress && <span>in {formatMinutes(timeToMinutes(nextClass.startTime) - minutesNow)}</span>}
                  </div>
                  {nextSummary && nextSummary.conducted > 0 && (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm">
                      Attendance <strong className="tabular">{fmtPct(nextSummary.percent)}</strong>
                      {(nextSummary.risk === 'at_risk' || nextSummary.risk === 'below_min') && <AlertTriangle className="size-4" aria-label="Below target" />}
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-2 text-lg font-semibold">{classes.length ? 'No more classes today 🎉' : 'No classes today'}</div>
              )}
            </div>
          </section>

          {/* Today at a glance */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Classes" value={activeClasses.length} to="/calendar" />
            <Tile label="Tasks" value={openTasks.length} to="/todos" />
            <Tile label="Revisions" value={dueRevisions.length} to="/revision" warn={overdueRevisions > 0} />
            <Link to="/analytics" className="rounded-2xl border border-line bg-surface p-3.5 shadow-card transition-colors hover:bg-surface-2">
              <div className="text-xs font-medium text-ink-2">Study target</div>
              <div className="mt-1 text-xl font-semibold tracking-tight tabular">
                {formatMinutes(studyToday)}
                <span className="text-sm font-normal text-muted"> / {formatMinutes(settings.dailyStudyTargetMinutes)}</span>
              </div>
              <div className="mt-2">
                <Meter value={settings.dailyStudyTargetMinutes ? (studyToday / settings.dailyStudyTargetMinutes) * 100 : 0} color="var(--accent)" label="Study progress" />
              </div>
            </Link>
          </div>

          {unmarked.length > 0 && (
            <Card>
              <SectionTitle action={<span className="text-xs text-muted">{unmarked.length} to mark</span>}>Did you attend?</SectionTitle>
              <div className="divide-y divide-line">
                {unmarked
                  .slice(-5)
                  .reverse()
                  .map((o) => (
                    <div key={o.id}>
                      {o.date !== today && <div className="pt-2 text-[11px] text-muted">{o.date}</div>}
                      <ClassRow occ={o} subject={subjects.get(o.subjectId)} compact />
                    </div>
                  ))}
              </div>
              {unmarked.length > 5 && (
                <Link to="/attendance" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent">
                  Mark the rest <ArrowRight className="size-3.5" />
                </Link>
              )}
            </Card>
          )}

          <Card>
            <SectionTitle action={<Link to="/todos" className="text-xs font-medium text-accent">Open Todos</Link>}>Today's priorities</SectionTitle>
            {priorities.length === 0 && dueRevisions.length === 0 ? (
              <p className="text-sm text-ink-2">Nothing pending. Add a task with the + button, or ask AI to plan your day.</p>
            ) : (
              <ul className="divide-y divide-line">
                {priorities.map((t) => (
                  <li key={t.id} className="flex items-start gap-3 py-2.5">
                    <Checkbox
                      checked={false}
                      label={`Complete ${t.title}`}
                      onChange={() => {
                        void update('task', t.id, { status: 'done', completedAt: new Date().toISOString() });
                        toast(`Completed: ${t.title}`, 'success', { label: 'Undo', run: () => void update('task', t.id, { status: 'todo', completedAt: null }) });
                      }}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{t.title}</div>
                      <div className="text-xs text-muted">{t.priorityScore.reasons.slice(1, 3).join(' · ') || t.priorityScore.reasons[0]}</div>
                    </div>
                  </li>
                ))}
                {dueRevisions.slice(0, Math.max(0, 5 - priorities.length)).map((r) => (
                  <li key={r.id} className="flex items-start gap-3 py-2.5">
                    <Checkbox checked={false} label={`Revise ${topicTitle(r.topicId)}`} onChange={() => setRating(r)} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">Revise {topicTitle(r.topicId)}</div>
                      <div className={cn('text-xs', r.dueDate < today ? 'text-critical-ink' : 'text-muted')}>
                        {r.dueDate < today ? `${diffDays(r.dueDate, today)}d overdue` : 'Due today'} · revision {r.stage}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle action={<Link to="/calendar" className="text-xs font-medium text-accent">Calendar</Link>}>Today's classes</SectionTitle>
            {classes.length === 0 ? (
              <p className="text-sm text-ink-2">
                No classes today.{' '}
                <Link to="/classes" className="font-medium text-accent">
                  Edit timetable
                </Link>
              </p>
            ) : (
              <div className="divide-y divide-line">
                {classes.map((c) => (
                  <ClassRow key={c.id} occ={c} subject={subjects.get(c.subjectId)} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <SectionTitle action={<Link to="/attendance" className="text-xs font-medium text-accent">Details</Link>}>Attendance</SectionTitle>
            {attendance && attendance.overall.conducted > 0 && (
              <div className="mb-3 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight tabular">{fmtPct(attendance.overall.percent)}</span>
                <span className="text-sm text-ink-2">overall</span>
              </div>
            )}
            {subjectAttendance.length === 0 ? (
              <p className="text-sm text-ink-2">Mark your classes as present or absent and your attendance will show here.</p>
            ) : (
              <ul className="space-y-3">
                {subjectAttendance.map(({ subject, summary }) => {
                  const warn = summary.risk === 'at_risk' || summary.risk === 'below_min';
                  return (
                    <li key={subject.id}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <SubjectDot color={subject.color} />
                          <span className="truncate">{subject.name}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1 font-medium tabular">
                          {fmtPct(summary.percent)}
                          {warn && <AlertTriangle className="size-3.5" style={{ color: riskColor(summary.risk) }} aria-label="At risk" />}
                        </span>
                      </div>
                      <Meter value={summary.percent} color={riskColor(summary.risk)} marker={subject.minAttendance ?? settings.minAttendance} label={`${subject.name} attendance`} />
                      {warn && <p className="mt-1 text-xs text-ink-2">{summary.advice}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle>Revision</SectionTitle>
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <Repeat className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {dueRevisions.length} topic{dueRevisions.length === 1 ? '' : 's'} due today
                </div>
                <div className="text-xs text-muted">{overdueRevisions ? `${overdueRevisions} overdue` : 'Spaced repetition keeps it fresh'}</div>
              </div>
            </div>
            <Link to="/revision" className="mt-3 block">
              <Button variant={dueRevisions.length ? 'primary' : 'secondary'} className="w-full">
                {dueRevisions.length ? 'Start Revision' : 'Open Revision'}
              </Button>
            </Link>
          </Card>

          {(upcomingExams.length > 0 || dueSoon.length > 0) && (
            <Card>
              <SectionTitle action={<Link to="/deadlines" className="text-xs font-medium text-accent">All</Link>}>Coming up</SectionTitle>
              <ul className="space-y-2.5 text-sm">
                {upcomingExams.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <CalendarClock className="size-4 shrink-0 text-muted" /> <span className="truncate">{e.title}</span>
                    </span>
                    <span className="shrink-0 text-xs font-medium text-ink-2">{countdown(diffDays(today, e.date))}</span>
                  </li>
                ))}
                {dueSoon.slice(0, 3).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">📝 {a.title}</span>
                    <span className={cn('shrink-0 text-xs font-medium', a.deadline < today ? 'text-critical-ink' : 'text-ink-2')}>{countdown(diffDays(today, a.deadline))}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {streak > 0 && (
            <Card className="flex items-center gap-3">
              <Flame className="size-6" style={{ color: 'var(--color-serious)' }} />
              <div>
                <div className="font-semibold">{streak}-day study streak</div>
                <div className="text-xs text-muted">Keep the chain going</div>
              </div>
            </Card>
          )}
        </div>
      </div>

      <Modal open={!!rating} onClose={() => setRating(null)} title={`How well did you remember ${rating ? topicTitle(rating.topicId) : ''}?`}>
        <RatingButtons
          onRate={async (r: RecallRating) => {
            const msg = await completeRevision(rating!, r);
            toast(msg, 'success');
            setRating(null);
          }}
        />
      </Modal>
    </div>
  );
}

function Tile({ label, value, to, warn }: { label: string; value: number; to: string; warn?: boolean }) {
  return (
    <Link to={to} className="rounded-2xl border border-line bg-surface p-3.5 shadow-card transition-colors hover:bg-surface-2">
      <div className="flex items-center justify-between text-xs font-medium text-ink-2">
        {label}
        {warn && <AlertTriangle className="size-3.5" style={{ color: 'var(--color-warning)' }} aria-label="Some overdue" />}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular">{value}</div>
    </Link>
  );
}

export function countdown(days: number) {
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `${days} days`;
}
