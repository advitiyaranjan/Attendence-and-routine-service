import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, CircleSlash, TriangleAlert, Undo2 } from 'lucide-react';
import type { AIActionLog } from '@student-os/core';
import { Badge, Button, Card, EmptyState, PageHeader } from '../components/ui';
import { undoLog } from '../lib/copilot/run';
import { useAll } from '../lib/hooks';
import { toast } from '../lib/store';

const STATUS: Record<AIActionLog['status'], { label: string; Icon: typeof CheckCircle2; color: string }> = {
  confirmed: { label: 'Confirmed by you', Icon: CheckCircle2, color: 'var(--color-good)' },
  cancelled: { label: 'Cancelled', Icon: CircleSlash, color: 'var(--muted)' },
  undone: { label: 'Undone', Icon: Undo2, color: 'var(--muted)' },
  failed: { label: 'Failed — nothing changed', Icon: TriangleAlert, color: 'var(--color-critical)' },
};

function dayGroup(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Everything the AI changed (or proposed and you cancelled), with undo. */
export default function AIActivity() {
  const logs = (useAll('aiActionLog') ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [open, setOpen] = useState<string | null>(null);
  const groups = [...new Set(logs.map((l) => dayGroup(l.createdAt)))];

  return (
    <div className="space-y-5">
      <PageHeader title="AI activity" subtitle="Every change AI Pilot proposed, what you decided, and exactly what was modified." />
      {logs.length === 0 && <EmptyState title="No AI activity yet" body="When you confirm something AI Pilot proposes, it appears here and can be undone." />}
      {groups.map((g) => (
        <section key={g}>
          <h2 className="mb-2 text-sm font-semibold text-ink-2">{g}</h2>
          <Card className="divide-y divide-line p-0">
            {logs
              .filter((l) => dayGroup(l.createdAt) === g)
              .map((l) => {
                const s = STATUS[l.status];
                const expanded = open === l.id;
                return (
                  <div key={l.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <span className="w-14 shrink-0 pt-0.5 text-xs text-muted tabular">{new Date(l.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                      <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(expanded ? null : l.id)} aria-expanded={expanded}>
                        <div className="flex items-center gap-1 text-sm font-medium">
                          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} {l.summary}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-ink-2">
                          <s.Icon className="size-3.5" style={{ color: s.color }} /> {s.label}
                          {l.changes.length > 0 && <Badge className="ml-1">{l.changes.length} record change{l.changes.length === 1 ? '' : 's'}</Badge>}
                        </div>
                      </button>
                      {l.status === 'confirmed' && l.changes.length > 0 && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Undo2 className="size-3.5" />}
                          onClick={async () => {
                            if (!confirm(`Undo "${l.summary}"?`)) return;
                            const r = await undoLog(l.id);
                            toast(r.skipped.length ? `Undone. ${r.skipped.length} record(s) changed since were kept.` : 'Undone', 'success');
                          }}
                        >
                          Undo
                        </Button>
                      )}
                    </div>
                    {expanded && (
                      <div className="ml-17 mt-2 space-y-2 pl-14 text-xs text-ink-2">
                        {l.details.length > 0 && (
                          <ul className="space-y-0.5">
                            {l.details.map((d, i) => (
                              <li key={i}>{d}</li>
                            ))}
                          </ul>
                        )}
                        {l.changes.length > 0 && (
                          <div>
                            <div className="font-medium text-ink">Changes</div>
                            <ul>
                              {l.changes.map((c, i) => (
                                <li key={i}>
                                  {c.op === 'create' ? 'Created' : c.op === 'update' ? 'Updated' : 'Deleted'} {c.entity}
                                  {typeof (c.after ?? c.before)?.title === 'string' ? `: ${(c.after ?? c.before)!.title as string}` : ''}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {l.undoneAt && <div>Undone {new Date(l.undoneAt).toLocaleString()}</div>}
                        {l.error && <div className="text-critical-ink">{l.error}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
          </Card>
        </section>
      ))}
    </div>
  );
}
