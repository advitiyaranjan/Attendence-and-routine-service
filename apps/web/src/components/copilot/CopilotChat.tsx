import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import ReactMarkdown from 'react-markdown';
import { AlertTriangle, ArrowLeft, Bot, Loader2, Check, History, Mic, MicOff, FileText, Paperclip, Pencil, Send, ShieldCheck, Sparkles, Trash2, Undo2, WifiOff, X } from 'lucide-react';
import type { QuizResponse } from '@student-os/core';
import { quiz as genQuiz, refreshAiStatus } from '../../lib/ai';
import { errorMessage } from '../../lib/api';
import { db } from '../../lib/db';
import { useSettings } from '../../lib/hooks';
import { isNative } from '../../lib/platform';
import { toast, useApp } from '../../lib/store';
import { useCopilot, type CopilotMessage } from '../../lib/copilot/store';
import { ACCEPT, formatSize, MAX_FILES, MAX_TOTAL_BYTES, prepareAttachment, type AttachmentMeta, type PreparedAttachment } from '../../lib/copilot/attachments';
import type { Proposal } from '../../lib/copilot/registry';
import { QuizRunner } from '../StudyTools';
import { Button, Checkbox, cn, Input, Select, Textarea } from '../ui';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export const COPILOT_SUGGESTIONS = [
  'What do I need to do today?',
  'Plan my evening',
  'Show subjects where my attendance is below 80%',
  'I attended today’s classes',
  'Remind me every Sunday at 8 PM to plan my week',
  'I learned CPU scheduling today',
];

/** A file attached to a message: image thumbnail or document icon, name and size. */
function AttachmentChip({ meta, onRemove }: { meta: AttachmentMeta; onRemove?: () => void }) {
  return (
    <div className="flex max-w-56 items-center gap-2 rounded-xl border border-line bg-surface p-1.5 pr-2 text-xs">
      {meta.thumb ? (
        <img src={meta.thumb} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
          <FileText className="size-4" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">{meta.name}</span>
        <span className="text-muted">{formatSize(meta.size)}</span>
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-auto rounded-md p-0.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Remove ${meta.name}`}>
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice input (Web Speech API where available)

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

function speechCtor(): (new () => SpeechRec) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Android app: the system speech recogniser (the WebView has no Web Speech API). */
function NativeVoiceButton({ onText, disabled }: { onText: (t: string, final: boolean) => void; disabled?: boolean }) {
  const [listening, setListening] = useState(false);
  return (
    <Button
      type="button"
      variant={listening ? 'primary' : 'ghost'}
      disabled={disabled || listening}
      aria-label="Speak"
      title="Voice input"
      onClick={async () => {
        const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
        try {
          if (!(await SpeechRecognition.available()).available) {
            toast('Speech recognition is not available on this phone.', 'error');
            return;
          }
          const perm = await SpeechRecognition.requestPermissions();
          if (perm.speechRecognition !== 'granted') {
            toast('Allow microphone access to use voice input.', 'error');
            return;
          }
          setListening(true);
          const res = await SpeechRecognition.start({
            language: navigator.language || 'en-US',
            maxResults: 1,
            popup: true,
            partialResults: false,
          });
          const text = res.matches?.[0];
          if (text) onText(text, true);
        } catch {
          toast("Couldn't hear that. Try again.", 'error');
        } finally {
          setListening(false);
        }
      }}
    >
      <Mic className="size-4" />
    </Button>
  );
}

function VoiceButton({ onText, disabled }: { onText: (t: string, final: boolean) => void; disabled?: boolean }) {
  const [listening, setListening] = useState(false);
  const rec = useRef<SpeechRec | null>(null);
  const Ctor = speechCtor();
  if (isNative) return <NativeVoiceButton onText={onText} disabled={disabled} />;
  if (!Ctor) return null;
  return (
    <Button
      type="button"
      variant={listening ? 'primary' : 'ghost'}
      disabled={disabled}
      aria-label={listening ? 'Stop voice input' : 'Speak'}
      title="Voice input"
      onClick={() => {
        if (listening) {
          rec.current?.stop();
          return;
        }
        const r = new Ctor();
        r.lang = navigator.language || 'en-US';
        r.interimResults = true;
        r.continuous = false;
        r.onresult = (e) => {
          const results = Array.from(e.results as ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>);
          const text = results.map((x) => x[0]!.transcript).join(' ');
          onText(text, !!results.at(-1)?.isFinal);
        };
        r.onend = () => setListening(false);
        r.onerror = () => {
          setListening(false);
          toast("Couldn't hear that — check microphone permission.", 'error');
        };
        rec.current = r;
        setListening(true);
        r.start();
      }}
    >
      {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Proposal (confirmation) card

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

function ProposalCard({ messageId, p }: { messageId: string; p: Proposal }) {
  const { confirm, cancel, edit, toggleItem, undo } = useCopilot();
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = p.status === 'pending';
  const get = (path: string) => {
    const v = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | null)?.[k], p.params);
    return v === null || v === undefined ? '' : String(v);
  };

  async function saveEdits() {
    setBusy(true);
    setEditError(null);
    for (const f of p.editable) {
      const v = values[f.path];
      if (v === undefined || v === get(f.path)) continue;
      const e = await edit(messageId, p.id, f.path, v, f.type);
      if (e) {
        setEditError(e);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setEditing(false);
    setValues({});
  }

  const selectedCount = p.items?.filter((i) => i.selected).length ?? 0;
  return (
    <div className={cn('rounded-xl border bg-surface p-3 text-sm', p.risk === 'delete' ? 'border-critical/50' : 'border-line', !pending && 'opacity-90')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-ink-2">{p.title}</div>
          {p.heading && <div className="font-semibold">{p.heading}</div>}
        </div>
        {p.risk === 'delete' && <span className="text-xs text-critical-ink">Deletes data</span>}
        {p.bulk && p.risk !== 'delete' && <span className="text-xs text-warning-ink">Bulk change</span>}
      </div>

      {p.lines.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-ink-2">
          {p.lines.map((l, i) => (
            <li key={i} className="whitespace-pre-wrap">
              {l}
            </li>
          ))}
        </ul>
      )}

      {p.items && (
        <ul className={cn('mt-2 space-y-1', !reviewing && p.items.length > 6 && 'max-h-40 overflow-y-auto')}>
          {p.items.map((it) => (
            <li key={it.key} className="flex items-start gap-2">
              {pending && (reviewing || it.warning) ? (
                <Checkbox checked={it.selected} onChange={() => toggleItem(messageId, p.id, it.key)} label={it.label} />
              ) : (
                <span className={cn('mt-0.5 text-xs', it.selected ? 'text-ink-2' : 'text-muted')}>•</span>
              )}
              <span className={cn(!it.selected && 'text-muted line-through')}>
                {it.label}
                {it.warning && <span className="block text-xs text-warning-ink">⚠ {it.warning}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {p.warnings.length > 0 && (
        <div className="mt-2 space-y-0.5 rounded-lg bg-surface-2 p-2 text-xs">
          {p.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" style={{ color: 'var(--color-warning)' }} /> {w}
            </div>
          ))}
        </div>
      )}

      {pending && p.affects.length > 0 && <p className="mt-2 text-xs text-muted">This will also update: {p.affects.join(' · ')}</p>}

      {editing && pending && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {p.editable.map((f) => (
            <label key={f.path} className={cn('text-xs', f.type === 'textarea' && 'sm:col-span-2')}>
              <span className="mb-0.5 block text-ink-2">{f.label}</span>
              {f.type === 'textarea' ? (
                <Textarea value={values[f.path] ?? get(f.path)} onChange={(e) => setValues({ ...values, [f.path]: e.target.value })} />
              ) : f.type === 'priority' ? (
                <Select value={values[f.path] ?? get(f.path)} onChange={(e) => setValues({ ...values, [f.path]: e.target.value })} className="h-9">
                  {PRIORITIES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              ) : (
                <Input
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'}
                  value={values[f.path] ?? get(f.path)}
                  onChange={(e) => setValues({ ...values, [f.path]: e.target.value })}
                  className="h-9"
                />
              )}
            </label>
          ))}
          {editError && <p className="text-xs text-critical-ink sm:col-span-2">{editError}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" variant="primary" loading={busy} onClick={saveEdits}>
              Update proposal
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Back
            </Button>
          </div>
        </div>
      )}

      {pending && !editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant={p.risk === 'delete' ? 'danger' : 'primary'} disabled={!!p.items && selectedCount === 0} onClick={() => void confirm(messageId, p.id)} icon={<Check className="size-4" />}>
            {p.items && p.items.length > 1 && selectedCount !== p.items.length ? `${p.confirmLabel.replace(/ all$/, '')} (${selectedCount})` : p.confirmLabel}
          </Button>
          {p.items && p.items.length > 1 && !reviewing && (
            <Button size="sm" variant="secondary" onClick={() => setReviewing(true)}>
              Review
            </Button>
          )}
          {p.editable.length > 0 && (
            <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
              {p.warnings.some((w) => /^(Clashes|Overlaps)/.test(w)) ? 'Change time' : 'Edit'}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void cancel(messageId, p.id)}>
            Cancel
          </Button>
        </div>
      )}

      {p.status === 'confirmed' && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-good-ink">
            {p.result}
            {p.autoApplied && <span className="ml-1 text-muted">· applied automatically (Full access)</span>}
          </span>
          {p.logId && (
            <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => void undo(messageId, p.id)}>
              Undo
            </Button>
          )}
        </div>
      )}
      {p.status === 'cancelled' && <p className="mt-2 text-xs text-muted">Cancelled — nothing was changed.</p>}
      {p.status === 'superseded' && <p className="mt-2 text-xs text-muted">Replaced by an updated proposal below.</p>}
      {p.status === 'undone' && <p className="mt-2 text-xs text-muted">{p.result ?? 'Undone'}</p>}
      {p.status === 'failed' && <p className="mt-2 text-xs text-critical-ink">{p.error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function QuizLauncher({ message }: { message: CopilotMessage }) {
  const q = message.quiz!;
  const [quiz, setQuiz] = useState<QuizResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [topicRef, setTopicRef] = useState<{
    id: string | null;
    subjectId: string | null;
    title: string;
  }>({ id: null, subjectId: null, title: q.topic });
  const markStarted = useCopilot((s) => s.markQuizStarted);

  async function start() {
    setBusy(true);
    try {
      const topics = (await db.entity('topic').toArray()).filter((t) => !t.deletedAt);
      const t = topics.find((x) => x.title.toLowerCase().includes(q.topic.toLowerCase()) || q.topic.toLowerCase().includes(x.title.toLowerCase()));
      setTopicRef({
        id: t?.id ?? null,
        subjectId: t?.subjectId ?? null,
        title: t?.title ?? q.topic,
      });
      setQuiz(await genQuiz(t?.title ?? q.topic, q.count, q.difficulty));
      markStarted(message.id);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (q.autoStart && !q.started) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Button size="sm" variant="secondary" loading={busy} icon={<Sparkles className="size-4" />} onClick={start}>
        {q.started ? 'Retake' : 'Start'} {q.count}-question quiz: {q.topic}
      </Button>
      {quiz && <QuizRunner quiz={quiz} topic={topicRef} difficulty={q.difficulty} onClose={() => setQuiz(null)} />}
    </>
  );
}

function AssistantMessage({ m }: { m: CopilotMessage }) {
  const choose = useCopilot((s) => s.choose);
  return (
    <div className="min-w-0 max-w-[92%] animate-rise space-y-2 rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 text-sm shadow-card">
      {m.content && (
        <div className="prose-sm">
          <ReactMarkdown>{m.content}</ReactMarkdown>
        </div>
      )}
      {m.notices?.map((n, i) => (
        <p key={i} className="flex items-start gap-1.5 text-xs text-ink-2">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-muted" /> {n}
        </p>
      ))}
      {m.proposals?.map((p) => (
        <ProposalCard key={p.id} messageId={m.id} p={p} />
      ))}
      {m.clarification && (
        <div className="space-y-1.5">
          {m.clarification.question !== m.content && <p className="font-medium">{m.clarification.question}</p>}
          <div className="flex flex-wrap gap-1.5">
            {m.clarification.options.map((o, i) => (
              <Button key={i} size="sm" variant="secondary" className="h-auto min-h-8 justify-start py-1.5 text-left" disabled={m.clarification!.answered} onClick={() => void choose(m.id, o)}>
                {o.label}
              </Button>
            ))}
          </div>
        </div>
      )}
      {m.links?.map((l) => (
        <Link key={l.href} to={l.href} className="inline-block text-sm font-medium text-accent hover:underline">
          {l.label} →
        </Link>
      ))}
      {m.quiz && <QuizLauncher message={m} />}
    </div>
  );
}

export function CopilotChat({ compact = false, initialPrompt }: { compact?: boolean; initialPrompt?: string | null }) {
  const { messages, busy, load, send, clear, setOpen } = useCopilot();
  const [input, setInput] = useState('');
  const online = useApp((s) => s.online);
  const aiAvailable = useApp((s) => s.aiAvailable);
  const aiIssue = useApp((s) => s.aiIssue);
  const settings = useSettings();
  const sentInitial = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The panel covers the page, so close it while opening AI activity. The open
   * panel owns a history entry: replace that entry (instead of pushing on top
   * of it) so closing doesn't step back off the new page, and Back from AI
   * activity returns to the page you were on.
   */
  function openActivity() {
    const panelEntry = (window.history.state as { copilot?: boolean } | null)?.copilot === true;
    navigate('/ai-activity', { replace: panelEntry });
    setOpen(false);
  }
  useEffect(() => {
    // The server may have been fixed or woken up since the app started.
    if (online && aiAvailable !== true) void refreshAiStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);
  // Follow the conversation only while the student is at (or near) the bottom,
  // so reading older messages is never interrupted.
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const toBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (atBottom.current || last?.role === 'user') toBottom();
  }, [messages, busy]);
  // When the keyboard opens or closes the list changes height: keep the latest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => atBottom.current && toBottom());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (initialPrompt && !sentInitial.current) {
      sentInitial.current = true;
      void send(initialPrompt);
    }
  }, [initialPrompt, send]);

  const disabled = !online || aiAvailable === false || !settings.aiPermissions.enabled;
  const [files, setFiles] = useState<PreparedAttachment[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (!incoming.length) return;
    setPreparing(true);
    try {
      const next = [...files];
      for (const f of incoming) {
        if (next.length >= MAX_FILES) {
          toast(`You can attach up to ${MAX_FILES} files per message.`, 'error');
          break;
        }
        try {
          const prepared = await prepareAttachment(f);
          if (next.reduce((n, x) => n + x.file.size, 0) + prepared.file.size > MAX_TOTAL_BYTES) {
            toast(`"${f.name}" is too large — attachments can total about 4 MB per message.`, 'error');
            continue;
          }
          next.push(prepared);
        } catch (err) {
          toast((err as Error).message, 'error');
        }
      }
      setFiles(next);
    } finally {
      setPreparing(false);
    }
  }

  const submit = (text = input) => {
    if (!text.trim() && !files.length) return;
    setInput('');
    const toSend = files;
    setFiles([]);
    void send(text, toSend);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 pb-2">
        <p className="flex items-center gap-1.5 text-xs text-ink-2">
          <ShieldCheck className="size-3.5" /> Suggests changes — you confirm everything.
        </p>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" title="AI activity" aria-label="AI activity" onClick={openActivity}>
            <History className="size-4" />
          </Button>
          {messages.length > 0 && (
            <Button size="sm" variant="ghost" title="Clear conversation" aria-label="Clear conversation" onClick={() => void clear()}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {!online && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-line bg-surface p-3 text-sm">
          <WifiOff className="mt-0.5 size-4 shrink-0 text-muted" />
          <div>
            AI requires an internet connection.
            <div className="text-ink-2">Your local academic data is still available.</div>
          </div>
        </div>
      )}
      {online && aiAvailable === false && <div className="mb-3 rounded-lg border border-line bg-surface p-3 text-sm text-ink-2">{aiIssue ?? 'AI is unavailable right now.'}</div>}
      {!settings.aiPermissions.enabled && (
        <div className="mb-3 rounded-lg border border-line bg-surface p-3 text-sm text-ink-2">
          AI Pilot is off. Turn it on in{' '}
          <Link to="/settings/ai" className="text-accent">
            Settings → AI permissions
          </Link>
          .
        </div>
      )}

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pb-2"
      >
        {messages.length === 0 && (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                <Bot className="size-5" />
              </span>
              <div>
                <p className="font-semibold">{greeting()}! How can I help?</p>
                <p className="mt-0.5 text-sm text-ink-2">Ask about your day, or tell me what to add, move or plan. I'll show you every change before it happens.</p>
              </div>
            </div>
            <div className={cn('grid gap-2', !compact && 'sm:grid-cols-2')}>
              {COPILOT_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  disabled={disabled}
                  onClick={() => submit(s)}
                  className="rounded-2xl border border-line bg-surface p-3 text-left text-sm shadow-card transition-colors hover:border-accent/40 hover:bg-surface-2 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex flex-col items-end gap-1.5">
              {m.attachments?.length ? (
                <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
                  {m.attachments.map((a, i) => (
                    <AttachmentChip key={i} meta={a} />
                  ))}
                </div>
              ) : null}
              <p className="max-w-[85%] animate-rise whitespace-pre-wrap rounded-2xl rounded-tr-md bg-accent px-4 py-2.5 text-sm text-accent-ink">{m.content}</p>
            </div>
          ) : (
            <div key={m.id} className="flex justify-start">
              <AssistantMessage m={m} />
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-ink-2">
            <Sparkles className="size-4 animate-pulse text-accent" /> AI Pilot is thinking…
          </div>
        )}
      </div>

      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Attachments">
          {files.map((f, i) => (
            <AttachmentChip key={i} meta={f.meta} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <form
        className={cn(
          'mt-2 flex flex-col gap-0.5 rounded-[26px] border border-line bg-surface px-2 pb-2 pt-1 shadow-pop transition-shadow focus-within:shadow-[0_6px_28px_-8px_rgb(0_0_0/0.28)]',
          dragging && 'border-accent',
        )}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) void addFiles(e.dataTransfer.files);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            // Grow with the text, up to about five lines.
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            // Pasted screenshots become attachments.
            const pasted = Array.from(e.clipboardData.files);
            if (pasted.length) {
              e.preventDefault();
              void addFiles(pasted);
            }
          }}
          placeholder={disabled ? 'AI unavailable right now' : files.length ? 'Add a message (optional)…' : 'Ask AI Pilot anything…'}
          disabled={disabled}
          rows={1}
          className="max-h-40 min-h-11 w-full resize-none border-0 bg-transparent px-3 py-2.5 text-base text-ink placeholder:text-muted outline-none focus:outline-none focus-visible:outline-none disabled:opacity-60 sm:text-sm"
          aria-label="Message AI Pilot"
        />
        <div className="flex items-center gap-1.5" data-keep-focus>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-3.5 text-sm font-medium text-accent transition-colors hover:border-accent/50 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/25 disabled:pointer-events-none disabled:opacity-50"
            disabled={disabled || busy || preparing || files.length >= MAX_FILES}
            title="Upload photos, PDFs, Word, Excel or text files (up to 4)"
            onClick={() => fileInput.current?.click()}
          >
            {preparing ? <Loader2 className="size-[18px] animate-spin" /> : <Paperclip className="size-[18px]" />}
            Upload document
          </button>
          <span className="flex-1" />
          <VoiceButton
            disabled={disabled || busy}
            onText={(t, final) => {
              setInput(t);
              if (final) submit(t);
            }}
          />
          <Button type="submit" variant="primary" size="icon" className="size-10 rounded-full" disabled={disabled || (!input.trim() && !files.length) || preparing} loading={busy} aria-label="Send">
            {!busy && <Send className="size-5" />}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Slide-over panel available from every page. */
export function CopilotPanel() {
  const { open, setOpen, pendingPrompt } = useCopilot();
  // Every link to /assistant opens this panel instead, so there is one AI Pilot screen.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.('a[href]');
      if (!a || e.metaKey || e.ctrlKey || new URL((a as HTMLAnchorElement).href).pathname !== '/assistant') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [setOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
  // Phone/browser back closes the panel instead of leaving the page.
  useEffect(() => {
    if (!open) return;
    window.history.pushState({ ...(window.history.state as object), copilot: true }, '');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    let popped = false;
    const onPop = () => {
      popped = true;
      setOpen(false);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('popstate', onPop);
      if (!popped && (window.history.state as { copilot?: boolean } | null)?.copilot) window.history.back();
    };
  }, [open, setOpen]);
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] md:bg-black/10" onClick={() => setOpen(false)} />
      <aside data-viewport-fit style={{ top: 'var(--vvtop, 0px)', height: 'var(--vvh, 100dvh)' }} className="safe-top safe-bottom fixed right-0 z-50 flex w-full animate-rise flex-col border-l border-line bg-page px-2.5 pb-2 pt-2 shadow-pop md:w-[460px] md:px-4 md:pb-3 md:pt-3" aria-label="AI Pilot">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <button type="button" onClick={() => setOpen(false)} className="-ml-1.5 inline-flex size-9 items-center justify-center rounded-xl text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="Go back" title="Go back">
              <ArrowLeft className="size-5" />
            </button>
            <span className="flex size-8 items-center justify-center rounded-xl bg-accent text-accent-ink">
              <Bot className="size-4" />
            </span>
            AI Pilot
          </h2>
          <Button size="sm" variant="ghost" aria-label="Close Copilot" onClick={() => setOpen(false)}>
            <X className="size-4" />
          </Button>
        </div>
        <CopilotChat compact initialPrompt={pendingPrompt} />
      </aside>
    </>
  );
}
