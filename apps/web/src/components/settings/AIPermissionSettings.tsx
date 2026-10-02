import { PERMISSION_LABEL, type AIPermission, type AIPermissions, type Settings } from '@student-os/core';
import { saveSettings } from '../../lib/repo';
import { Toggle } from '../ui';

const GROUPS: Array<{ title: string; keys: AIPermission[]; note?: string }> = [
  { title: 'What AI Pilot can read', keys: ['readCalendar', 'readAttendance', 'readTasks', 'readRevision', 'readExams', 'readNotes'], note: 'Only the parts relevant to your request are sent, never your whole database.' },
  { title: 'What AI Pilot can propose to create', keys: ['createTasks', 'createEvents', 'createRevision', 'createExams', 'createReminders', 'createNotes'] },
  { title: 'What AI Pilot can propose to change', keys: ['modifyTasks', 'modifyEvents', 'modifyRevision', 'modifyAttendance', 'modifyClasses', 'modifyExams'] },
  { title: 'High-risk', keys: ['deleteData', 'bulkChanges'], note: 'Off by default. Even when on, every delete and bulk change shows exactly what is affected and needs confirmation.' },
];

export function AIPermissionSettings({ s }: { s: Settings }) {
  const p = s.aiPermissions;
  const save = (patch: Partial<AIPermissions>) => void saveSettings({ aiPermissions: { ...p, ...patch } });
  return (
    <div className="space-y-4">
      <Toggle checked={p.enabled} onChange={(v) => save({ enabled: v })} label="Enable AI Pilot" description="When off, no data is sent to the AI." />
      {p.enabled && (
        <>
          <p className="rounded-lg bg-surface-2 p-3 text-xs text-ink-2">
            AI Pilot never changes your data directly. It proposes actions; you see exactly what will change and confirm, edit or cancel. Every confirmed action is listed in AI activity and can be undone.
          </p>
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h3 className="text-sm font-medium">{g.title}</h3>
              {g.note && <p className="text-xs text-muted">{g.note}</p>}
              <div className="grid gap-x-6 sm:grid-cols-2">
                {g.keys.map((k) => (
                  <Toggle key={k} checked={p[k]} onChange={(v) => save({ [k]: v })} label={PERMISSION_LABEL[k]} />
                ))}
              </div>
            </div>
          ))}
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Toggle checked={p.shareName} onChange={(v) => save({ shareName: v })} label="Include my name" />
            <Toggle checked={p.instantReadOnly} onChange={(v) => save({ instantReadOnly: v })} label="Run read-only actions instantly" description="e.g. start a requested quiz without an extra tap." />
          </div>
        </>
      )}
    </div>
  );
}
