/**
 * AI Pilot onboarding: a guided conversation that asks one thing at a time.
 *
 * The timetable is read by Gemini (via our server). Everything else is
 * understood locally by small deterministic parsers, so a typed "75%" or
 * "evening and night" can never be misread into a wrong setting. Nothing is
 * saved without the student's confirmation; settings are written on finish.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { Bot, Check, Loader2, Paperclip, Send, SlidersHorizontal } from 'lucide-react';
import { formatMinutes, initialRevisions, todayISO } from '@student-os/core';
import { blankRow, fromExtraction, parseTimetableCsv, saveTimetableRows, sortRows, TimetableImport, type ReviewRow } from '../../components/TimetableImport';
import { AppLogo, Button, Chip, cn, Input, Modal } from '../../components/ui';
import { extractTimetable } from '../../lib/ai';
import { errorMessage } from '../../lib/api';
import { useAll } from '../../lib/hooks';
import { notificationsSupported, requestNotificationPermission } from '../../lib/notifications';
import { useSetup, type PilotMessage } from '../../lib/setup';
import {
  currentAcademicYear,
  isSkip,
  parseFutureDate,
  parseIntervals,
  parseLeadMinutes,
  parsePercent,
  parseStudyTarget,
  parseStudyTimes,
  parseYesNo,
  STUDY_TIMES,
  type StudyTime,
} from '../../lib/setup-parse';
import { useApp } from '../../lib/store';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const RECOMMENDED = [1, 3, 7, 30, 90, 180];
const ORDER = ['schedule', 'confirm', 'min', 'target', 'name', 'semester', 'year', 'semesterEnd', 'notify', 'lead', 'permission', 'revision', 'intervals', 'times', 'hours', 'done'];

type Step = (typeof ORDER)[number] | 'analyzing';
interface Reply {
  label: string;
  /** Sent as the answer (defaults to the label). */
  value?: string;
  primary?: boolean;
  /** Runs instead of sending an answer. */
  run?: () => void;
}
interface Outcome {
  ack?: string;
  next?: Step;
  retry?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const prettyDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const listTimes = (t: StudyTime[]) => t.join(t.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1');

let nextId = Date.now();

export function PilotSetup() {
  const { pilot, setPilot, draft, patch, patchProfile, patchClassReminder, setMode, finish } = useSetup();
  const schedules = useAll('classSchedule') ?? [];
  const aiAvailable = useApp((s) => s.aiAvailable);
  const aiIssue = useApp((s) => s.aiIssue);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState('');
  const [dialog, setDialog] = useState<'edit' | 'manual' | null>(null);
  const [times, setTimes] = useState<StudyTime[]>(draft.studyTimes);
  const [finishing, setFinishing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const step = pilot.step as Step;

  const push = (m: Omit<PilotMessage, 'id'>) => setPilot((p) => ({ messages: [...p.messages, { ...m, id: ++nextId }] }));

  /** What the assistant says when a step starts. */
  function ask(s: Step): Omit<PilotMessage, 'id'> {
    const d = useSetup.getState().draft;
    const p = useSetup.getState().pilot;
    switch (s) {
      case 'schedule': {
        const first = p.messages.length === 0;
        const name = d.profile.name.split(' ')[0];
        const note = aiAvailable === false ? `\n\n_${aiIssue ?? 'AI is unavailable right now.'} You can still upload a CSV or enter your classes manually._` : '';
        if (first) {
          return {
            role: 'assistant',
            text:
              `Hi${name ? ` ${name}` : ''}! I'll help you set up your academic workspace.\n\nI'll need a few things, such as:\n\n` +
              `- Your class schedule\n- Attendance requirements\n- Subjects\n- Study preferences\n- Notification preferences\n\n` +
              `You can answer naturally, or tap a suggestion. Let's start.\n\n**Please send me your class schedule.** You can upload a PDF, image, screenshot or Excel file.` +
              note,
          };
        }
        return { role: 'assistant', text: `Send your timetable as a PDF, image, screenshot or Excel file, or enter your classes manually.${note}` };
      }
      case 'confirm':
        return {
          role: 'assistant',
          text: 'I found the following schedule.',
          schedule: p.rows ?? [],
          warnings: p.warnings,
        };
      case 'min':
        return {
          role: 'assistant',
          text: `${p.saved ? 'Great. Your schedule is ready.\n\n' : ''}**What minimum attendance percentage do you need to maintain?**\n\nExample: 75%`,
        };
      case 'target':
        return {
          role: 'assistant',
          text: `Got it. Minimum attendance: **${d.minAttendance}%**\n\nWould you also like to set a **personal target** attendance? For example, ${Math.min(100, d.minAttendance + 5)}% or ${Math.min(100, d.minAttendance + 10)}%.`,
        };
      case 'name':
        return { role: 'assistant', text: 'A few academic details now. Skip anything you prefer not to share.\n\n**What should I call you?**' };
      case 'semester':
        return { role: 'assistant', text: `${d.profile.name ? 'A few academic details now. Skip anything you prefer not to share.\n\n' : ''}**Which semester are you currently in?**` };
      case 'year':
        return { role: 'assistant', text: '**What academic year are you in?**' };
      case 'semesterEnd':
        return {
          role: 'assistant',
          text: "**When does your semester end?**\n\nI use it to count the classes left, so I can tell you how many you can safely miss.",
        };
      case 'notify':
        return {
          role: 'assistant',
          text: '**Would you like me to remind you about your classes and tasks?**\n\nFor example:\n\n- 15 minutes before class\n- When a revision is due\n- Before assignment deadlines\n- Before exams',
        };
      case 'lead':
        return { role: 'assistant', text: '**How early should I remind you before classes?**' };
      case 'permission':
        return {
          role: 'assistant',
          text: 'Now **allow notifications**, so reminders can reach you even when the app is in the background.',
        };
      case 'revision':
        return {
          role: 'assistant',
          text:
            '**I can schedule revisions automatically when you learn something new.**\n\nFor example: Day 1 · Day 3 · Day 7 · Day 30 · Day 90 · Day 180\n\n' +
            'They adapt to how well you remember each topic. Would you like to use this schedule?',
        };
      case 'intervals':
        return { role: 'assistant', text: 'Enter your revision intervals in days, separated by commas.\n\nExample: 1, 3, 7, 14, 30' };
      case 'times':
        return {
          role: 'assistant',
          text: '**When should I generally schedule your study sessions?**\n\nMorning, afternoon, evening or night. You can pick more than one.',
        };
      case 'hours':
        return { role: 'assistant', text: '**What is your usual daily study target?**\n\nExample: 3 hours' };
      case 'done': {
        const c = d.notifications.categories.classes;
        const checklist = [
          ...(p.saved ? [`${p.saved.subjects} subject${p.saved.subjects === 1 ? '' : 's'}`, `${p.saved.classes} weekly classes`] : []),
          `Attendance tracking (minimum ${d.minAttendance}%)`,
          `${d.targetAttendance}% personal attendance target`,
          ...(c.enabled && c.offsets[0] ? [`Class reminders, ${c.offsets[0]} min before`] : []),
          'Revision scheduling',
          `Daily study target: ${formatMinutes(d.dailyStudyTargetMinutes)}`,
          'Calendar',
          'Task management',
        ];
        return {
          role: 'assistant',
          text: `**Your academic workspace is ready. 🎉**\n\nI've configured:`,
          checklist,
        };
      }
      default:
        return { role: 'assistant', text: '' };
    }
  }

  async function go(next: Step, ack?: string) {
    setTyping(true);
    await sleep(350);
    if (ack) push({ role: 'assistant', text: ack });
    // Skip questions that don't apply.
    if (next === 'name' && useSetup.getState().draft.profile.name) next = 'semester';
    if (next === 'permission' && (!notificationsSupported() || (typeof Notification !== 'undefined' && Notification.permission === 'granted'))) {
      if (notificationsSupported()) push({ role: 'assistant', text: '✓ Notifications are already allowed on this device.' });
      next = 'revision';
    }
    setPilot({ step: next });
    push(ask(next));
    setTyping(false);
  }

  // Start the conversation (once, even when effects run twice in development).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (pilot.messages.length === 0) void go('schedule');
    // A reload during timetable analysis loses the request; ask for the file again.
    else if (pilot.step === 'analyzing') void go('schedule', 'That upload was interrupted. Please send your timetable again.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [pilot.messages.length, typing, step]);

  // ---------------------------------------------------------------------------
  // Timetable

  async function onFile(file: File) {
    if (fileRef.current) fileRef.current.value = '';
    push({ role: 'user', text: `📎 ${file.name}` });
    setPilot({ step: 'analyzing' });
    try {
      let rows: ReviewRow[];
      let warnings: string[] = [];
      const isCsv = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
      const local = isCsv ? parseTimetableCsv(await file.text()) : [];
      if (local.length && aiAvailable !== true) {
        rows = local;
        warnings = ['Imported directly from the CSV columns.'];
      } else {
        const result = await extractTimetable(file);
        rows = fromExtraction(result);
        warnings = result.warnings;
      }
      if (rows.length === 0) {
        await go('schedule', "I couldn't find any classes in that file. Try a clearer image or a PDF, or enter your classes manually.");
        return;
      }
      rows = sortRows(rows);
      const subjects = new Set(rows.map((r) => r.name.trim().toLowerCase())).size;
      const days = [...new Set(rows.map((r) => r.day))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      const withFaculty = rows.filter((r) => r.faculty).length;
      const withRoom = rows.filter((r) => r.room).length;
      setPilot({ rows, warnings });
      push({
        role: 'assistant',
        text: `Found **${subjects}** subject${subjects === 1 ? '' : 's'} and **${rows.length}** weekly classes.`,
        checklist: [
          `Subjects: ${subjects}`,
          `Class timings: ${rows.length}`,
          `Days: ${days.map((d) => DAY_NAMES[d]!.slice(0, 3)).join(', ')}`,
          withFaculty ? `Faculty: listed for ${withFaculty} classes` : 'Faculty: not listed',
          withRoom ? `Rooms: listed for ${withRoom} classes` : 'Rooms: not listed',
        ],
      });
      await go('confirm');
    } catch (err) {
      await go('schedule', `⚠ ${errorMessage(err)}`);
    }
  }

  async function saveRows(echo: boolean) {
    const rows = useSetup.getState().pilot.rows ?? [];
    if (echo) push({ role: 'user', text: 'Looks correct' });
    try {
      const saved = await saveTimetableRows(rows, schedules.length > 0);
      setPilot({ saved, rows: null });
      await go('min', `✓ Added ${saved.subjects} subjects and ${saved.classes} weekly classes.`);
    } catch {
      push({ role: 'assistant', text: "⚠ I couldn't save the schedule. Please try again." });
    }
  }

  // ---------------------------------------------------------------------------
  // Answers

  function answer(s: Step, text: string): Outcome {
    const d = useSetup.getState().draft;
    const skip = isSkip(text);
    switch (s) {
      case 'schedule':
        if (skip || /keep/i.test(text)) {
          return { next: 'min', ack: schedules.length ? `✓ Keeping your ${schedules.length} weekly classes.` : 'No problem. You can add your timetable later from Subjects → Timetable.' };
        }
        return { retry: 'Use **Upload Schedule** to send a file, or **Enter Manually** to type your classes.' };
      case 'confirm': {
        if (/edit|change|fix|wrong/i.test(text)) {
          setDialog('edit');
          return {};
        }
        if (/again|re-?upload|another/i.test(text)) {
          fileRef.current?.click();
          return {};
        }
        const yes = parseYesNo(text) ?? (/correct|right|good|fine/i.test(text) ? true : null);
        if (yes) {
          void saveRows(false);
          return {};
        }
        return { retry: 'Tap **Edit Schedule** to fix entries, or **Upload Again** to send a different file.' };
      }
      case 'min': {
        const n = parsePercent(text);
        if (n === null) return { retry: 'Please send a percentage between 1 and 100, like **75%**.' };
        patch({ minAttendance: n, targetAttendance: Math.max(d.targetAttendance, n), safeAttendance: Math.max(d.safeAttendance, n) });
        return { next: 'target' };
      }
      case 'target': {
        if (skip || parseYesNo(text) === false) {
          patch({ targetAttendance: d.minAttendance });
          return { next: 'name', ack: `Minimum required: **${d.minAttendance}%**. No separate target.\n\n✓ Saved` };
        }
        const n = parsePercent(text);
        if (n === null) return { retry: `Send a percentage like **${Math.min(100, d.minAttendance + 5)}%**, or skip.` };
        if (n < d.minAttendance) return { retry: `Your target should be at least your minimum (${d.minAttendance}%).` };
        patch({ targetAttendance: n, safeAttendance: Math.max(d.safeAttendance, Math.min(100, n + 5)) });
        return { next: 'name', ack: `Minimum required: **${d.minAttendance}%**\n\nPersonal target: **${n}%**\n\n✓ Saved` };
      }
      case 'name':
        if (skip) return { next: 'semester' };
        patchProfile({ name: text.trim().replace(/^(i'?m|my name is|call me)\s+/i, '').slice(0, 100) });
        return { next: 'semester', ack: `Nice to meet you, ${useSetup.getState().draft.profile.name.split(' ')[0]}!` };
      case 'semester': {
        if (skip) return { next: 'year' };
        const num = /\d+/.exec(text)?.[0];
        patchProfile({ semester: (num ?? text.trim()).slice(0, 50) });
        return { next: 'year' };
      }
      case 'year':
        if (!skip) patchProfile({ academicYear: text.trim().slice(0, 50) });
        return { next: 'semesterEnd' };
      case 'semesterEnd': {
        if (skip) return { next: 'notify', ack: "I'll assume about four months for now. You can change it anytime in Settings." };
        const date = parseFutureDate(text, todayISO());
        if (!date) return { retry: "I couldn't read that date. Try something like **15 Dec**, or pick it from the calendar." };
        patch({ semesterEnd: date });
        return { next: 'notify', ack: `✓ Semester ends on ${prettyDate(date)}.` };
      }
      case 'notify': {
        const yes = parseYesNo(text);
        if (yes === null) return { retry: 'Just answer **yes** or **no**.' };
        if (yes) return { next: 'lead' };
        const c = d.notifications.categories;
        const off = <K extends keyof typeof c>(k: K) => ({ ...c[k], enabled: false });
        patch({
          notifications: {
            ...d.notifications,
            categories: { ...c, classes: off('classes'), revision: off('revision'), tasks: off('tasks'), assignments: off('assignments'), exams: off('exams') },
          },
        });
        return { next: 'revision', ack: 'Okay, no reminders. You can turn them on anytime in Settings → Notifications.' };
      }
      case 'lead': {
        const m = parseLeadMinutes(text);
        if (m === null) return { retry: 'Send a number of minutes, like **15**.' };
        patchClassReminder(m);
        return { next: 'permission', ack: `✓ I'll remind you ${m} minute${m === 1 ? '' : 's'} before each class, and before revisions, deadlines and exams.` };
      }
      case 'permission':
        return { next: 'revision', ack: 'No problem. You can allow notifications later in Settings → Notifications.' };
      case 'revision': {
        if (/custom|change|own|different/i.test(text) || parseYesNo(text) === false) return { next: 'intervals' };
        const custom = /\d/.test(text) ? parseIntervals(text) : null;
        const intervals = custom ?? RECOMMENDED;
        patch({ revisionIntervals: intervals });
        return { next: 'times', ack: `✓ Revision schedule: Day ${intervals.join(', ')}.` };
      }
      case 'intervals': {
        const intervals = parseIntervals(text);
        if (!intervals) return { retry: 'Send day numbers separated by commas, like **1, 3, 7, 14, 30**.' };
        patch({ revisionIntervals: intervals });
        const preview = initialRevisions(todayISO(), intervals).map((r) => r.dueDate.slice(5)).join(', ');
        return { next: 'times', ack: `✓ Revision schedule: Day ${intervals.join(', ')}.\n\nLearn something today → revise on ${preview}.` };
      }
      case 'times': {
        if (skip) return { next: 'hours' };
        const t = parseStudyTimes(text);
        if (!t.length) return { retry: 'Pick from **morning**, **afternoon**, **evening** or **night** (or several).' };
        patch({ studyTimes: t });
        setTimes(t);
        return { next: 'hours', ack: `✓ I'll prefer the ${listTimes(t)} for study sessions.` };
      }
      case 'hours': {
        if (skip) return { next: 'done' };
        const m = parseStudyTarget(text);
        if (m === null) return { retry: 'Send a duration like **3 hours** or **90 min**.' };
        patch({ dailyStudyTargetMinutes: m });
        return { next: 'done', ack: `✓ Daily study target: ${formatMinutes(m)}. I'll treat it as a planning guide, not a strict rule.` };
      }
      default:
        return {};
    }
  }

  async function send(text: string, label = text) {
    const value = text.trim();
    if (!value || typing || step === 'analyzing' || step === 'done') return;
    if (/\b(manual setup|switch to manual|do it myself)\b/i.test(value)) {
      setMode('manual');
      return;
    }
    push({ role: 'user', text: label });
    setInput('');
    const outcome = answer(step, value);
    if (outcome.retry) {
      setTyping(true);
      await sleep(300);
      push({ role: 'assistant', text: outcome.retry });
      setTyping(false);
    } else if (outcome.next) {
      await go(outcome.next, outcome.ack);
    }
  }

  // ---------------------------------------------------------------------------
  // Quick replies for the current step

  const reply = (label: string, value?: string, primary?: boolean): Reply => ({ label, value, primary });
  function replies(): Reply[] {
    const d = draft;
    switch (step) {
      case 'schedule':
        return [
          { label: 'Upload Schedule', primary: true, run: () => fileRef.current?.click() },
          { label: 'Enter Manually', run: () => setDialog('manual') },
          ...(schedules.length ? [reply(`Keep my ${schedules.length} classes`, 'keep')] : [reply('Skip for now', 'skip')]),
        ];
      case 'confirm':
        return [
          { label: 'Looks Correct', primary: true, run: () => void saveRows(true) },
          { label: 'Edit Schedule', run: () => setDialog('edit') },
          { label: 'Upload Again', run: () => fileRef.current?.click() },
        ];
      case 'min':
        return [reply('75%'), reply('80%'), reply('85%')];
      case 'target':
        return [reply(`${Math.min(100, d.minAttendance + 5)}%`), reply(`${Math.min(100, d.minAttendance + 10)}%`), reply('Skip', 'skip')];
      case 'name':
      case 'semester':
        return [reply('Skip', 'skip')];
      case 'year':
        return [reply(currentAcademicYear()), reply('Skip', 'skip')];
      case 'semesterEnd':
        return [reply('Skip', 'skip')];
      case 'notify':
        return [reply('Yes', 'yes', true), reply('No', 'no')];
      case 'lead':
        return [5, 10, 15, 30].map((m) => reply(`${m} minutes`, String(m), m === 15));
      case 'permission':
        return [
          {
            label: 'Allow notifications',
            primary: true,
            run: async () => {
              push({ role: 'user', text: 'Allow notifications' });
              const result = await requestNotificationPermission();
              const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches;
              const ack =
                result === 'granted'
                  ? '✓ Notifications enabled.'
                  : ios
                    ? 'On iPhone and iPad, notifications work after you **Add to Home Screen** (Share → Add to Home Screen). Reminders still show inside the app.'
                    : result === 'denied'
                      ? 'Notifications are blocked in your browser settings. Reminders will still show inside the app.'
                      : 'No problem. You can allow notifications later in Settings → Notifications.';
              await go('revision', ack);
            },
          },
          reply('Not now', 'not now'),
        ];
      case 'revision':
        return [reply('Use Recommended', 'recommended', true), reply('Customize', 'customize')];
      case 'hours':
        return [reply('2 hours'), reply('3 hours'), reply('4 hours'), reply('5 hours')];
      case 'done':
        return [
          {
            label: 'Go to Home',
            primary: true,
            run: async () => {
              setFinishing(true);
              await finish();
            },
          },
        ];
      default:
        return [];
    }
  }

  const progress = Math.max(0, ORDER.indexOf(step === 'analyzing' ? 'schedule' : step)) / (ORDER.length - 1);
  const canType = !['analyzing', 'done', 'confirm', 'permission'].includes(step);
  const placeholder =
    step === 'schedule' ? 'Or type "skip"…' : step === 'semesterEnd' ? 'e.g. 15 Dec' : step === 'intervals' ? '1, 3, 7, 14, 30' : step === 'times' ? 'e.g. evening and night' : 'Type your answer…';
  const quick = replies();

  return (
    <div className="safe-top flex h-dvh flex-col bg-page">
      <header className="border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <AppLogo size="sm" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">AI Pilot</div>
            <div className="text-xs text-muted">Setting up your workspace</div>
          </div>
          <Button size="sm" variant="ghost" icon={<SlidersHorizontal className="size-4" />} onClick={() => setMode('manual')}>
            <span className="hidden sm:inline">Switch to</span> Manual
          </Button>
        </div>
        <div className="h-0.5 bg-line">
          <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
          {pilot.messages.map((m) => (
            <Message key={m.id} m={m} />
          ))}
          {step === 'analyzing' && (
            <Bubble>
              <div className="flex items-center gap-2 font-medium">
                <Loader2 className="size-4 animate-spin text-accent" /> Analyzing your schedule…
              </div>
              <p className="mt-1 text-xs text-ink-2">Detecting subjects, class timings, days, faculty and rooms. This can take up to a minute.</p>
            </Bubble>
          )}
          {typing && (
            <Bubble>
              <span className="inline-flex gap-1" aria-label="AI Pilot is typing">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </span>
            </Bubble>
          )}

          {!typing && step === 'times' && (
            <div className="flex flex-wrap gap-2 pl-10">
              {STUDY_TIMES.map((t) => (
                <Chip key={t} selected={times.includes(t)} onClick={() => setTimes((x) => (x.includes(t) ? x.filter((y) => y !== t) : STUDY_TIMES.filter((y) => y === t || x.includes(y))))}>
                  {t[0]!.toUpperCase() + t.slice(1)}
                </Chip>
              ))}
              <Button size="sm" variant="primary" className="h-9 rounded-full" disabled={!times.length} onClick={() => void send(times.join(' and '), listTimes(times).replace(/^./, (c) => c.toUpperCase()))}>
                Done
              </Button>
              <Button size="sm" variant="ghost" className="h-9" onClick={() => void send('skip', 'Skip')}>
                Skip
              </Button>
            </div>
          )}

          {!typing && step === 'semesterEnd' && (
            <div className="flex flex-wrap items-center gap-2 pl-10">
              <Input type="date" min={todayISO()} defaultValue={draft.semesterEnd ?? ''} className="h-9 w-auto" aria-label="Semester end date" id="sem-end" />
              <Button
                size="sm"
                variant="primary"
                className="h-9 rounded-full"
                onClick={() => {
                  const v = (document.getElementById('sem-end') as HTMLInputElement | null)?.value;
                  if (v) void send(v, prettyDate(v));
                }}
              >
                Set date
              </Button>
            </div>
          )}

          {!typing && quick.length > 0 && step !== 'analyzing' && (
            <div className="flex flex-wrap gap-2 pl-10">
              {quick.map((r) => (
                <Button
                  key={r.label}
                  size="sm"
                  variant={r.primary ? 'primary' : 'secondary'}
                  loading={r.label === 'Go to Home' && finishing}
                  className="h-9 rounded-full px-4"
                  onClick={() => (r.run ? r.run() : void send(r.value ?? r.label, r.label))}
                >
                  {r.label}
                </Button>
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="safe-bottom border-t border-line bg-surface">
        <form
          className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          {step === 'schedule' && (
            <Button type="button" variant="secondary" className="h-11 rounded-full" title="Upload a photo, PDF or spreadsheet of your timetable" onClick={() => fileRef.current?.click()}>
              <Paperclip className="size-4" /> <span className="hidden sm:inline">Upload</span>
              <span className="sr-only sm:hidden">Upload timetable</span>
            </Button>
          )}
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={canType ? placeholder : 'Use the buttons above'}
            disabled={!canType || typing}
            className="h-11 flex-1 rounded-full px-4"
            aria-label="Your answer"
            enterKeyHint="send"
          />
          <Button type="submit" variant="primary" size="icon" className="size-11 rounded-full" disabled={!canType || !input.trim() || typing} aria-label="Send">
            <Send className="size-5" />
          </Button>
        </form>
      </div>

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.xlsx,.csv,application/pdf,image/*"
        onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
      />

      <Modal open={dialog !== null} onClose={() => setDialog(null)} title={dialog === 'edit' ? 'Review your schedule' : 'Enter your classes'} wide>
        {dialog && (
          <TimetableImport
            mode={schedules.length ? 'replace' : 'onboarding'}
            initialRows={dialog === 'edit' ? (pilot.rows ?? []) : [blankRow()]}
            initialWarnings={dialog === 'edit' ? pilot.warnings : []}
            onDone={(saved) => {
              setDialog(null);
              push({ role: 'user', text: dialog === 'edit' ? 'Edited the schedule' : 'Entered classes manually' });
              setPilot({ saved, rows: null });
              void go('min', `✓ Added ${saved.subjects} subjects and ${saved.classes} weekly classes.`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function Bubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex animate-rise items-start gap-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Bot className="size-4" />
      </span>
      <div className="min-w-0 max-w-[85%] rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 text-sm shadow-card">{children}</div>
    </div>
  );
}

function Message({ m }: { m: PilotMessage }) {
  if (m.role === 'user') {
    return (
      <div className="flex animate-rise justify-end">
        <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-accent px-4 py-2.5 text-sm text-accent-ink">{m.text}</p>
      </div>
    );
  }
  return (
    <Bubble>
      {m.text && (
        <div className="prose-sm leading-relaxed">
          <ReactMarkdown>{m.text}</ReactMarkdown>
        </div>
      )}
      {m.checklist && (
        <ul className="mt-2 space-y-1">
          {m.checklist.map((c) => (
            <li key={c} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--color-good)' }} /> {c}
            </li>
          ))}
        </ul>
      )}
      {m.schedule && <ScheduleList rows={m.schedule} warnings={m.warnings ?? []} />}
    </Bubble>
  );
}

/** The extracted timetable, grouped by weekday (Monday first), for the student to check. */
function ScheduleList({ rows, warnings }: { rows: ReviewRow[]; warnings: string[] }) {
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => rows.some((r) => r.day === d));
  return (
    <div className="mt-2 space-y-3">
      <div className="max-h-80 space-y-3 overflow-y-auto rounded-xl bg-surface-2 p-3">
        {days.map((d) => (
          <div key={d}>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{DAY_NAMES[d]}</div>
            <ul className="mt-1 space-y-0.5">
              {rows
                .filter((r) => r.day === d)
                .map((r) => (
                  <li key={r.key} className={cn('flex gap-2 tabular')}>
                    <span className="w-12 shrink-0 text-ink-2">{r.start}</span>
                    <span className="min-w-0">
                      <span className="font-medium">{r.name}</span>
                      {(r.room || r.faculty) && <span className="text-xs text-muted"> · {[r.room && `Room ${r.room}`, r.faculty].filter(Boolean).join(' · ')}</span>}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      {warnings.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-warning-ink">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <p className="text-ink-2">I may have misunderstood some entries. Please review them before I add them.</p>
    </div>
  );
}
