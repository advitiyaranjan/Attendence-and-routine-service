/**
 * AI Pilot permissions, as an explicit tree: each area lists exactly what AI
 * Pilot may view or change, plus whether changes need a confirmation tap
 * ("Ask first") or apply straight away ("Full access"). AI Power sits apart:
 * only the student can change it, and the app refuses any AI attempt to.
 */
import { useState } from 'react';
import { Bell, BookOpen, CalendarDays, ChevronDown, ClipboardList, GraduationCap, ListChecks, Lock, NotebookPen, Repeat, Settings2, UserRound, type LucideIcon } from 'lucide-react';
import { PERMISSION_LABEL, type AIArea, type AIPermission, type AIPermissions, type Settings } from '@student-os/core';
import { saveSettings } from '../../lib/repo';
import { cn, Toggle } from '../ui';
import { Segmented, SettingBlock, SettingRow, SettingsGroup } from './SettingsUI';

interface AreaDef {
  area: AIArea;
  title: string;
  icon: LucideIcon;
  perms: AIPermission[];
}

export const AI_PERMISSION_TREE: AreaDef[] = [
  { area: 'profile', title: 'Profile', icon: UserRound, perms: ['readProfile', 'updateProfile'] },
  { area: 'tasks', title: 'Todos', icon: ListChecks, perms: ['readTasks', 'createTasks', 'modifyTasks', 'deleteTasks'] },
  { area: 'schedule', title: 'Schedule', icon: CalendarDays, perms: ['readCalendar', 'createEvents', 'modifyEvents', 'deleteEvents', 'modifyClasses', 'createReminders'] },
  { area: 'attendance', title: 'Attendance', icon: GraduationCap, perms: ['readAttendance', 'modifyAttendance'] },
  { area: 'learning', title: 'Revision & learning', icon: Repeat, perms: ['readRevision', 'createRevision', 'modifyRevision', 'deleteRevision'] },
  { area: 'exams', title: 'Exams & assignments', icon: ClipboardList, perms: ['readExams', 'createExams', 'modifyExams', 'deleteExams'] },
  { area: 'subjects', title: 'Subjects', icon: BookOpen, perms: ['manageSubjects', 'deleteSubjects'] },
  { area: 'notes', title: 'Notes', icon: NotebookPen, perms: ['readNotes', 'createNotes', 'deleteNotes'] },
  { area: 'settings', title: 'App settings', icon: Settings2, perms: ['readSettings', 'modifySettings'] },
  { area: 'notifications', title: 'Notifications', icon: Bell, perms: ['modifyNotifications'] },
];

const POWER_HELP: Record<Settings['aiPower'], string> = {
  low: 'Fastest and lightest. Shorter memory of the conversation.',
  balanced: 'The default: a fast, capable model.',
  high: 'Remembers more of the conversation.',
  maximum: 'Most capable model first and the longest memory. Can be slower.',
};

function AreaCard({ def, p, save }: { def: AreaDef; p: AIPermissions; save: (patch: Partial<AIPermissions>) => void }) {
  const [open, setOpen] = useState(false);
  const on = def.perms.filter((k) => p[k]).length;
  const Icon = def.icon;
  const level = p.access[def.area];
  const writes = def.perms.some((k) => !k.startsWith('read'));
  return (
    <div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">{def.title}</span>
          <span className="block truncate text-xs text-muted">
            {on === 0 ? 'No access' : `${on} of ${def.perms.length} allowed`}
            {on > 0 && writes ? ` · ${level === 'full' ? 'Full access' : 'Ask first'}` : ''}
          </span>
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-1 border-t border-line bg-surface-2/40 px-4 py-2">
          {writes && (
            <div className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-xs text-ink-2">When AI Pilot changes {def.title.toLowerCase()}</span>
              <Segmented
                label={`${def.title} access level`}
                value={level}
                onChange={(v) => save({ access: { ...p.access, [def.area]: v } })}
                options={[
                  { value: 'ask', label: 'Ask first' },
                  { value: 'full', label: 'Full access' },
                ]}
              />
            </div>
          )}
          {def.perms.map((k) => (
            <Toggle key={k} checked={p[k]} onChange={(v) => save({ [k]: v })} label={PERMISSION_LABEL[k]} />
          ))}
        </div>
      )}
    </div>
  );
}

export function AIPermissionSettings({ s }: { s: Settings }) {
  const p = s.aiPermissions;
  const save = (patch: Partial<AIPermissions>) => void saveSettings({ aiPermissions: { ...p, ...patch } });
  return (
    <div className="space-y-6">
      <SettingsGroup footer="Gemini is reached only through your server, and only the data allowed below is sent.">
        <SettingBlock>
          <Toggle checked={p.enabled} onChange={(v) => save({ enabled: v })} label="Enable AI Pilot" description="When off, no data is sent to the AI and it can't change anything." />
        </SettingBlock>
      </SettingsGroup>

      <SettingsGroup
        title="AI Power"
        footer={
          <span className="inline-flex items-start gap-1">
            <Lock className="mt-0.5 size-3 shrink-0" /> Only you can change this. AI Pilot is never allowed to, even with full access to settings.
          </span>
        }
      >
        <SettingRow label="How hard AI Pilot works" description={POWER_HELP[s.aiPower]} stacked>
          <Segmented
            label="AI Power"
            value={s.aiPower}
            onChange={(v) => void saveSettings({ aiPower: v })}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'high', label: 'High' },
              { value: 'maximum', label: 'Max' },
            ]}
          />
        </SettingRow>
      </SettingsGroup>

      {p.enabled && (
        <>
          <SettingsGroup
            title="What AI Pilot can access"
            footer="“Ask first” shows you every change to confirm. “Full access” applies creates and updates straight away — still listed in AI activity and undoable. Deletions and bulk changes always ask."
          >
            {AI_PERMISSION_TREE.map((def) => (
              <AreaCard key={def.area} def={def} p={p} save={save} />
            ))}
          </SettingsGroup>

          <SettingsGroup title="Safety">
            <SettingBlock>
              <Toggle checked={p.bulkChanges} onChange={(v) => save({ bulkChanges: v })} label={PERMISSION_LABEL.bulkChanges} description="e.g. move all of tomorrow's revisions. Always shows every affected item first." />
              <Toggle checked={p.instantReadOnly} onChange={(v) => save({ instantReadOnly: v })} label="Run read-only actions instantly" description="e.g. start a quiz you asked for without an extra tap." />
            </SettingBlock>
            <SettingRow label="AI Power & these permissions" description="User only — AI modification is never allowed.">
              <Lock className="size-4 text-muted" />
            </SettingRow>
          </SettingsGroup>
        </>
      )}
    </div>
  );
}
