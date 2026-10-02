import { addDays, computeStreak, eachDay, fmtPct, formatMinutes, longestStreak, startOfWeek, timeToMinutes, WEEKDAY_SHORT } from '@student-os/core';
import { Card, Meter, PageHeader, RiskPill, riskColor, SectionTitle, Stat, SubjectDot } from '../components/ui';
import { useAll, useAttendance, useSettings, useSubjectMap, useToday } from '../lib/hooks';

/** Sequential blue ramp (data-viz reference palette) for the activity heatmap, light → dark. */
const HEAT = ['var(--surface-2)', '#cde2fb', '#86b6ef', '#3987e5', '#1c5cab'];

/** Single-series vertical bar chart with hover tooltips and a table fallback. */
function BarChart({ data, format, label }: { data: Array<{ label: string; value: number; detail?: string }>; format: (v: number) => string; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure>
      <div className="flex h-40 items-end gap-2 border-b border-line" role="img" aria-label={label}>
        {data.map((d, i) => (
          <div key={i} className="group relative flex h-full flex-1 items-end justify-center">
            <div className="w-full max-w-8 rounded-t bg-[#2a78d6] dark:bg-[#3987e5]" style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 2 : 0 }} />
            <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-xs shadow group-hover:block">
              <div className="font-medium">{d.label}</div>
              <div className="text-ink-2">{d.detail ?? format(d.value)}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center text-[11px] text-muted">
            {d.label}
          </div>
        ))}
      </div>
      <details className="mt-2 text-xs text-ink-2">
        <summary className="cursor-pointer">Show as table</summary>
        <table className="mt-1 tabular">
          <tbody>
            {data.map((d, i) => (
              <tr key={i}>
                <td className="pr-4">{d.label}</td>
                <td>{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export default function Analytics() {
  const today = useToday();
  const settings = useSettings();
  const subjects = useSubjectMap();
  const att = useAttendance();
  const sessions = useAll('studySession') ?? [];
  const events = useAll('calendarEvent') ?? [];
  const tasks = useAll('task') ?? [];
  const revisions = useAll('revisionSchedule') ?? [];

  // Study minutes per day: logged sessions + completed timed study events.
  const studyByDay = new Map<string, number>();
  const studyBySubject = new Map<string, number>();
  const addStudy = (date: string, minutes: number, subjectId: string | null) => {
    studyByDay.set(date, (studyByDay.get(date) ?? 0) + minutes);
    const key = subjectId ?? '';
    studyBySubject.set(key, (studyBySubject.get(key) ?? 0) + minutes);
  };
  for (const s of sessions) addStudy(s.date, s.durationMinutes, s.subjectId);
  for (const e of events) {
    if (e.type === 'study' && e.completedAt && e.startTime && e.endTime) addStudy(e.date, timeToMinutes(e.endTime) - timeToMinutes(e.startTime), e.subjectId);
  }

  const last7 = eachDay(addDays(today, -6), today);
  const weekMinutes = last7.reduce((a, d) => a + (studyByDay.get(d) ?? 0), 0);
  const studyChart = last7.map((d) => ({
    label: WEEKDAY_SHORT[new Date(`${d}T12:00:00`).getDay()]!,
    value: (studyByDay.get(d) ?? 0) / 60,
    detail: `${d}: ${formatMinutes(studyByDay.get(d) ?? 0)}`,
  }));

  const completedByDay = new Map<string, number>();
  for (const t of tasks) if (t.completedAt) completedByDay.set(t.completedAt.slice(0, 10), (completedByDay.get(t.completedAt.slice(0, 10)) ?? 0) + 1);
  const taskChart = last7.map((d) => ({ label: WEEKDAY_SHORT[new Date(`${d}T12:00:00`).getDay()]!, value: completedByDay.get(d) ?? 0, detail: `${d}: ${completedByDay.get(d) ?? 0} completed` }));
  const doneThisWeek = taskChart.reduce((a, d) => a + d.value, 0);
  const dueThisWeek = tasks.filter((t) => t.dueDate && t.dueDate >= last7[0]! && t.dueDate <= today);
  const completionRate = dueThisWeek.length ? dueThisWeek.filter((t) => t.status === 'done').length / dueThisWeek.length : null;

  const due30 = revisions.filter((r) => r.dueDate >= addDays(today, -30) && r.dueDate <= today);
  const revisionRate = due30.length ? due30.filter((r) => r.status === 'done').length / due30.length : null;

  const revisionDates = revisions.filter((r) => r.completedAt).map((r) => r.completedAt!.slice(0, 10));
  const taskDates = [...completedByDay.keys()];
  const studyDates = [...studyByDay.keys(), ...revisionDates];

  // 12-week activity heatmap: study minutes + revisions + tasks.
  const start = startOfWeek(addDays(today, -7 * 11), settings.weekStartsOn);
  const activity = (d: string) => (studyByDay.get(d) ?? 0) / 30 + revisionDates.filter((x) => x === d).length + (completedByDay.get(d) ?? 0);
  const heatDays = eachDay(start, today);
  const maxAct = Math.max(1, ...heatDays.map(activity));
  const weeks: string[][] = [];
  for (let i = 0; i < heatDays.length; i += 7) weeks.push(heatDays.slice(i, i + 7));

  const subjectStudy = [...studyBySubject.entries()].filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1]);
  const maxSubject = Math.max(1, ...subjectStudy.map(([, m]) => m));

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" subtitle="Trends are estimates from what you've logged." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Overall attendance" value={fmtPct(att?.overall.percent ?? null)} sub={`${att?.overall.present ?? 0}/${att?.overall.conducted ?? 0} classes`} />
        <Stat label="Study this week" value={formatMinutes(weekMinutes)} sub={`target ${formatMinutes(settings.dailyStudyTargetMinutes * 7)}`} />
        <Stat label="Task completion (7d)" value={completionRate === null ? '—' : `${Math.round(completionRate * 100)}%`} sub={`${doneThisWeek} tasks completed`} />
        <Stat label="Revision completion (30d)" value={revisionRate === null ? '—' : `${Math.round(revisionRate * 100)}%`} sub={`${due30.length} revisions due`} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="🔥 Study streak" value={`${computeStreak(studyDates, today)}d`} sub={`best ${longestStreak(studyDates)}d`} />
        <Stat label="Revision streak" value={`${computeStreak(revisionDates, today)}d`} sub={`best ${longestStreak(revisionDates)}d`} />
        <Stat label="Task streak" value={`${computeStreak(taskDates, today)}d`} sub={`best ${longestStreak(taskDates)}d`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>Study hours, last 7 days</SectionTitle>
          <BarChart data={studyChart} format={(v) => `${v.toFixed(1)} h`} label="Study hours per day for the last 7 days" />
        </Card>
        <Card>
          <SectionTitle>Tasks completed, last 7 days</SectionTitle>
          <BarChart data={taskChart} format={(v) => `${v}`} label="Tasks completed per day for the last 7 days" />
        </Card>
      </div>

      <Card>
        <SectionTitle>Attendance by subject</SectionTitle>
        <div className="space-y-3">
          {(att?.subjects ?? []).map(({ subject, summary }) => (
            <div key={subject.id}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <SubjectDot color={subject.color} /> <span className="truncate">{subject.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="tabular">{fmtPct(summary.percent)}</span>
                  <RiskPill risk={summary.risk} />
                </span>
              </div>
              <Meter value={summary.percent} color={riskColor(summary.risk)} marker={subject.minAttendance ?? settings.minAttendance} label={`${subject.name} attendance`} />
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>Activity, last 12 weeks</SectionTitle>
          <div className="flex gap-1 overflow-x-auto" role="img" aria-label="Daily activity heatmap for the last 12 weeks">
            <div className="flex flex-col gap-1 pr-1 text-[10px] text-muted">
              {Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="h-3.5 leading-3.5">
                  {i % 2 === 0 ? WEEKDAY_SHORT[(i + settings.weekStartsOn) % 7] : ''}
                </div>
              ))}
            </div>
            {weeks.map((w, i) => (
              <div key={i} className="flex flex-col gap-1">
                {w.map((d) => {
                  const v = activity(d);
                  const step = v === 0 ? 0 : Math.min(4, 1 + Math.floor((v / maxAct) * 3.99));
                  return <div key={d} className="size-3.5 rounded-sm" style={{ background: HEAT[step] }} title={`${d}: ${formatMinutes(studyByDay.get(d) ?? 0)} study, ${completedByDay.get(d) ?? 0} tasks`} />;
                })}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] text-muted">
            Less
            {HEAT.map((c) => (
              <span key={c} className="size-3 rounded-sm" style={{ background: c }} />
            ))}
            More
          </div>
        </Card>

        <Card>
          <SectionTitle>Study time by subject</SectionTitle>
          {subjectStudy.length === 0 ? (
            <p className="text-sm text-ink-2">Log study time or complete study sessions to see this.</p>
          ) : (
            <ul className="space-y-2">
              {subjectStudy.map(([id, minutes]) => {
                const subject = subjects.get(id);
                return (
                  <li key={id || 'none'}>
                    <div className="mb-0.5 flex justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <SubjectDot color={subject?.color ?? 'var(--muted)'} /> {subject?.name ?? 'No subject'}
                      </span>
                      <span className="tabular text-ink-2">{formatMinutes(minutes)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-2">
                      <div className="h-full rounded-full" style={{ width: `${(minutes / maxSubject) * 100}%`, background: subject?.color ?? 'var(--muted)' }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
