import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useSearchParams } from 'react-router';
import type { Components } from 'react-markdown';
import { ArrowLeft, Check, CheckCheck, Layers, MoreVertical, NotebookPen, Pencil, Plus, Search, Share2, Sparkles, Trash2, X } from 'lucide-react';
import type { Note, ReviewSummary, Subject } from '@student-os/core';
import { SubjectSelect } from '../components/forms';
import { Markdown } from '../components/Markdown';
import { ConfirmDialog, NoteBodyEditor, NoteForm, useNoteDraft } from '../components/NoteComposer';
import { NoteFileImage, NoteFileLink, NoteFileStrip } from '../components/NoteFiles';
import { Button, Card, cn, EmptyState, Field, Input, Modal, PageHeader, Select, useBackToClose } from '../components/ui';
import { flashcards, summarizeNote } from '../lib/ai';
import { errorMessage } from '../lib/api';
import { useAll, useSubjectMap } from '../lib/hooks';
import { deleteNoteFiles, NOTE_FILE_SCHEME, noteFileId, noteSnippet, noteUrlTransform, shareNotes, useNoteFiles } from '../lib/note-files';
import { createMany, removeMany, update } from '../lib/repo';
import { toast, useApp } from '../lib/store';

/** Note pictures and PDFs render from this device's storage. */
const NOTE_COMPONENTS: Components = {
  img: ({ src, alt }) => {
    const id = noteFileId(typeof src === 'string' ? src : null);
    return id ? <NoteFileImage id={id} alt={alt ?? ''} /> : typeof src === 'string' && src ? <img src={src} alt={alt ?? ''} /> : null;
  },
  a: ({ href, children }) => {
    const id = noteFileId(href);
    return id ? (
      <NoteFileLink id={id} />
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

/** Chat-list style time: 4:05 PM today, then Yesterday, weekday, date. */
function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: '2-digit' } : {}) });
}

async function shareAndReport(notes: Note[]) {
  try {
    const r = await shareNotes(notes);
    if (r === 'copied') toast(notes.length === 1 ? 'Note copied — paste it anywhere' : 'Notes copied — paste them anywhere', 'success');
  } catch {
    toast("Couldn't share", 'error');
  }
}

export default function Notes() {
  const notes = (useAll('note') ?? []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const subjects = useSubjectMap();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** The open editor can veto leaving it (unsaved changes). */
  const canLeave = useRef<() => boolean>(() => true);

  const openId = params.get('open');
  const open = notes.find((n) => n.id === openId) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = notes.filter((n) => !q || `${n.title} ${n.body} ${subjects.get(n.subjectId ?? '')?.name ?? ''}`.toLowerCase().includes(q));
  const selecting = selected.size > 0;
  const clearSelection = () => setSelected(new Set());
  useBackToClose(selecting, clearSelection);

  const openNote = (id: string) => {
    if (id === openId || !canLeave.current()) return;
    setParams({ open: id });
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const select = (id: string) => setSelected((s) => (s.has(id) ? s : new Set(s).add(id)));

  async function deleteSelected() {
    setDeleting(true);
    try {
      const ids = [...selected];
      await removeMany('note', ids);
      await Promise.all(ids.map(deleteNoteFiles));
      if (openId && selected.has(openId)) setParams({});
      toast(ids.length === 1 ? 'Note deleted' : `${ids.length} notes deleted`, 'success');
      // Close the dialog, then end selection: each owns a Back entry, unwound one at a time.
      setConfirmDelete(false);
      setTimeout(clearSelection, 40);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {selecting ? (
        <div className="sticky top-0 z-20 -mx-1 flex items-center gap-1 rounded-2xl border border-line bg-surface px-1.5 py-1.5 shadow-card">
          <Button size="sm" variant="ghost" aria-label="Cancel selection" onClick={clearSelection}>
            <X className="size-5" />
          </Button>
          <span className="flex-1 font-semibold tabular-nums">{selected.size} selected</span>
          {selected.size < filtered.length && (
            <Button size="sm" variant="ghost" aria-label="Select all" title="Select all" onClick={() => setSelected(new Set(filtered.map((n) => n.id)))}>
              <CheckCheck className="size-5" />
            </Button>
          )}
          <Button size="sm" variant="ghost" aria-label="Share" title="Share" onClick={() => void shareAndReport(notes.filter((n) => selected.has(n.id)))}>
            <Share2 className="size-5" />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Delete" title="Delete" className="text-critical-ink" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-5" />
          </Button>
        </div>
      ) : (
        <div className={cn(open && 'hidden md:block')}>
          <PageHeader
            title="Notes"
            actions={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                New note
              </Button>
            }
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[22rem_1fr]">
        <div className={cn('min-w-0 space-y-2', open && 'hidden md:block')}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notes" className="h-11 rounded-full bg-surface-2 pl-10" />
          </div>
          {notes.length === 0 ? (
            <EmptyState
              icon={<NotebookPen className="size-6" />}
              title="No notes yet"
              body="Write notes with pictures and PDFs. Hold a note to share or delete it."
              action={
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                  New note
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <p className="p-3 text-sm text-ink-2">No notes match “{query}”.</p>
          ) : (
            <>
              <ul className="-mx-1">
                {filtered.map((n) => (
                  <NoteRow
                    key={n.id}
                    note={n}
                    subject={n.subjectId ? subjects.get(n.subjectId) : undefined}
                    active={n.id === openId}
                    selected={selected.has(n.id)}
                    onTap={() => (selecting ? toggle(n.id) : openNote(n.id))}
                    onHold={() => select(n.id)}
                  />
                ))}
              </ul>
              {!selecting && <p className="px-3 pt-1 text-center text-xs text-muted">Hold a note to select, share or delete</p>}
            </>
          )}
        </div>
        <div className="min-w-0">
          {open ? (
            <NoteView key={open.id} note={open} subject={open.subjectId ? subjects.get(open.subjectId) : undefined} canLeave={canLeave} onClose={() => canLeave.current() && setParams({})} />
          ) : (
            <div className="hidden md:block">
              <EmptyState icon={<NotebookPen className="size-6" />} title="Select a note" body="Notes support Markdown, pictures and PDFs. Link them to a topic so AI flashcards and quizzes can use them." />
            </div>
          )}
        </div>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New note" wide>
        {creating && (
          <NoteForm
            onDone={(id) => {
              setCreating(false);
              if (id) setParams({ open: id });
            }}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title={selected.size === 1 ? 'Delete this note?' : `Delete ${selected.size} notes?`}
        body="Their pictures and PDFs are deleted too. You can't undo this."
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={() => void deleteSelected()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/** Tap opens (or toggles while selecting); holding for a moment or right-clicking selects. */
function useHold(onHold: () => void, onTap: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  const hold = () => {
    held.current = true;
    navigator.vibrate?.(25);
    onHold();
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      held.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      cancel();
      timer.current = setTimeout(hold, 450);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      // Right-click, and the phone's own long-press menu: select instead.
      e.preventDefault();
      cancel();
      if (!held.current) hold();
    },
    onClick: () => {
      if (held.current) {
        held.current = false;
        return;
      }
      onTap();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onTap();
      }
    },
  };
}

function NoteRow({ note, subject, active, selected, onTap, onHold }: { note: Note; subject?: Subject; active: boolean; selected: boolean; onTap: () => void; onHold: () => void }) {
  const handlers = useHold(onHold, onTap);
  const color = subject?.color ?? 'var(--accent)';
  const initial = (subject?.name ?? note.title).trim().charAt(0).toUpperCase() || '•';
  const snippet = noteSnippet(note.body);
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        {...handlers}
        style={{ WebkitTouchCallout: 'none' }}
        className={cn(
          'flex w-full cursor-pointer select-none items-center gap-3 rounded-2xl px-2 py-1 transition-colors',
          selected ? 'bg-accent-soft' : active ? 'bg-surface-2' : 'hover:bg-surface-2 active:bg-surface-2',
        )}
      >
        <span className="relative shrink-0">
          <span
            className="flex size-12 items-center justify-center rounded-full text-lg font-semibold"
            style={{ background: `color-mix(in srgb, ${color} 18%, var(--surface))`, color: `color-mix(in srgb, ${color} 80%, var(--ink))` }}
            aria-hidden
          >
            {initial}
          </span>
          {selected && (
            <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full border-2 border-surface bg-accent text-accent-ink">
              <Check className="size-3" strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1 border-b border-line/70 py-2.5">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-semibold text-ink">{note.title}</span>
            <span className="shrink-0 text-xs text-muted">{when(note.updatedAt)}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-2">
            {subject && <span className="shrink-0 text-xs font-medium" style={{ color: `color-mix(in srgb, ${color} 75%, var(--ink))` }}>{subject.name} ·</span>}
            <span className="truncate">{snippet || <span className="text-muted">Empty note</span>}</span>
          </span>
        </span>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// An open note: a clean reader; editing only after tapping Edit.

function NoteView({ note, subject, canLeave, onClose }: { note: Note; subject?: Subject; canLeave: MutableRefObject<() => boolean>; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  return editing ? (
    <NoteEditor note={note} canLeave={canLeave} onDone={() => setEditing(false)} />
  ) : (
    <NoteReader note={note} subject={subject} onEdit={() => setEditing(true)} onClose={onClose} />
  );
}

function IconButton({ label, onClick, children, className }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={cn('inline-flex size-10 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink', className)}>
      {children}
    </button>
  );
}

function NoteReader({ note, subject, onEdit, onClose }: { note: Note; subject?: Subject; onEdit: () => void; onClose: () => void }) {
  const topics = useAll('topic') ?? [];
  const topic = topics.find((t) => t.id === note.topicId);
  const files = useNoteFiles(note.id) ?? [];
  const loose = files.filter((f) => !note.body.includes(`${NOTE_FILE_SCHEME}${f.id}`));
  const online = useApp((s) => s.online);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ai, setAi] = useState<ReviewSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  async function summarize() {
    setMenu(false);
    setBusy('summary');
    try {
      setAi(await summarizeNote(note.title, note.body));
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function makeCards() {
    setMenu(false);
    setBusy('cards');
    try {
      const res = await flashcards(note.title, note.body, 10);
      await createMany(
        'flashcard',
        res.cards.map((c) => ({ topicId: note.topicId, subjectId: note.subjectId, front: c.question, back: c.answer })),
      );
      toast(`Created ${res.cards.length} flashcards${note.topicId ? '' : ' — link this note to a topic to review them in Revision'}`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  const aiReady = online && !!note.body.trim();
  return (
    <Card className="space-y-4 p-0">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <IconButton label="Back to notes" onClick={onClose} className="md:hidden">
          <ArrowLeft className="size-5" />
        </IconButton>
        <span className="flex-1" />
        <IconButton label="Share" onClick={() => void shareAndReport([note])}>
          <Share2 className="size-[19px]" />
        </IconButton>
        <IconButton label="Edit" onClick={onEdit} className="text-accent hover:text-accent">
          <Pencil className="size-[19px]" />
        </IconButton>
        <div ref={menuRef} className="relative">
          <IconButton label="More" onClick={() => setMenu((m) => !m)}>
            <MoreVertical className="size-5" />
          </IconButton>
          {menu && (
            <div role="menu" className="absolute right-0 top-11 z-30 w-52 overflow-hidden rounded-xl border border-line bg-surface py-1 text-sm shadow-pop">
              <MenuItem icon={<Sparkles className="size-4" />} disabled={!aiReady} onClick={() => void summarize()}>
                Summarise with AI
              </MenuItem>
              <MenuItem icon={<Layers className="size-4" />} disabled={!aiReady} onClick={() => void makeCards()}>
                Make flashcards
              </MenuItem>
              <MenuItem
                icon={<Trash2 className="size-4" />}
                danger
                onClick={() => {
                  setMenu(false);
                  setConfirmDelete(true);
                }}
              >
                Delete note
              </MenuItem>
            </div>
          )}
        </div>
      </div>

      <article className="space-y-3 px-5 pb-6">
        <header className="space-y-1.5">
          <h2 className="text-2xl font-semibold leading-tight tracking-tight">{note.title}</h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {subject && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 font-medium text-ink-2">
                <span className="size-2 rounded-full" style={{ background: subject.color }} /> {subject.name}
              </span>
            )}
            {topic && <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium text-ink-2">{topic.title}</span>}
            <span>Edited {when(note.updatedAt)}</span>
          </p>
        </header>
        {busy && (
          <p className="flex items-center gap-2 text-sm text-ink-2">
            <Sparkles className="size-4 animate-pulse text-accent" /> {busy === 'summary' ? 'Summarising…' : 'Making flashcards…'}
          </p>
        )}
        {note.body.trim() ? (
          <Markdown components={NOTE_COMPONENTS} urlTransform={noteUrlTransform} className="text-[15px]">
            {note.body}
          </Markdown>
        ) : (
          <p className="text-sm text-muted">This note is empty. Tap the pencil to write.</p>
        )}
        {loose.length > 0 && (
          <div className="space-y-1.5 border-t border-line pt-3">
            <p className="text-xs font-semibold text-ink-2">Attachments</p>
            <NoteFileStrip files={loose} />
          </div>
        )}
        {ai && <AiSummary ai={ai} note={note} onDone={() => setAi(null)} />}
      </article>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this note?"
        body="Its pictures and PDFs are deleted too. You can't undo this."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          setConfirmDelete(false);
          await removeMany('note', [note.id]);
          await deleteNoteFiles(note.id);
          toast('Note deleted', 'success');
          onClose();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </Card>
  );
}

function MenuItem({ icon, children, onClick, disabled, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className={cn('flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-2 disabled:opacity-40', danger && 'text-critical-ink')}>
      {icon} {children}
    </button>
  );
}

function AiSummary({ ai, note, onDone }: { ai: ReviewSummary; note: Note; onDone: () => void }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3 text-sm">
      <div className="mb-1 flex items-center gap-1 font-medium">
        <Sparkles className="size-4 text-accent" /> AI summary
        <button type="button" onClick={onDone} className="ml-auto rounded-md p-1 text-muted hover:text-ink" aria-label="Close summary">
          <X className="size-4" />
        </button>
      </div>
      <Markdown>{ai.summary}</Markdown>
      {ai.highlights.length > 0 && (
        <>
          <div className="mt-2 text-xs font-semibold text-ink-2">Revision points</div>
          <ul className="list-disc pl-5">
            {ai.highlights.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </>
      )}
      {ai.suggestions.length > 0 && (
        <>
          <div className="mt-2 text-xs font-semibold text-ink-2">Practice questions</div>
          <ul className="list-disc pl-5">
            {ai.suggestions.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </>
      )}
      {ai.highlights.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={async () => {
            await update('note', note.id, { body: `${note.body}\n\n## AI revision points\n${ai.highlights.map((h) => `- ${h}`).join('\n')}` });
            toast('Revision points added to the note', 'success');
            onDone();
          }}
        >
          Add revision points to note
        </Button>
      )}
    </div>
  );
}

function NoteEditor({ note, canLeave, onDone }: { note: Note; canLeave: MutableRefObject<() => boolean>; onDone: () => void }) {
  const [title, setTitle] = useState(note.title);
  const [subjectId, setSubjectId] = useState(note.subjectId);
  const [topicId, setTopicId] = useState(note.topicId);
  const draft = useNoteDraft(note.id, note.body);
  const topics = useAll('topic') ?? [];
  const [ask, setAsk] = useState<'save' | 'discard' | null>(null);
  const [saving, setSaving] = useState(false);
  /** Back gesture is armed while editing; re-armed after "Keep editing". */
  const [armed, setArmed] = useState(true);
  const saved = useRef(false);

  const dirty = title.trim() !== note.title || subjectId !== note.subjectId || topicId !== note.topicId || draft.body !== note.body || draft.filesChanged;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Leaving another way (opening a different note on a wide screen) asks first;
  // unsaved files attached here are removed when the editor goes away.
  const discardRef = useRef(draft.discard);
  discardRef.current = draft.discard;
  useEffect(() => {
    canLeave.current = () => !dirtyRef.current || confirm('Discard your unsaved changes?');
    return () => {
      canLeave.current = () => true;
      if (!saved.current) void discardRef.current();
    };
  }, [canLeave]);

  const requestCancel = () => (dirty ? setAsk('discard') : onDone());
  useBackToClose(armed, () => {
    setArmed(false);
    if (dirtyRef.current) setAsk('discard');
    else onDone();
  });
  /** Leave after any open dialog has given back its Back entry. */
  const finish = () => setTimeout(onDone, 40);
  const keepEditing = () => {
    setAsk(null);
    setArmed(true);
  };

  async function save() {
    setSaving(true);
    try {
      await update('note', note.id, { title: title.trim() || 'Untitled', subjectId, topicId, body: draft.body });
      await draft.commit();
      saved.current = true;
      setAsk(null);
      toast('Note saved', 'success');
      finish();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4 p-0">
      <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <IconButton label="Cancel editing" onClick={requestCancel}>
          <X className="size-5" />
        </IconButton>
        <span className="flex-1 font-semibold">Edit note</span>
        <Button variant="primary" size="sm" icon={<Check className="size-4" />} disabled={!dirty} onClick={() => setAsk('save')}>
          Save
        </Button>
      </div>
      <div className="space-y-3 px-4 pb-5">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" className="h-11 text-base font-semibold" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Subject">
            <SubjectSelect value={subjectId} onChange={setSubjectId} />
          </Field>
          <Field label="Topic">
            <Select value={topicId ?? ''} onChange={(e) => setTopicId(e.target.value || null)}>
              <option value="">None</option>
              {topics
                .filter((t) => !t.deletedAt && (!subjectId || t.subjectId === subjectId))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <NoteBodyEditor draft={draft} autoFocus />
      </div>

      <ConfirmDialog
        open={ask === 'save'}
        title="Save changes?"
        body="Your edits will replace the current version of this note."
        confirmLabel="Save"
        cancelLabel="Keep editing"
        busy={saving}
        onConfirm={() => void save()}
        onCancel={keepEditing}
      />
      <ConfirmDialog
        open={ask === 'discard'}
        title="Discard changes?"
        body="Your edits and any files you attached while editing will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        danger
        onConfirm={async () => {
          setAsk(null);
          await draft.discard();
          saved.current = true; // nothing left to clean up
          finish();
        }}
        onCancel={keepEditing}
      />
    </Card>
  );
}
