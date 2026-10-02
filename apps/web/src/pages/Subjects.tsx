import { useState } from 'react';
import { Link } from 'react-router';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { fmtPct, type Subject } from '@student-os/core';
import { SubjectForm } from '../components/forms';
import { Button, Card, EmptyState, Meter, Modal, PageHeader, RiskPill, riskColor, SubjectDot } from '../components/ui';
import { useAll, useAttendance, useSettings } from '../lib/hooks';
import { remove } from '../lib/repo';
import { toast } from '../lib/store';

export default function Subjects() {
  const subjects = useAll('subject') ?? [];
  const att = useAttendance();
  const settings = useSettings();
  const topics = useAll('topic') ?? [];
  const tasks = useAll('task') ?? [];
  const exams = useAll('exam') ?? [];
  const assignments = useAll('assignment') ?? [];
  const notes = useAll('note') ?? [];
  const [editing, setEditing] = useState<Subject | 'new' | null>(null);

  async function del(s: Subject) {
    if (!confirm(`Delete ${s.name}? Its classes will stop appearing. This syncs to all your devices.`)) return;
    await remove('subject', s.id);
    toast(`${s.name} deleted`, 'info');
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Subjects"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Subject
          </Button>
        }
      />
      {subjects.length === 0 && <EmptyState title="No subjects yet" body="Subjects are created automatically when you import your timetable." />}
      <div className="grid gap-3 md:grid-cols-2">
        {subjects
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((s) => {
            const summary = att?.subjects.find((x) => x.subject.id === s.id)?.summary;
            const count = (list: Array<{ subjectId: string | null }>) => list.filter((x) => x.subjectId === s.id).length;
            return (
              <Card key={s.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <SubjectDot color={s.color} />
                      <span className="truncate font-medium">{s.name}</span>
                      {s.code && <span className="text-xs text-muted">{s.code}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-2">
                      {[s.faculty, s.credits ? `${s.credits} credits` : null].filter(Boolean).join(' · ') || '—'}
                    </div>
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
                    <Meter value={summary.percent} color={riskColor(summary.risk)} marker={s.minAttendance ?? settings.minAttendance} label={`${s.name} attendance`} />
                    <div className="mt-1 text-xs text-muted">
                      Requirement {s.minAttendance ?? settings.minAttendance}% · target {s.targetAttendance ?? settings.targetAttendance}%
                    </div>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                  <Link to="/revision" className="hover:text-ink">
                    {count(topics)} topics
                  </Link>
                  <Link to="/tasks" className="hover:text-ink">
                    {tasks.filter((t) => t.subjectId === s.id && t.status !== 'done').length} open tasks
                  </Link>
                  <Link to="/deadlines" className="hover:text-ink">
                    {count(exams)} exams · {count(assignments)} assignments
                  </Link>
                  <Link to="/notes" className="hover:text-ink">
                    {count(notes)} notes
                  </Link>
                </div>
              </Card>
            );
          })}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New subject' : 'Edit subject'}>
        {editing && <SubjectForm initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}
