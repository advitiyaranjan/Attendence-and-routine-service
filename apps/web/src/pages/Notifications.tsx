import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { BellOff, CheckCheck, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { formatTime12, NOTIFICATION_CATEGORY_LABEL, type NotificationAction, type NotificationActionId, type NotificationCategory } from '@student-os/core';
import { Badge, Button, Card, cn, EmptyState, PageHeader, Tabs } from '../components/ui';
import { db, type AppNotification } from '../lib/db';
import { deleteNotification, markAllRead, markRead, performNotificationAction } from '../lib/notifications';
import { upcoming } from '../lib/notify-core';

function group(iso: string) {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return 'Today';
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return 'Yesterday';
  return 'Earlier';
}

export function useUnreadCount() {
  return useLiveQuery(() => db.notifications.filter((n) => !n.readAt && n.status !== 'dismissed').count(), []) ?? 0;
}

export function NotificationRow({ n, onNavigate }: { n: AppNotification; onNavigate: (href: string) => void }) {
  const actions = ((n.data?.actions as NotificationAction[] | undefined) ?? []).filter((a) => a.action !== 'open' && a.action !== 'start');
  const stale = n.type === 'attendance_prompt' && n.readAt;
  return (
    <div className={cn('flex items-start gap-3 px-4 py-3', !n.readAt && 'bg-accent-soft/40')}>
      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-accent')} aria-label={n.readAt ? undefined : 'Unread'} />
      <button
        className="min-w-0 flex-1 text-left"
        onClick={() => {
          void markRead([n.id]);
          if (n.href) onNavigate(n.href);
        }}
      >
        <div className="text-sm font-medium">{n.title}</div>
        <div className="whitespace-pre-line text-xs text-ink-2">{n.body}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
          {new Date(n.deliveredAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          <span>· {NOTIFICATION_CATEGORY_LABEL[n.category as NotificationCategory] ?? n.category}</span>
          {n.channel === 'push' && <span>· push</span>}
        </div>
        {actions.length > 0 && !stale && (
          <div className="mt-2 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
            {actions.map((a) => (
              <Button
                key={a.action}
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const href = await performNotificationAction(a.action as NotificationActionId, { ...n, ...(n.data ?? {}), id: n.id } as never);
                  if (href) onNavigate(href);
                }}
              >
                {a.title}
              </Button>
            ))}
          </div>
        )}
      </button>
      <Button size="sm" variant="ghost" aria-label="Delete notification" onClick={() => void deleteNotification(n.id)}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

export default function Notifications() {
  const [tab, setTab] = useState<'history' | 'scheduled'>('history');
  const navigate = useNavigate();
  const items = useLiveQuery(() => db.notifications.orderBy('scheduledAt').reverse().filter((n) => n.status !== 'dismissed').limit(200).toArray(), []) ?? [];
  const scheduled = useLiveQuery(() => upcoming(24), [tab]) ?? [];
  const groups = ['Today', 'Yesterday', 'Earlier'].filter((g) => items.some((n) => group(n.deliveredAt) === g));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        actions={
          <>
            <Button size="sm" variant="secondary" icon={<CheckCheck className="size-4" />} onClick={() => void markAllRead()}>
              Mark all read
            </Button>
            <Button size="sm" variant="ghost" icon={<SettingsIcon className="size-4" />} onClick={() => navigate('/settings#notifications')}>
              Preferences
            </Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'history', label: 'History' },
          { value: 'scheduled', label: 'Next 24 hours' },
        ]}
      />
      {tab === 'history' &&
        (items.length === 0 ? (
          <EmptyState icon={<BellOff className="size-6" />} title="No notifications yet" body="Class reminders, attendance prompts, revisions and deadlines will appear here." />
        ) : (
          groups.map((g) => (
            <section key={g}>
              <h2 className="mb-2 text-sm font-semibold text-ink-2">{g}</h2>
              <Card className="divide-y divide-line overflow-hidden p-0">
                {items
                  .filter((n) => group(n.deliveredAt) === g)
                  .map((n) => (
                    <NotificationRow key={n.id} n={n} onNavigate={navigate} />
                  ))}
              </Card>
            </section>
          ))
        ))}
      {tab === 'scheduled' && (
        <Card className="divide-y divide-line p-0">
          {scheduled.length === 0 && <p className="p-4 text-sm text-ink-2">Nothing scheduled in the next 24 hours.</p>}
          {scheduled.map((n) => (
            <div key={n.id} className="flex items-start gap-3 px-4 py-2.5">
              <span className="w-20 shrink-0 text-xs text-ink-2 tabular">{formatTime12(n.time)}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm">{n.title}</div>
                <div className="truncate text-xs text-muted">{n.body.split('\n')[0]}</div>
              </div>
              <Badge>{NOTIFICATION_CATEGORY_LABEL[n.category]}</Badge>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
