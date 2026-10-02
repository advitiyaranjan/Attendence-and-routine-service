import { useEffect, useState } from 'react';
import { BellRing, Plus, X } from 'lucide-react';
import { NOTIFICATION_CATEGORY_LABEL, WEEKDAYS, type NotificationCategory, type NotificationSettings as NS, type Settings } from '@student-os/core';
import { disablePush, enablePush, notificationsSupported, pushState, requestNotificationPermission, sendTestNotification, type PushState } from '../../lib/notifications';
import { exactAlarmStatus, nativePermission, openExactAlarmSettings, requestNativePermission, reschedule } from '../../lib/native';
import { isNative } from '../../lib/platform';
import { saveSettings } from '../../lib/repo';
import { useApp } from '../../lib/store';
import { Button, Input, Select, Toggle } from '../ui';

type Cat = NS['categories'][NotificationCategory];

/** How each category's timing is configured. */
const KIND: Record<NotificationCategory, { mode: 'before' | 'after' | 'time' | 'weekly' | 'margin' | 'none'; presets?: number[]; hint: string }> = {
  classes: { mode: 'before', presets: [5, 10, 15, 30, 60], hint: 'Before each class' },
  attendance: { mode: 'after', presets: [0, 5, 15, 30], hint: '“Did you attend?” after class ends' },
  revision: { mode: 'time', hint: 'On the day a revision is due' },
  tasks: { mode: 'before', presets: [0, 15, 60, 180, 1440], hint: 'Before a task deadline (tasks without a time use the default time)' },
  assignments: { mode: 'before', presets: [60, 1440, 3 * 1440, 7 * 1440], hint: 'Before an assignment deadline' },
  exams: { mode: 'before', presets: [60, 1440, 7 * 1440, 14 * 1440, 30 * 1440], hint: 'Before an exam' },
  studySessions: { mode: 'before', presets: [0, 5, 10, 15, 30], hint: 'Before a scheduled study session' },
  dailyReview: { mode: 'time', hint: 'Evening review prompt' },
  weeklyReview: { mode: 'weekly', hint: 'Weekly summary' },
  attendanceRisk: { mode: 'margin', hint: 'When you can miss this many classes or fewer' },
  reminders: { mode: 'none', hint: 'Your custom reminders and timed events' },
  aiSuggestions: { mode: 'time', hint: 'Morning “plan your day” suggestion' },
  sync: { mode: 'none', hint: 'When offline changes finish syncing' },
};

export function formatOffset(m: number) {
  if (m === 0) return 'At the time';
  if (m < 60) return `${m} min`;
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'}`;
  if (m % 60 === 0) return `${m / 60} h`;
  return `${m} min`;
}

function CategoryRow({ id, cat, onChange }: { id: NotificationCategory; cat: Cat; onChange: (c: Partial<Cat>) => void }) {
  const k = KIND[id];
  const [custom, setCustom] = useState('');
  const unit = id === 'assignments' || id === 'exams' ? 1440 : 1;
  return (
    <div className="border-t border-line py-3 first:border-0">
      <Toggle checked={cat.enabled} onChange={(v) => onChange({ enabled: v })} label={NOTIFICATION_CATEGORY_LABEL[id]} description={k.hint} />
      {cat.enabled && (k.mode === 'before' || k.mode === 'after') && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {cat.offsets.map((o) => (
            <span key={o} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-xs">
              {formatOffset(o)} {o > 0 && (k.mode === 'before' ? 'before' : 'after')}
              <button aria-label={`Remove ${formatOffset(o)}`} onClick={() => onChange({ offsets: cat.offsets.filter((x) => x !== o) })}>
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Select
            value=""
            onChange={(e) => {
              const v = Number(e.target.value);
              if (e.target.value !== '' && !cat.offsets.includes(v)) onChange({ offsets: [...cat.offsets, v].sort((a, b) => b - a).slice(0, 8) });
            }}
            className="h-7 w-auto py-0 text-xs"
            aria-label="Add reminder time"
          >
            <option value="">+ Add</option>
            {k.presets!.filter((p) => !cat.offsets.includes(p)).map((p) => (
              <option key={p} value={p}>
                {formatOffset(p)}
              </option>
            ))}
          </Select>
          <span className="inline-flex items-center gap-1">
            <Input type="number" min={0} placeholder={unit === 1440 ? 'days' : 'min'} value={custom} onChange={(e) => setCustom(e.target.value)} className="h-7 w-20 text-xs" aria-label="Custom reminder time" />
            <Button
              size="sm"
              variant="ghost"
              aria-label="Add custom time"
              disabled={!custom}
              onClick={() => {
                const v = Math.round(Number(custom) * unit);
                if (Number.isFinite(v) && v >= 0 && !cat.offsets.includes(v)) onChange({ offsets: [...cat.offsets, v].sort((a, b) => b - a).slice(0, 8) });
                setCustom('');
              }}
            >
              <Plus className="size-3.5" />
            </Button>
          </span>
        </div>
      )}
      {cat.enabled && (k.mode === 'time' || (k.mode === 'before' && (id === 'tasks' || id === 'assignments' || id === 'exams'))) && (
        <label className="mt-2 flex items-center gap-2 text-xs text-ink-2">
          {k.mode === 'time' ? 'At' : 'Default time when none is set'}
          <Input type="time" value={cat.time} onChange={(e) => e.target.value && onChange({ time: e.target.value })} className="h-8 w-32" />
        </label>
      )}
      {cat.enabled && k.mode === 'weekly' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-ink-2">
          Every
          <Select value={cat.weekday} onChange={(e) => onChange({ weekday: Number(e.target.value) })} className="h-8 w-36">
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d[0]!.toUpperCase() + d.slice(1)}
              </option>
            ))}
          </Select>
          at
          <Input type="time" value={cat.time} onChange={(e) => e.target.value && onChange({ time: e.target.value })} className="h-8 w-32" />
        </div>
      )}
      {cat.enabled && k.mode === 'margin' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-ink-2">
          Alert when I can miss
          <Input type="number" min={0} max={20} value={cat.margin} onChange={(e) => onChange({ margin: Math.max(0, Number(e.target.value)) })} className="h-8 w-16" />
          class(es) or fewer, from
          <Input type="time" value={cat.time} onChange={(e) => e.target.value && onChange({ time: e.target.value })} className="h-8 w-32" />
        </div>
      )}
    </div>
  );
}

const PUSH_TEXT: Record<PushState, string> = {
  native: 'Reminders are scheduled on this phone itself, so they arrive on time even when the app is closed, the phone is offline, or after a restart.',
  unsupported: "This browser doesn't support push. Reminders still work while the app is open.",
  'disabled-server': "Push isn't configured on the server yet (VAPID keys). Reminders still work while the app is open.",
  'signed-out': 'Sign in to get reminders when the app is closed and on your other devices.',
  'permission-needed': 'Allow notifications to get reminders on this device.',
  denied: 'Notifications are blocked in your browser settings for this site.',
  off: 'Push is off on this device — reminders only appear while the app is open.',
  on: 'Push is on — reminders arrive even when the app is closed.',
};

/** Android: notification permission + exact alarm permission (needed for on-time reminders). */
function NativeStatus() {
  const [perm, setPerm] = useState<string | null>(null);
  const [exact, setExact] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const refresh = async () => {
    setPerm(await nativePermission());
    setExact(await exactAlarmStatus());
    setCount(await reschedule());
  };
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, []);
  return (
    <div className="mt-2 space-y-2 text-xs">
      <div>
        Notifications: <strong>{perm === 'granted' ? 'allowed' : perm === 'denied' ? 'blocked' : 'not allowed yet'}</strong>
        {perm !== 'granted' && (
          <Button size="sm" variant="primary" className="ml-2" onClick={async () => { await requestNativePermission(); await refresh(); }}>
            Allow notifications
          </Button>
        )}
        {perm === 'denied' && <span className="ml-1 text-muted">Enable them in Android Settings → Apps → Student OS → Notifications.</span>}
      </div>
      <div>
        Exact timing (Alarms &amp; reminders): <strong>{exact === 'granted' ? 'allowed' : 'not allowed'}</strong>
        {exact !== 'granted' && (
          <Button size="sm" variant="secondary" className="ml-2" onClick={async () => { await openExactAlarmSettings(); await refresh(); }}>
            Allow exact alarms
          </Button>
        )}
        {exact !== 'granted' && <span className="block text-muted">Without it Android may deliver reminders several minutes late.</span>}
      </div>
      {count !== null && perm === 'granted' && <div className="text-muted">{count} reminder(s) scheduled for the next 3 days.</div>}
    </div>
  );
}

export function NotificationSettings({ s }: { s: Settings }) {
  const n = s.notifications;
  const user = useApp((x) => x.user);
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void pushState().then(setPush);
  }, [user]);
  const saveN = (patch: Partial<NS>) => void saveSettings({ notifications: { ...n, ...patch } });
  const saveCat = (id: NotificationCategory, patch: Partial<Cat>) => saveN({ categories: { ...n.categories, [id]: { ...n.categories[id], ...patch } } });

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-surface-2 p-3 text-sm">
        <div className="flex items-start gap-2">
          <BellRing className="mt-0.5 size-4 shrink-0 text-accent" />
          <p>{push ? PUSH_TEXT[push] : 'Checking…'}</p>
        </div>
        {isNative && <NativeStatus />}
        <div className="mt-2 flex flex-wrap gap-2">
          {(push === 'permission-needed' || push === 'off') && (
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                if (user) await enablePush();
                else await requestNotificationPermission();
                setPush(await pushState());
                setBusy(false);
              }}
            >
              {user ? 'Turn on push for this device' : 'Allow notifications'}
            </Button>
          )}
          {push === 'on' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await disablePush();
                setPush(await pushState());
              }}
            >
              Turn off push on this device
            </Button>
          )}
          {notificationsSupported() && (
            <Button size="sm" variant="secondary" onClick={() => void sendTestNotification()}>
              Send test notification
            </Button>
          )}
        </div>
        <p className={isNative ? 'hidden' : 'mt-2 text-xs text-muted'}>
          On iPhone/iPad, add Student OS to your Home Screen first (Share → Add to Home Screen) — iOS only delivers web notifications to installed apps.
        </p>
      </div>

      <div className="grid gap-x-6 sm:grid-cols-2">
        <Toggle checked={n.sound} onChange={(v) => saveN({ sound: v })} label="Notification sound" description="Volume and tone are controlled by your device." />
        <Toggle checked={n.vibration} onChange={(v) => saveN({ vibration: v })} label="Vibration" description="Where the device supports it." />
        <label className="block py-2 text-sm">
          Sound type
          <Select value={n.soundType} onChange={(e) => saveN({ soundType: e.target.value as NS['soundType'] })} className="mt-1">
            <option value="default">System default</option>
            <option value="chime">Chime while the app is open</option>
          </Select>
        </label>
      </div>

      <div>
        {(Object.keys(n.categories) as NotificationCategory[]).map((id) => (
          <CategoryRow key={id} id={id} cat={n.categories[id]} onChange={(p) => saveCat(id, p)} />
        ))}
      </div>
    </div>
  );
}
