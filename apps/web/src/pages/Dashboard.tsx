import { Link } from 'react-router';
import { AlertTriangle, ArrowRight, CalendarClock, Flame, Repeat } from 'lucide-react';
import {
  computeStreak,
  diffDays,
  fmtPct,
  formatMinutes,
  formatTime12,
  nowMinutes,
  rankTasks,
  timeToMinutes,
} from '@student-os/core';
import { ClassRow } from '../components/ClassRow';
import { Card, Checkbox, EmptyState, Meter, RiskPill, SectionTitle, Stat, SubjectDot, riskColor } from '../components/ui';
import { useAll, useAttendance, useNow, useOccurrences, useSettings, useSubjectMap, useToday } from '../lib/hooks';
import { update } from '../lib/repo';

function greeting(d: Date) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
  const settings = useSettings();
  const today = useToday();
  const now = useNow();
  const subjects = useSubjectMap();
  const classes = useOccurrences(today, today) ?? [];
  const attendance = useAttendance();
  const tasks = useAll('task') ?? [];
  const revisions = useAll('revisionSchedule') ?? [];
  const sessions = useAll('studySession') ?? [];
  const events = useAll('calendarEvent') ?? [];
  const exams = useAll('exam') ?? [];
  const assignments = useAll('assignment') ?? [];

  const activeClasses = classes.filter((c) => c.status !== 'cancelled' && c.status !== 'rescheduled');
  const minutesNow = nowMinutes(now);
  const nextClass = activeClasses.find((c) => timeToMinutes(c.endTime) > minutesNow);
  const nextSummary = nextClass && attendance?.subjects.find((s) => s.subject.id === nextClass.subjectId)?.summary;

  const todayTasks = tasks.filter((t) => t.status !== 'done' && ((t.plannedDate && t.plannedDate <= today) || (t.dueDate && t.dueDate <= today)));
  const doneToday = tasks.filter((t) => t.completedAt?.slice(0, 10) === today).length;
  const priorities = rankTasks(tasks, today).slice(0, 3);
  const dueRevisions = revisions.filter((r) => r.status === 'pending' && r.dueDate <= today);
  const overdueRevisions = dueRevisions.filter((r) => r.dueDate < today).length;

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

  const risky = (attendance?.subjects ?? []).filter((s) => s.summary.risk === 'below_min' || s.summary.risk === 'at_risk');
  const unmarked = (attendance?.unmarked ?? []).filter((o) => o.date < today || timeToMinutes(o.endTime) <= minutesNow);
  const upcomingExams = exams.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  const dueSoon = assignments.filter((a) => a.status !== 'submitted' && diffDays(today, a.deadline) <= 7).sort((a, b) => a.deadline.localeCompare(b.deadline));

  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting(now)}
          {settings.profile.name ? `, ${settings.profile.name.split(' ')[0]}` : ''} 👋
        </h1>
        <p className="text-sm text-ink-2">{dateLabel}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Classes today" value={activeClasses.length} sub={nextClass ? `Next ${formatTime12(nextClass.startTime)}` : 'Done for today'} />
        <Stat label="Tasks" value={todayTasks.length} sub={`${doneToday} completed today`} />
        <Stat label="Revisions due" value={dueRevisions.length} sub={overdueRevisions ? `${overdueRevisions} overdue` : 'On schedule'} />
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="text-xs text-ink-2">Today's study</div>
          <div className="mt-1 text-2xl font-semibold">{formatMinutes(studyToday)}</div>
          <div className="mt-1.5">
            <Meter value={settings.dailyStudyTargetMinutes ? (studyToday / settings.dailyStudyTargetMinutes) * 100 : 0} color="var(--accent)" label="Study progress" />
          </div>
          <div className="mt-1 text-xs text-muted">of {formatMinutes(settings.dailyStudyTargetMinutes)} target</div>
        </div>
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
            <Link to="/attendance" className="mt-2 inline-flex items-center gap-1 text-sm text-accent">
              Mark the rest <ArrowRight className="size-3.5" />
            </Link>
          )}
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>Next class</SectionTitle>
          {nextClass ? (
            <div>
              <div className="flex items-center gap-2">
                <SubjectDot color={subjects.get(nextClass.subjectId)?.color ?? '#888'} />
                <span className="text-lg font-semibold">{subjects.get(nextClass.subjectId)?.name}</span>
              </div>
              <div className="mt-1 text-sm text-ink-2">
                {formatTime12(nextClass.startTime)} – {formatTime12(nextClass.endTime)}
                {nextClass.room && ` · Room ${nextClass.room}`}
                {timeToMinutes(nextClass.startTime) > minutesNow && ` · in ${formatMinutes(timeToMinutes(nextClass.startTime) - minutesNow)}`}
              </div>
              {nextSummary && (
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span>
                    Attendance <strong>{fmtPct(nextSummary.percent)}</strong>
                  </span>
                  <RiskPill risk={nextSummary.risk} />
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-2">{classes.length ? 'No more classes today.' : 'No classes today.'}</p>
          )}
        </Card>

        <Card>
          <SectionTitle action={<Link to="/tasks" className="text-xs text-accent">All tasks</Link>}>Today's priorities</SectionTitle>
          {priorities.length === 0 ? (
            <p className="text-sm text-ink-2">Nothing pending. Add a task with the + button.</p>
          ) : (
            <ol className="space-y-2">
              {priorities.map((t, i) => (
                <li key={t.id} className="flex items-start gap-2">
                  <Checkbox
                    checked={false}
                    label={`Complete ${t.title}`}
                    onChange={() => void update('task', t.id, { status: 'done', completedAt: new Date().toISOString() })}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {i + 1}. {t.title}
                    </div>
                    <div className="text-xs text-muted">{t.priorityScore.reasons.slice(1, 3).join(' · ') || t.priorityScore.reasons[0]}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {risky.length > 0 && (
        <Card>
          <SectionTitle action={<Link to="/attendance" className="text-xs text-accent">Attendance</Link>}>Attendance alerts</SectionTitle>
          <div className="space-y-3">
            {risky.map(({ subject, summary }) => (
              <div key={subject.id}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="size-4" style={{ color: riskColor(summary.risk) }} aria-hidden />
                    {subject.name}
                  </span>
                  <span className="tabular">
                    {fmtPct(summary.percent)} <span className="text-muted">/ min {subject.minAttendance ?? settings.minAttendance}%</span>
                  </span>
                </div>
                <p className="ml-6 text-xs text-ink-2">{summary.advice}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <SectionTitle action={<Link to="/today" className="text-xs text-accent">Today's plan</Link>}>Today's classes</SectionTitle>
          {classes.length === 0 ? (
            <EmptyState
              title="No classes today"
              body={<Link to="/classes" className="text-accent">Set up or edit your timetable</Link>}
            />
          ) : (
            <div className="divide-y divide-line">
              {classes.map((c) => (
                <ClassRow key={c.id} occ={c} subject={subjects.get(c.subjectId)} />
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <SectionTitle>Revision</SectionTitle>
            <Link to="/revision" className="flex items-center gap-3">
              <Repeat className="size-5 text-accent" />
              <div>
                <div className="font-medium">
                  {dueRevisions.length} revision{dueRevisions.length === 1 ? '' : 's'} due
                </div>
                <div className="text-xs text-muted">{overdueRevisions ? `${overdueRevisions} overdue` : 'Spaced repetition keeps it fresh'}</div>
              </div>
            </Link>
          </Card>

          {streak > 0 && (
            <Card className="flex items-center gap-3">
              <Flame className="size-5" style={{ color: 'var(--color-serious)' }} />
              <div>
                <div className="font-medium">{streak}-day study streak</div>
                <div className="text-xs text-muted">Keep the chain going</div>
              </div>
            </Card>
          )}

          {(upcomingExams.length > 0 || dueSoon.length > 0) && (
            <Card>
              <SectionTitle action={<Link to="/deadlines" className="text-xs text-accent">All</Link>}>Coming up</SectionTitle>
              <ul className="space-y-2 text-sm">
                {upcomingExams.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 truncate">
                      <CalendarClock className="size-4 shrink-0 text-muted" /> {e.title}
                    </span>
                    <span className="shrink-0 text-xs text-ink-2">{countdown(diffDays(today, e.date))}</span>
                  </li>
                ))}
                {dueSoon.slice(0, 3).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">📝 {a.title}</span>
                    <span className="shrink-0 text-xs text-ink-2">{countdown(diffDays(today, a.deadline))}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {attendance && attendance.overall.conducted > 0 && (
        <Card>
          <SectionTitle action={<Link to="/attendance" className="text-xs text-accent">Details</Link>}>Overall attendance</SectionTitle>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold">{fmtPct(attendance.overall.percent)}</span>
            <span className="text-sm text-ink-2">
              {attendance.overall.present}/{attendance.overall.conducted} classes
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}

export function countdown(days: number) {
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `${days} days`;
}
