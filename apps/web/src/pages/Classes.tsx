import { useState } from 'react';
import { Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { addDays, formatTime12, timeToMinutes, todayISO, WEEKDAYS, type ClassSchedule } from '@student-os/core';
import { ExtraClassForm, ScheduleForm } from '../components/forms';
import { TimetableImport } from '../components/TimetableImport';
import { Button, Card, EmptyState, Modal, PageHeader, SubjectDot } from '../components/ui';
import { useAll, useOccurrences, useSettings, useSubjectMap } from '../lib/hooks';
import { update } from '../lib/repo';
import { toast } from '../lib/store';

export default function Classes() {
  const settings = useSettings();
  const subjects = useSubjectMap();
  const schedules = (useAll('classSchedule') ?? []).filter((s) => s.active && (!s.validUntil || s.validUntil >= todayISO()));
  const [editing, setEditing] = useState<ClassSchedule | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [extra, setExtra] = useState(false);
  const upcoming = (useOccurrences(todayISO(), addDays(todayISO(), 30)) ?? []).filter((o) => o.isExtra || o.status === 'cancelled' || o.status === 'rescheduled');

  const days = [...settings.workingDays, ...new Set(schedules.map((s) => s.weekday))]
    .filter((d, i, a) => a.indexOf(d) === i)
    .sort((a, b) => ((a - settings.weekStartsOn + 7) % 7) - ((b - settings.weekStartsOn + 7) % 7));

  async function endSlot(s: ClassSchedule) {
    if (!confirm('Remove this weekly class from today onwards? Past attendance is kept.')) return;
    await update('classSchedule', s.id, { validUntil: addDays(todayISO(), -1) });
    toast('Class removed from your timetable', 'info', {
      label: 'Undo',
      run: () => void update('classSchedule', s.id, { validUntil: s.validUntil }),
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Timetable"
        subtitle={`${schedules.length} weekly classes${settings.semesterEnd ? ` · semester ends ${settings.semesterEnd}` : ''}`}
        actions={
          <>
            <Button variant="secondary" icon={<Sparkles className="size-4" />} onClick={() => setImporting(true)}>
              Import timetable
            </Button>
            <Button variant="secondary" onClick={() => setExtra(true)}>
              Extra class
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Weekly class
            </Button>
          </>
        }
      />

      {schedules.length === 0 ? (
        <EmptyState
          title="No timetable yet"
          body="Upload a photo, PDF, Excel or CSV of your timetable and AI will set up your weekly classes."
          action={
            <Button variant="primary" onClick={() => setImporting(true)}>
              Import timetable
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {days.map((d) => {
            const list = schedules.filter((s) => s.weekday === d).sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
            return (
              <Card key={d}>
                <h3 className="mb-2 text-sm font-semibold capitalize">{WEEKDAYS[d]}</h3>
                {list.length === 0 && <p className="text-sm text-muted">No classes</p>}
                <ul className="space-y-1">
                  {list.map((s) => {
                    const subject = subjects.get(s.subjectId);
                    return (
                      <li key={s.id} className="group flex items-center gap-2 text-sm">
                        <span className="w-20 shrink-0 text-xs text-ink-2 tabular">{formatTime12(s.startTime)}</span>
                        <SubjectDot color={subject?.color ?? '#888'} />
                        <span className="min-w-0 flex-1 truncate">
                          {subject?.name}
                          {s.type !== 'lecture' && <span className="ml-1 text-xs capitalize text-muted">({s.type})</span>}
                          {s.room && <span className="ml-1 text-xs text-muted">· {s.room}</span>}
                        </span>
                        <button className="text-muted hover:text-ink" aria-label={`Edit ${subject?.name}`} onClick={() => setEditing(s)}>
                          <Pencil className="size-3.5" />
                        </button>
                        <button className="text-muted hover:text-ink" aria-label={`Remove ${subject?.name}`} onClick={() => void endSlot(s)}>
                          <Trash2 className="size-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {upcoming.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-semibold">Changes in the next 30 days</h3>
          <ul className="space-y-1 text-sm">
            {upcoming.map((o) => (
              <li key={o.id} className="flex gap-2">
                <span className="w-24 shrink-0 text-xs text-ink-2">{o.date}</span>
                <span>
                  {subjects.get(o.subjectId)?.name} {formatTime12(o.startTime)} —{' '}
                  {o.status === 'cancelled' ? 'cancelled' : o.status === 'rescheduled' ? 'moved' : o.rescheduledFromId ? 'rescheduled class' : 'extra class'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New weekly class' : 'Edit weekly class'}>
        {editing && <ScheduleForm initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Modal open={extra} onClose={() => setExtra(false)} title="Extra class">
        <ExtraClassForm onDone={() => setExtra(false)} />
      </Modal>
      <Modal open={importing} onClose={() => setImporting(false)} title="Import timetable" wide>
        {importing && <TimetableImport mode="replace" onDone={() => setImporting(false)} />}
      </Modal>
    </div>
  );
}
