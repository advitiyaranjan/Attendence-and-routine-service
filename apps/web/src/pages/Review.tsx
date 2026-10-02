import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Sparkles } from 'lucide-react';
import { addDays, eachDay, fmtPct, formatMinutes, timeToMinutes, type DailyReview } from '@student-os/core';
import { Button, Card, Field, PageHeader, SectionTitle, Stat, Tabs, Textarea } from '../components/ui';
import { review } from '../lib/ai';
import { errorMessage } from '../lib/api';
import { occurrencesBetween, useAll, useAttendance, useSettings, useSubjectMap, useToday } from '../lib/hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { create, update } from '../lib/repo';
import { toast, useApp } from '../lib/store';

function useDayStats(from: string, to: string) {
  const settings = useSettings();
  const subjects = useSubjectMap();
  const classes = useLiveQuery(() => occurrencesBetween(from, to, settings), [from, to, settings]) ?? [];
  const tasks = useAll('task') ?? [];
  const revisions = useAll('revisionSchedule') ?? [];
  const sessions = useAll('studySession') ?? [];
  const events = useAll('calendarEvent') ?? [];
  const topics = useAll('topic') ?? [];
  const inRange = (d?: string | null) => !!d && d >= from && d <= to;

  const held = classes.filter((c) => c.status !== 'cancelled' && c.status !== 'rescheduled');
  const present = held.filter((c) => c.status === 'present').length;
  const absent = held.filter((c) => c.status === 'absent').length;
  const plannedTasks = tasks.filter((t) => inRange(t.plannedDate ?? t.dueDate) || inRange(t.completedAt?.slice(0, 10)));
  const completed = plannedTasks.filter((t) => t.status === 'done' && inRange(t.completedAt?.slice(0, 10)));
  const missed = plannedTasks.filter((t) => t.status !== 'done');
  const studyMinutes =
    sessions.filter((s) => inRange(s.date)).reduce((a, s) => a + s.durationMinutes, 0) +
    events.filter((e) => e.type === 'study' && e.completedAt && inRange(e.date) && e.startTime && e.endTime).reduce((a, e) => a + timeToMinutes(e.endTime!) - timeToMinutes(e.startTime!), 0);
  const revDue = revisions.filter((r) => inRange(r.dueDate) || (r.status === 'done' && inRange(r.completedAt?.slice(0, 10))));
  const revDone = revDue.filter((r) => r.status === 'done');
  const subjectsStudied = [
    ...new Set([
      ...sessions.filter((s) => inRange(s.date) && s.subjectId).map((s) => subjects.get(s.subjectId!)?.name),
      ...revDone.map((r) => subjects.get(r.subjectId ?? '')?.name),
    ]),
  ].filter(Boolean) as string[];
  const weakTopics = topics.filter((t) => t.ease < 0.9).map((t) => t.title).slice(0, 8);
  return { classes: held.length, present, absent, completed, missed, plannedTasks, studyMinutes, revDue, revDone, subjectsStudied, weakTopics };
}

export default function Review() {
  const [tab, setTab] = useState<'daily' | 'weekly'>('daily');
  return (
    <div className="space-y-5">
      <PageHeader title="Review" subtitle="Look back, carry forward, and adjust." />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'daily', label: 'Daily review' },
          { value: 'weekly', label: 'Weekly review' },
        ]}
      />
      {tab === 'daily' ? <Daily /> : <Weekly />}
    </div>
  );
}

function AISummary({ period, data, onSummary, initial }: { period: 'daily' | 'weekly'; data: unknown; onSummary?: (s: string) => void; initial?: string | null }) {
  const [summary, setSummary] = useState<string | null>(initial ?? null);
  const [extra, setExtra] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const online = useApp((s) => s.online);
  useEffect(() => {
    setSummary(initial ?? null);
  }, [initial]);
  return (
    <Card>
      <SectionTitle
        action={
          <Button size="sm" variant="secondary" loading={busy} disabled={!online} icon={<Sparkles className="size-4" />}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await review(period, data);
                setSummary(r.summary);
                setExtra(r.suggestions);
                onSummary?.(r.summary);
              } catch (err) {
                toast(errorMessage(err), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {summary ? 'Regenerate' : 'Summarise with AI'}
          </Button>
        }
      >
        AI summary
      </SectionTitle>
      {summary ? (
        <div className="prose-sm text-sm">
          <ReactMarkdown>{summary}</ReactMarkdown>
          {extra.length > 0 && (
            <ul>
              {extra.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-2">{online ? 'Generate a short summary of your day from the numbers above.' : 'AI requires an internet connection.'}</p>
      )}
    </Card>
  );
}

function Daily() {
  const today = useToday();
  const stats = useDayStats(today, today);
  const reviews = useAll('dailyReview') ?? [];
  const existing = reviews.find((r) => r.date === today);
  const [form, setForm] = useState({ wentWell: '', notCompleted: '', carryForward: '' });
  useEffect(() => {
    if (existing) setForm({ wentWell: existing.wentWell ?? '', notCompleted: existing.notCompleted ?? '', carryForward: existing.carryForward ?? '' });
  }, [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function persist(patch: Partial<DailyReview>) {
    if (existing) await update('dailyReview', existing.id, patch);
    else await create('dailyReview', { date: today, ...form, ...patch });
  }

  async function carryForward() {
    const tomorrow = addDays(today, 1);
    for (const t of stats.missed) await update('task', t.id, { plannedDate: tomorrow });
    toast(`Moved ${stats.missed.length} task(s) to tomorrow`, 'success');
  }

  const data = {
    date: today,
    attendance: { classes: stats.classes, present: stats.present, absent: stats.absent },
    tasks: { completed: stats.completed.map((t) => t.title), notCompleted: stats.missed.map((t) => t.title) },
    studyMinutes: stats.studyMinutes,
    revisions: { due: stats.revDue.length, completed: stats.revDone.length },
    reflection: form,
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Attendance" value={`${stats.present}/${stats.classes}`} sub={`${stats.absent} absent`} />
        <Stat label="Tasks" value={`${stats.completed.length}/${stats.plannedTasks.length}`} sub="completed" />
        <Stat label="Study" value={formatMinutes(stats.studyMinutes)} />
        <Stat label="Revision" value={`${stats.revDone.length}/${stats.revDue.length}`} sub="completed" />
      </div>

      {stats.missed.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm">
            <strong>{stats.missed.length}</strong> unfinished: {stats.missed.slice(0, 3).map((t) => t.title).join(', ')}
            {stats.missed.length > 3 ? '…' : ''}
          </div>
          <Button size="sm" variant="secondary" onClick={carryForward}>
            Carry forward to tomorrow
          </Button>
        </Card>
      )}

      <Card className="space-y-3">
        <SectionTitle>Reflection</SectionTitle>
        {(
          [
            ['wentWell', 'What went well today?'],
            ['notCompleted', 'What did you not complete, and why?'],
            ['carryForward', 'What should be carried forward?'],
          ] as const
        ).map(([k, label]) => (
          <Field key={k} label={label}>
            <Textarea value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} onBlur={() => void persist({ [k]: form[k] || null })} />
          </Field>
        ))}
      </Card>

      <AISummary period="daily" data={data} initial={existing?.aiSummary} onSummary={(s) => void persist({ aiSummary: s })} />
    </div>
  );
}

function Weekly() {
  const today = useToday();
  const from = addDays(today, -6);
  const stats = useDayStats(from, today);
  const att = useAttendance();
  const exams = useAll('exam') ?? [];
  const assignments = useAll('assignment') ?? [];
  const upcoming = [
    ...exams.filter((e) => e.date > today && e.date <= addDays(today, 14)).map((e) => `${e.title} (${e.date})`),
    ...assignments.filter((a) => a.status !== 'submitted' && a.deadline > today && a.deadline <= addDays(today, 14)).map((a) => `${a.title} (${a.deadline})`),
  ];
  const strong = (att?.subjects ?? []).filter((s) => s.summary.risk === 'safe').map((s) => s.subject.name);
  const atRisk = (att?.subjects ?? []).filter((s) => s.summary.risk === 'below_min' || s.summary.risk === 'at_risk');

  const data = {
    period: `${from} to ${today}`,
    days: eachDay(from, today).length,
    attendance: {
      thisWeek: { present: stats.present, absent: stats.absent, classes: stats.classes },
      overallPercent: att?.overall.percent ?? null,
      atRiskSubjects: atRisk.map((s) => ({ subject: s.subject.name, percent: s.summary.percent })),
    },
    studyMinutes: stats.studyMinutes,
    tasks: { completed: stats.completed.length, missed: stats.missed.map((t) => t.title) },
    revision: { due: stats.revDue.length, completed: stats.revDone.length },
    subjectsStudied: stats.subjectsStudied,
    weakTopics: stats.weakTopics,
    upcomingDeadlines: upcoming,
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Attendance this week" value={stats.classes ? fmtPct((stats.present / Math.max(1, stats.present + stats.absent)) * 100) : '—'} sub={`${stats.present} present · ${stats.absent} absent`} />
        <Stat label="Study hours" value={formatMinutes(stats.studyMinutes)} />
        <Stat label="Tasks completed" value={stats.completed.length} sub={`${stats.missed.length} missed`} />
        <Stat label="Revision" value={stats.revDue.length ? `${Math.round((stats.revDone.length / stats.revDue.length) * 100)}%` : '—'} sub={`${stats.revDone.length}/${stats.revDue.length}`} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>Subjects studied</SectionTitle>
          <p className="text-sm">{stats.subjectsStudied.join(', ') || 'None logged'}</p>
        </Card>
        <Card>
          <SectionTitle>Upcoming deadlines (14 days)</SectionTitle>
          <p className="text-sm">{upcoming.join(', ') || 'None'}</p>
        </Card>
        <Card>
          <SectionTitle>Weak areas</SectionTitle>
          <p className="text-sm">
            {[...atRisk.map((s) => `${s.subject.name} attendance (${fmtPct(s.summary.percent)})`), ...stats.weakTopics].join(', ') || 'Nothing flagged'}
          </p>
        </Card>
        <Card>
          <SectionTitle>Strong areas</SectionTitle>
          <p className="text-sm">{strong.length ? `Safe attendance in ${strong.join(', ')}` : 'Keep building — not enough data yet.'}</p>
        </Card>
      </div>
      {stats.missed.length > 0 && (
        <Card>
          <SectionTitle>Missed tasks</SectionTitle>
          <ul className="list-disc pl-5 text-sm">
            {stats.missed.slice(0, 10).map((t) => (
              <li key={t.id}>{t.title}</li>
            ))}
          </ul>
        </Card>
      )}
      <AISummary period="weekly" data={data} />
    </div>
  );
}
