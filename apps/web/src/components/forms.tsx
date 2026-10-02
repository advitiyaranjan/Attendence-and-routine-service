/** Create/edit forms used by the quick-add menu and the individual pages. */
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  addDays,
  formatMinutes,
  initialRevisions,
  todayISO,
  WEEKDAYS,
  type Assignment,
  type CalendarEvent,
  type ClassSchedule,
  type Exam,
  type Subject,
  type Task,
} from '@student-os/core';
import { addExtraClass, learnTopic, nextSubjectColor, SUBJECT_COLORS } from '../lib/actions';
import { useAll, useSettings } from '../lib/hooks';
import { create, update } from '../lib/repo';
import { toast } from '../lib/store';
import { Button, Field, Input, Select, Textarea } from './ui';

function FormShell({ onSubmit, children, submitLabel, onCancel, disabled }: { onSubmit: () => Promise<void>; children: ReactNode; submitLabel: string; onCancel: () => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function handle(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit();
    } catch (err) {
      console.error(err);
      toast("Couldn't save. Check the fields and try again.", 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={handle} className="space-y-3">
      {children}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={disabled}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function SubjectSelect({ value, onChange, allowNone = true }: { value: string | null; onChange: (v: string | null) => void; allowNone?: boolean }) {
  const subjects = useAll('subject') ?? [];
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowNone && <option value="">No subject</option>}
      {subjects
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
    </Select>
  );
}

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export function TaskForm({ initial, onDone, defaultDate }: { initial?: Task; onDone: () => void; defaultDate?: string }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'Study');
  const [priority, setPriority] = useState<Task['priority']>(initial?.priority ?? 'medium');
  const [importance, setImportance] = useState(initial?.importance ?? 3);
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(initial?.dueTime ?? '');
  const [plannedDate, setPlannedDate] = useState(initial?.plannedDate ?? defaultDate ?? todayISO());
  const [estimate, setEstimate] = useState(initial?.estimatedMinutes?.toString() ?? '');
  const [subjectId, setSubjectId] = useState<string | null>(initial?.subjectId ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [dependsOn, setDependsOn] = useState<string[]>(initial?.dependsOn ?? []);
  const tasks = (useAll('task') ?? []).filter((t) => t.id !== initial?.id && t.status !== 'done');

  return (
    <FormShell
      submitLabel={initial ? 'Save' : 'Add task'}
      onCancel={onDone}
      disabled={!title.trim()}
      onSubmit={async () => {
        const data = {
          title: title.trim(),
          category: category.trim() || 'General',
          priority,
          importance,
          dueDate: dueDate || null,
          dueTime: dueDate && dueTime ? dueTime : null,
          plannedDate: plannedDate || null,
          estimatedMinutes: estimate ? Number(estimate) : null,
          subjectId,
          notes: notes || null,
          dependsOn,
        };
        if (initial) await update('task', initial.id, data);
        else await create('task', data);
        toast(initial ? 'Task updated' : 'Task added', 'success');
        onDone();
      }}
    >
      <Field label="Task">
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Complete DBMS assignment" required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Planned for">
          <Input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
        </Field>
        <Field label="Deadline">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        {dueDate && (
          <Field label="Due at (optional)" hint="Used for the deadline reminder" className="col-span-2">
            <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          </Field>
        )}
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as Task['priority'])}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0]!.toUpperCase() + p.slice(1)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Importance">
          <Select value={importance} onChange={(e) => setImportance(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? '(low)' : n === 5 ? '(critical)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estimated minutes">
          <Input type="number" min={0} step={15} value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="60" />
        </Field>
        <Field label="Category">
          <Input value={category} onChange={(e) => setCategory(e.target.value)} list="task-categories" />
          <datalist id="task-categories">
            {['Study', 'DSA', 'Assignment', 'Revision', 'Exam Prep', 'Personal', 'Health'].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
      </div>
      <Field label="Subject">
        <SubjectSelect value={subjectId} onChange={setSubjectId} />
      </Field>
      {tasks.length > 0 && (
        <Field label="Depends on" hint="This task is ranked lower until these are done.">
          <Select
            multiple
            value={dependsOn}
            onChange={(e) => setDependsOn([...e.target.selectedOptions].map((o) => o.value))}
            className="h-24 py-1"
          >
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </FormShell>
  );
}

export function TopicForm({ onDone, defaultSubjectId }: { onDone: () => void; defaultSubjectId?: string | null }) {
  const settings = useSettings();
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState<string | null>(defaultSubjectId ?? null);
  const [learnedOn, setLearnedOn] = useState(todayISO());
  const [parentId, setParentId] = useState<string | null>(null);
  const topics = (useAll('topic') ?? []).filter((t) => !subjectId || t.subjectId === subjectId);
  const preview = learnedOn ? initialRevisions(learnedOn, settings.revisionIntervals) : [];
  return (
    <FormShell
      submitLabel="Add topic"
      onCancel={onDone}
      disabled={!title.trim()}
      onSubmit={async () => {
        await learnTopic({ title: title.trim(), subjectId, learnedOn, parentId });
        toast(`"${title.trim()}" added — ${preview.length} revisions scheduled`, 'success');
        onDone();
      }}
    >
      <Field label="What did you learn?">
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Binary Search Trees" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Subject">
          <SubjectSelect value={subjectId} onChange={setSubjectId} />
        </Field>
        <Field label="Learned on">
          <Input type="date" value={learnedOn} max={todayISO()} onChange={(e) => setLearnedOn(e.target.value)} />
        </Field>
      </div>
      {topics.length > 0 && (
        <Field label="Part of (optional)" hint="Builds the Subject → Chapter → Topic tree.">
          <Select value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)}>
            <option value="">Top level</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {preview.length > 0 && (
        <div className="rounded-lg bg-surface-2 p-3 text-xs text-ink-2">
          <div className="mb-1 font-medium text-ink">Revision schedule</div>
          {preview.map((p) => `R${p.stage}: ${p.dueDate}`).join(' · ')}
        </div>
      )}
    </FormShell>
  );
}

const EXAM_KINDS: Array<[Exam['kind'], string]> = [
  ['midsem', 'Mid-semester'],
  ['endsem', 'End-semester'],
  ['quiz', 'Quiz'],
  ['viva', 'Viva'],
  ['practical', 'Practical'],
  ['project', 'Project'],
  ['other', 'Other'],
];

export function ExamForm({ initial, onDone }: { initial?: Exam; onDone: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [kind, setKind] = useState<Exam['kind']>(initial?.kind ?? 'midsem');
  const [subjectId, setSubjectId] = useState<string | null>(initial?.subjectId ?? null);
  const [date, setDate] = useState(initial?.date ?? addDays(todayISO(), 14));
  const [startTime, setStartTime] = useState(initial?.startTime ?? '');
  const [room, setRoom] = useState(initial?.room ?? '');
  const [topics, setTopics] = useState(initial?.topics ?? '');
  return (
    <FormShell
      submitLabel={initial ? 'Save' : 'Add exam'}
      onCancel={onDone}
      disabled={!title.trim() || !date}
      onSubmit={async () => {
        const data = { title: title.trim(), kind, subjectId, date, startTime: startTime || null, room: room || null, topics: topics || null };
        if (initial) await update('exam', initial.id, data);
        else await create('exam', data);
        toast(initial ? 'Exam updated' : 'Exam added', 'success');
        onDone();
      }}
    >
      <Field label="Exam">
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. DBMS Mid-Sem" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Exam['kind'])}>
            {EXAM_KINDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Subject">
          <SubjectSelect value={subjectId} onChange={setSubjectId} />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Time">
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </Field>
      </div>
      <Field label="Room">
        <Input value={room} onChange={(e) => setRoom(e.target.value)} />
      </Field>
      <Field label="Syllabus / topics" hint="Used by the AI exam planner.">
        <Textarea value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="Normalization, Transactions, Indexing…" />
      </Field>
    </FormShell>
  );
}

export function AssignmentForm({ initial, onDone }: { initial?: Assignment; onDone: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [subjectId, setSubjectId] = useState<string | null>(initial?.subjectId ?? null);
  const [deadline, setDeadline] = useState(initial?.deadline ?? addDays(todayISO(), 7));
  const [deadlineTime, setDeadlineTime] = useState(initial?.deadlineTime ?? '');
  const [priority, setPriority] = useState<Assignment['priority']>(initial?.priority ?? 'medium');
  const [estimate, setEstimate] = useState(initial?.estimatedMinutes?.toString() ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  return (
    <FormShell
      submitLabel={initial ? 'Save' : 'Add assignment'}
      onCancel={onDone}
      disabled={!title.trim() || !deadline}
      onSubmit={async () => {
        const data = { title: title.trim(), subjectId, deadline, deadlineTime: deadlineTime || null, priority, estimatedMinutes: estimate ? Number(estimate) : null, description: description || null };
        if (initial) await update('assignment', initial.id, data);
        else await create('assignment', data);
        toast(initial ? 'Assignment updated' : 'Assignment added', 'success');
        onDone();
      }}
    >
      <Field label="Assignment">
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Subject">
          <SubjectSelect value={subjectId} onChange={setSubjectId} />
        </Field>
        <Field label="Deadline">
          <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </Field>
        <Field label="Due time (optional)">
          <Input type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} />
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as Assignment['priority'])}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estimated minutes" hint={estimate ? formatMinutes(Number(estimate)) : undefined}>
          <Input type="number" min={0} step={15} value={estimate} onChange={(e) => setEstimate(e.target.value)} />
        </Field>
      </div>
      <Field label="Description">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </FormShell>
  );
}

export function EventForm({ initial, onDone, defaultType = 'study', defaultDate }: { initial?: CalendarEvent; onDone: () => void; defaultType?: CalendarEvent['type']; defaultDate?: string }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [type, setType] = useState<CalendarEvent['type']>(initial?.type ?? defaultType);
  const [date, setDate] = useState(initial?.date ?? defaultDate ?? todayISO());
  const [startTime, setStartTime] = useState(initial?.startTime ?? '');
  const [endTime, setEndTime] = useState(initial?.endTime ?? '');
  const [subjectId, setSubjectId] = useState<string | null>(initial?.subjectId ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  return (
    <FormShell
      submitLabel={initial ? 'Save' : 'Add'}
      onCancel={onDone}
      disabled={!title.trim() || !date || (!!startTime && !!endTime && endTime <= startTime)}
      onSubmit={async () => {
        const data = { title: title.trim(), type, date, startTime: startTime || null, endTime: endTime || null, subjectId, notes: notes || null };
        if (initial) await update('calendarEvent', initial.id, data);
        else await create('calendarEvent', data);
        toast('Saved to calendar', 'success');
        onDone();
      }}
    >
      <Field label="Title">
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === 'study' ? 'e.g. OS revision — scheduling' : ''} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as CalendarEvent['type'])}>
            <option value="study">Study session</option>
            <option value="personal">Personal</option>
            <option value="event">Event</option>
            <option value="reminder">Reminder</option>
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Start">
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </Field>
        <Field label="End">
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </Field>
      </div>
      <Field label="Subject">
        <SubjectSelect value={subjectId} onChange={setSubjectId} />
      </Field>
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </FormShell>
  );
}

export function StudyLogForm({ onDone }: { onDone: () => void }) {
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [minutes, setMinutes] = useState('60');
  const [notes, setNotes] = useState('');
  return (
    <FormShell
      submitLabel="Log study time"
      onCancel={onDone}
      disabled={!Number(minutes)}
      onSubmit={async () => {
        await create('studySession', { subjectId, date, durationMinutes: Number(minutes), notes: notes || null });
        toast(`Logged ${formatMinutes(Number(minutes))}`, 'success');
        onDone();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Subject">
          <SubjectSelect value={subjectId} onChange={setSubjectId} />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Minutes studied">
        <Input type="number" min={1} max={1440} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </Field>
      <Field label="What did you work on?">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </FormShell>
  );
}

export function ExtraClassForm({ onDone }: { onDone: () => void }) {
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('11:00');
  const [room, setRoom] = useState('');
  return (
    <FormShell
      submitLabel="Add class"
      onCancel={onDone}
      disabled={!subjectId || start >= end}
      onSubmit={async () => {
        await addExtraClass(subjectId!, date, start, end, room || null);
        toast('Extra class added', 'success');
        onDone();
      }}
    >
      <p className="text-sm text-ink-2">A one-off or makeup class. For weekly classes, edit your timetable instead.</p>
      <Field label="Subject">
        <SubjectSelect value={subjectId} onChange={setSubjectId} allowNone={false} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Start">
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End">
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <Field label="Room">
        <Input value={room} onChange={(e) => setRoom(e.target.value)} />
      </Field>
    </FormShell>
  );
}

export function SubjectForm({ initial, onDone }: { initial?: Subject; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [faculty, setFaculty] = useState(initial?.faculty ?? '');
  const [credits, setCredits] = useState(initial?.credits?.toString() ?? '');
  const [color, setColor] = useState(initial?.color ?? '');
  const [minAttendance, setMin] = useState(initial?.minAttendance?.toString() ?? '');
  const [targetAttendance, setTarget] = useState(initial?.targetAttendance?.toString() ?? '');
  return (
    <FormShell
      submitLabel={initial ? 'Save' : 'Add subject'}
      onCancel={onDone}
      disabled={!name.trim()}
      onSubmit={async () => {
        const data = {
          name: name.trim(),
          code: code || null,
          faculty: faculty || null,
          credits: credits ? Number(credits) : null,
          color: color || (await nextSubjectColor()),
          minAttendance: minAttendance ? Number(minAttendance) : null,
          targetAttendance: targetAttendance ? Number(targetAttendance) : null,
        };
        if (initial) await update('subject', initial.id, data);
        else await create('subject', data);
        toast(initial ? 'Subject updated' : 'Subject added', 'success');
        onDone();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Database Management Systems" />
        </Field>
        <Field label="Code">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CS301" />
        </Field>
        <Field label="Credits">
          <Input type="number" min={0} value={credits} onChange={(e) => setCredits(e.target.value)} />
        </Field>
        <Field label="Faculty" className="col-span-2">
          <Input value={faculty} onChange={(e) => setFaculty(e.target.value)} />
        </Field>
        <Field label="Minimum attendance %" hint="Blank = your global setting">
          <Input type="number" min={0} max={100} value={minAttendance} onChange={(e) => setMin(e.target.value)} />
        </Field>
        <Field label="Target attendance %">
          <Input type="number" min={0} max={100} value={targetAttendance} onChange={(e) => setTarget(e.target.value)} />
        </Field>
      </div>
      <Field label="Colour" group>
        <div className="flex gap-2">
          {SUBJECT_COLORS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              className="size-7 rounded-full ring-offset-2 ring-offset-surface aria-pressed:ring-2 aria-pressed:ring-ink"
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>
    </FormShell>
  );
}

export function ScheduleForm({ initial, onDone }: { initial?: ClassSchedule; onDone: () => void }) {
  const [subjectId, setSubjectId] = useState<string | null>(initial?.subjectId ?? null);
  const [weekday, setWeekday] = useState(initial?.weekday ?? 1);
  const [startTime, setStart] = useState(initial?.startTime ?? '09:00');
  const [endTime, setEnd] = useState(initial?.endTime ?? '10:00');
  const [room, setRoom] = useState(initial?.room ?? '');
  const [type, setType] = useState<ClassSchedule['type']>(initial?.type ?? 'lecture');
  return (
    <FormShell
      submitLabel={initial ? 'Save' : 'Add class'}
      onCancel={onDone}
      disabled={!subjectId || startTime >= endTime}
      onSubmit={async () => {
        const data = { subjectId: subjectId!, weekday, startTime, endTime, room: room || null, type };
        if (initial) await update('classSchedule', initial.id, data);
        else await create('classSchedule', data);
        toast('Timetable updated', 'success');
        onDone();
      }}
    >
      <Field label="Subject">
        <SubjectSelect value={subjectId} onChange={setSubjectId} allowNone={false} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Day">
          <Select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i} className="capitalize">
                {d[0]!.toUpperCase() + d.slice(1)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start">
          <Input type="time" value={startTime} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End">
          <Input type="time" value={endTime} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Room">
          <Input value={room} onChange={(e) => setRoom(e.target.value)} />
        </Field>
        <Field label="Type" className="col-span-2">
          <Select value={type} onChange={(e) => setType(e.target.value as ClassSchedule['type'])}>
            <option value="lecture">Lecture</option>
            <option value="lab">Lab</option>
            <option value="tutorial">Tutorial</option>
            <option value="other">Other</option>
          </Select>
        </Field>
      </div>
    </FormShell>
  );
}

export function NoteForm({ onDone }: { onDone: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState<string | null>(null);
  return (
    <FormShell
      submitLabel="Create note"
      onCancel={() => onDone('')}
      disabled={!title.trim()}
      onSubmit={async () => {
        const note = await create('note', { title: title.trim(), subjectId, body: '' });
        onDone(note.id);
      }}
    >
      <Field label="Title">
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Subject">
        <SubjectSelect value={subjectId} onChange={setSubjectId} />
      </Field>
    </FormShell>
  );
}
