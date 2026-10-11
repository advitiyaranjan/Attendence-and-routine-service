/**
 * Offers to put back attendance marks that classes lost: the attendance history keeps every
 * mark ever made, so a class showing as unmarked with a mark in its history can be restored.
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { History } from 'lucide-react';
import { findLostMarks, restoreLostMarks } from '../lib/actions';
import { useSubjectMap, useToday } from '../lib/hooks';
import { toast } from '../lib/store';
import { Button, Card } from './ui';

const LABEL = { present: 'Present', absent: 'Absent', cancelled: 'Cancelled', rescheduled: 'Rescheduled', unsure: 'Unsure' } as const;

export function RestoreMarks() {
  const today = useToday();
  const subjects = useSubjectMap();
  const lost = useLiveQuery(() => findLostMarks(today), [today]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!lost?.length) return null;

  return (
    <Card className="border-warning/40 bg-warning/8">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/20 text-warning-ink">
          <History className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {lost.length} class{lost.length === 1 ? '' : 'es'} lost {lost.length === 1 ? 'its' : 'their'} attendance mark
          </div>
          <p className="mt-0.5 text-sm text-ink-2">Your attendance history still has them. Restore to put each mark back exactly as you made it.</p>
          {open && (
            <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto text-sm">
              {lost.map(({ occ, status }) => (
                <li key={occ.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface px-2.5 py-1.5">
                  <span className="min-w-0 truncate">
                    {subjects.get(occ.subjectId)?.name ?? 'Class'} · {new Date(`${occ.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} {occ.startTime}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-ink-2">{LABEL[status]}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const n = await restoreLostMarks(lost);
                  toast(`Restored ${n} attendance mark${n === 1 ? '' : 's'}`, 'success');
                } catch (e) {
                  console.error(e);
                  toast("Couldn't restore. Try again.", 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Restore {lost.length}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide list' : 'Show which'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
