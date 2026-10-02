import { useState } from 'react';
import { Link } from 'react-router';
import { Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { fmtPct, type Basket, type Subject } from '@student-os/core';
import { SubjectForm } from '../components/forms';
import { Button, Card, EmptyState, Meter, Modal, PageHeader, RiskPill, riskColor, SubjectDot } from '../components/ui';
import { useAll, useAttendance, useSettings, useToday } from '../lib/hooks';
import { remove, sortBaskets } from '../lib/repo';
import { toast } from '../lib/store';

export default function Subjects() {
  const subjects = useAll('subject') ?? [];
  const baskets = sortBaskets(useAll('basket') ?? []);
  const att = useAttendance();
  const topics = useAll('topic') ?? [];
  const tasks = useAll('task') ?? [];
  const exams = useAll('exam') ?? [];
  const assignments = useAll('assignment') ?? [];
  const notes = useAll('note') ?? [];
  const revisions = useAll('revisionSchedule') ?? [];
  const today = useToday();
  const [editing, setEditing] = useState<Subject | { basketId: string | null } | null>(null);
  // One section per basket, in basket order. Subjects without one are only seen until they're assigned on the next sync.
  const groups: Array<{ basket: Basket | null; subjects: Subject[] }> = [
    ...baskets.map((basket) => ({ basket, subjects: subjects.filter((s) => s.basketId === basket.id) })),
    { basket: null, subjects: subjects.filter((s) => !baskets.some((b) => b.id === s.basketId)) },
  ].filter((g) => g.subjects.length > 0 || (g.basket && baskets.length > 0));

  async function del(s: Subject) {
    if (!confirm(`Delete ${s.name}? Its classes will stop appearing. This syncs to all your devices.`)) return;
    await remove('subject', s.id);
    toast(`${s.name} deleted`, 'info');
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Subjects"
        subtitle="Each subject's classes, attendance, topics, work and exams in one place."
        actions={
          <>
            <Link to="/settings/baskets">
              <Button variant="secondary" icon={<Settings2 className="size-4" />}>
                Baskets
              </Button>
            </Link>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({ basketId: null })}>
              Subject
            </Button>
          </>
        }
      />
      {subjects.length === 0 && <EmptyState title="No subjects yet" body="Subjects are created automatically when you import your timetable." />}
      {groups.map(({ basket, subjects: list }) => (
        <section key={basket?.id ?? 'none'} className="space-y-2">
          {baskets.length > 0 && (
            <div className="flex items-center justify-between gap-2 px-1">
              <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <span aria-hidden>{basket ? basket.icon : '🗂️'}</span>
                <span className="truncate">{basket ? basket.name : 'Not in a basket yet'}</span>
                <span className="font-normal text-muted">
                  {list.length}
                  {!basket && ' · being assigned'}
                </span>
              </h2>
              {basket && (
                <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setEditing({ basketId: basket.id })}>
                  Add
                </Button>
              )}
            </div>
          )}
          {list.length === 0 && <p className="px-1 text-sm text-muted">No subjects in this basket yet.</p>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {list
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((s) => {
                const sa = att?.subjects.find((x) => x.subject.id === s.id);
                const summary = sa?.summary;
                const count = (list: Array<{ subjectId: string | null }>) => list.filter((x) => x.subjectId === s.id).length;
                return (
                  <Card key={s.id}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <SubjectDot color={s.color} />
                          <span className="truncate font-medium">{s.name}</span>
                          {s.code && <span className="text-xs text-muted">{s.code}</span>}
                          {s.compulsory && <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">Compulsory</span>}
                        </div>
                        <div className="mt-0.5 text-xs text-ink-2">{[s.faculty, s.credits ? `${s.credits} credits` : null].filter(Boolean).join(' · ') || '—'}</div>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => void del(s)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                    {summary && (
                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span>
                            Attendance <strong className="tabular">{fmtPct(summary.percent)}</strong>{' '}
                            <span className="text-xs text-muted">
                              {summary.present}/{summary.conducted} · missed {summary.absent}
                            </span>
                          </span>
                          <RiskPill risk={summary.risk} />
                        </div>
                        <Meter value={summary.percent} color={riskColor(summary.risk)} marker={sa.thresholds.min} label={`${s.name} attendance`} />
                        <div className="mt-1 text-xs text-muted">
                          Requirement {sa.thresholds.min}% · target {sa.thresholds.target}%
                        </div>
                      </div>
                    )}
                    <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                      {[
                        { label: 'Classes', value: summary?.conducted ?? 0, to: '/attendance' },
                        { label: 'Present', value: summary?.present ?? 0, to: '/attendance' },
                        { label: 'Topics', value: count(topics), to: '/revision' },
                        { label: 'Revisions', value: revisions.filter((r) => r.subjectId === s.id && r.status === 'pending').length, to: '/revision' },
                        { label: 'Tasks', value: tasks.filter((t) => t.subjectId === s.id && t.status !== 'done').length, to: '/todos' },
                        { label: 'Assignments', value: assignments.filter((a) => a.subjectId === s.id && a.status !== 'submitted').length, to: '/deadlines' },
                        { label: 'Exams', value: count(exams), to: '/deadlines' },
                        { label: 'Notes', value: count(notes), to: '/notes' },
                      ].map((x) => (
                        <Link key={x.label} to={x.to} className="rounded-xl bg-surface-2 px-1 py-2 transition-colors hover:bg-accent-soft">
                          <div className="text-base font-semibold tabular">{x.value}</div>
                          <div className="truncate text-[11px] text-muted">{x.label}</div>
                        </Link>
                      ))}
                    </div>
                    {(() => {
                      const next = exams.filter((e) => e.subjectId === s.id && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
                      return next ? (
                        <p className="mt-3 text-xs text-ink-2">
                          Upcoming exam: <strong>{next.title}</strong> on {new Date(`${next.date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
                        </p>
                      ) : null;
                    })()}
                  </Card>
                );
              })}
          </div>
        </section>
      ))}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing && 'id' in editing ? 'Edit subject' : 'New subject'}>
        {editing && <SubjectForm initial={'id' in editing ? editing : undefined} defaultBasketId={editing.basketId} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}
