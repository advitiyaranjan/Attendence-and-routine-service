import { useState } from 'react';
import { Check, CircleHelp, MoreHorizontal, RotateCcw, X, Ban, CalendarClock } from 'lucide-react';
import { formatTime12, nowMinutes, timeToMinutes, todayISO, type AttendanceStatus, type ClassOccurrence, type Subject } from '@student-os/core';
import { markAttendance, rescheduleClass } from '../lib/actions';
import { toast } from '../lib/store';
import { Badge, Button, cn, Field, Input, Modal, SubjectDot } from './ui';

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  cancelled: 'Cancelled',
  rescheduled: 'Rescheduled',
  unsure: 'Decide later',
};

export function StatusBadge({ status }: { status: AttendanceStatus | null }) {
  if (!status) return null;
  const icon =
    status === 'present' ? (
      <Check className="size-3" style={{ color: 'var(--color-good)' }} />
    ) : status === 'absent' ? (
      <X className="size-3" style={{ color: 'var(--color-critical)' }} />
    ) : status === 'cancelled' ? (
      <Ban className="size-3" />
    ) : status === 'rescheduled' ? (
      <CalendarClock className="size-3" />
    ) : (
      <CircleHelp className="size-3" />
    );
  return (
    <Badge>
      {icon}
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function ClassRow({ occ, subject, compact }: { occ: ClassOccurrence; subject: Subject | undefined; compact?: boolean }) {
  const [menu, setMenu] = useState(false);
  const [reschedule, setReschedule] = useState(false);
  const today = todayISO();
  const started = occ.date < today || (occ.date === today && nowMinutes() >= timeToMinutes(occ.startTime));
  const moved = occ.status === 'rescheduled';

  async function mark(status: AttendanceStatus | null) {
    const previous = occ.status;
    setMenu(false);
    await markAttendance(occ, status);
    if (status && status !== 'unsure') {
      toast(`${subject?.name ?? 'Class'}: ${STATUS_LABEL[status]}`, 'success', {
        label: 'Undo',
        run: () => void markAttendance({ ...occ, status }, previous),
      });
    }
  }

  return (
    <div className={cn('flex items-center gap-3 py-2', moved && 'opacity-60')}>
      <div className="w-16 shrink-0 text-xs text-ink-2 tabular">
        <div>{formatTime12(occ.startTime)}</div>
        {!compact && <div className="text-muted">{formatTime12(occ.endTime)}</div>}
      </div>
      <SubjectDot color={subject?.color ?? '#888'} />
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-sm font-medium', moved && 'line-through')}>{subject?.name ?? 'Unknown subject'}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {occ.room && <span>Room {occ.room}</span>}
          {occ.type !== 'lecture' && <span className="capitalize">{occ.type}</span>}
          {occ.rescheduledFromId && <span>Rescheduled class</span>}
          {occ.isExtra && !occ.rescheduledFromId && <span>Extra class</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {started && !moved && occ.status !== 'cancelled' && (occ.status === null || occ.status === 'unsure') ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => mark('present')} aria-label={`Mark ${subject?.name} present`} icon={<Check className="size-4" style={{ color: 'var(--color-good)' }} />}>
              <span className="hidden sm:inline">Present</span>
            </Button>
            <Button size="sm" variant="secondary" onClick={() => mark('absent')} aria-label={`Mark ${subject?.name} absent`} icon={<X className="size-4" style={{ color: 'var(--color-critical)' }} />}>
              <span className="hidden sm:inline">Absent</span>
            </Button>
          </>
        ) : (
          <StatusBadge status={occ.status} />
        )}
        <div className="relative">
          <Button size="sm" variant="ghost" onClick={() => setMenu((m) => !m)} aria-label="More attendance options" aria-expanded={menu}>
            <MoreHorizontal className="size-4" />
          </Button>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-line bg-surface py-1 text-sm shadow-lg">
                {started && (
                  <>
                    <MenuItem onClick={() => mark('present')}>✓ Present</MenuItem>
                    <MenuItem onClick={() => mark('absent')}>✕ Absent</MenuItem>
                  </>
                )}
                <MenuItem onClick={() => mark('cancelled')}>⚠ Cancelled</MenuItem>
                {!moved && (
                  <MenuItem
                    onClick={() => {
                      setMenu(false);
                      setReschedule(true);
                    }}
                  >
                    ↻ Rescheduled…
                  </MenuItem>
                )}
                <MenuItem onClick={() => mark('unsure')}>? Decide later</MenuItem>
                {occ.status && !moved && (
                  <MenuItem onClick={() => mark(null)}>
                    <RotateCcw className="mr-1 inline size-3" /> Clear
                  </MenuItem>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <RescheduleDialog occ={occ} open={reschedule} onClose={() => setReschedule(false)} subjectName={subject?.name ?? 'Class'} />
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="block w-full px-3 py-1.5 text-left hover:bg-surface-2">
      {children}
    </button>
  );
}

function RescheduleDialog({ occ, open, onClose, subjectName }: { occ: ClassOccurrence; open: boolean; onClose: () => void; subjectName: string }) {
  const [date, setDate] = useState(occ.date);
  const [start, setStart] = useState(occ.startTime);
  const [end, setEnd] = useState(occ.endTime);
  const [room, setRoom] = useState(occ.room ?? '');
  const valid = date && start && end && start < end;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reschedule ${subjectName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={async () => {
              await rescheduleClass(occ, date, start, end, room || null);
              toast(`${subjectName} moved to ${date} ${formatTime12(start)}`, 'success');
              onClose();
            }}
          >
            Move class
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-2">The original class won't count towards attendance; the new one will.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="New date" className="col-span-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Start">
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End">
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Room" className="col-span-2">
          <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  );
}
