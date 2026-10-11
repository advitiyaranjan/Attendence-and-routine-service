/** Writing notes: the description box with attachments, the new-note form, and a confirm dialog. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ImagePlus, Loader2, Paperclip } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { create } from '../lib/repo';
import { toast } from '../lib/store';
import { addNoteFile, deleteNoteFileIds, NOTE_FILE_ACCEPT, stripNoteFile, useNoteFiles } from '../lib/note-files';
import { SubjectSelect } from './forms';
import { NoteFileStrip } from './NoteFiles';
import { Button, cn, Field, Input, Modal, Textarea } from './ui';

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body && <div className="text-sm text-ink-2">{body}</div>}
    </Modal>
  );
}

/**
 * Body text plus files added or removed while writing. Files are stored as they
 * are attached; `commit` deletes the ones removed, `discard` deletes the new ones,
 * so cancelling an edit leaves the note exactly as it was.
 */
export function useNoteDraft(noteId: string, initialBody: string) {
  const [body, setBody] = useState(initialBody);
  const added = useRef(new Set<string>());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const allFiles = useNoteFiles(noteId) ?? [];
  const files = allFiles.filter((f) => !removed.has(f.id));
  return {
    noteId,
    body,
    setBody,
    files,
    filesChanged: added.current.size > 0 || removed.size > 0,
    onAdded: (id: string) => added.current.add(id),
    remove: (id: string) => {
      setRemoved((r) => new Set(r).add(id));
      setBody((b) => stripNoteFile(b, id));
    },
    commit: async () => {
      await deleteNoteFileIds(removed);
      added.current.clear();
    },
    discard: async () => {
      await deleteNoteFileIds(added.current);
      added.current.clear();
      setRemoved(new Set());
    },
  };
}
export type NoteDraft = ReturnType<typeof useNoteDraft>;

/** The large description box: write Markdown, attach (or paste / drop) pictures and PDFs. */
export function NoteBodyEditor({ draft, autoFocus, className }: { draft: NoteDraft; autoFocus?: boolean; className?: string }) {
  const [attaching, setAttaching] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);

  /** Save the files and insert them at the cursor (or at the end). */
  async function attach(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (!incoming.length) return;
    setAttaching(true);
    const snippets: string[] = [];
    for (const f of incoming) {
      try {
        const { id, markdown } = await addNoteFile(draft.noteId, f);
        draft.onAdded(id);
        snippets.push(markdown);
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    }
    setAttaching(false);
    if (!snippets.length) return;
    const insert = snippets.join('\n\n');
    const ta = editor.current;
    draft.setBody((prev) => {
      const at = ta && document.activeElement === ta ? ta.selectionEnd : prev.length;
      const before = prev.slice(0, at);
      const after = prev.slice(at);
      const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      const post = !after ? '\n' : after.startsWith('\n') ? '\n' : '\n\n';
      return before + pre + insert + post + after;
    });
  }

  const pick = (input: HTMLInputElement | null) => input?.click();
  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void attach(e.target.files);
    e.target.value = '';
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div
        className={cn('overflow-hidden rounded-2xl border border-line bg-surface transition-shadow focus-within:border-accent/50', dragging && 'ring-2 ring-accent/50')}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          setDragging(false);
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          void attach(e.dataTransfer.files);
        }}
      >
        <Textarea
          ref={editor}
          autoFocus={autoFocus}
          value={draft.body}
          onChange={(e) => draft.setBody(e.target.value)}
          onPaste={(e) => {
            // Pasted screenshots and copied files become attachments.
            const pasted = Array.from(e.clipboardData.files);
            if (pasted.length) {
              e.preventDefault();
              void attach(pasted);
            }
          }}
          className="min-h-[45dvh] resize-y rounded-none border-0 bg-transparent px-4 py-3 text-[15px] leading-relaxed shadow-none focus:ring-0 focus-visible:outline-none sm:min-h-80"
          placeholder={'Write your note…\n\nTip: # Heading, - bullet, **bold**. Paste or drop pictures and PDFs here.'}
          aria-label="Description"
        />
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-surface-2/60 px-2 py-1.5">
          <Button type="button" size="sm" variant="ghost" disabled={attaching} icon={<ImagePlus className="size-4" />} onClick={() => pick(photoInput.current)}>
            Photo
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={attaching} icon={attaching ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />} onClick={() => pick(fileInput.current)}>
            {attaching ? 'Adding…' : 'File or PDF'}
          </Button>
          <span className="ml-auto pr-1 text-xs text-muted">{draft.body.trim() ? `${draft.body.trim().split(/\s+/).length} words` : ''}</span>
        </div>
      </div>
      <input ref={photoInput} type="file" multiple accept="image/*" className="hidden" onChange={onFiles} />
      <input ref={fileInput} type="file" multiple accept={NOTE_FILE_ACCEPT} className="hidden" onChange={onFiles} />
      <NoteFileStrip files={draft.files} onRemove={(f) => draft.remove(f.id)} />
    </div>
  );
}

/** New note: title, subject, a large description and attachments. */
export function NoteForm({ onDone }: { onDone: (id: string) => void }) {
  const noteId = useMemo(() => uuid(), []);
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const draft = useNoteDraft(noteId, '');
  const [busy, setBusy] = useState(false);
  const saved = useRef(false);

  // Closed without saving (Cancel, Back, tapping outside): drop the files attached here.
  const discard = useRef(draft.discard);
  discard.current = draft.discard;
  useEffect(() => () => void (saved.current || discard.current()), []);

  const empty = !title.trim() && !draft.body.trim() && !draft.files.length;
  async function save() {
    setBusy(true);
    try {
      const firstLine = draft.body.trim().split('\n')[0]?.replace(/[#*_>`[\]!-]/g, '').trim();
      await create('note', { id: noteId, title: title.trim() || firstLine?.slice(0, 80) || 'Untitled', subjectId, body: draft.body });
      await draft.commit();
      saved.current = true;
      onDone(noteId);
    } catch (err) {
      console.error(err);
      toast("Couldn't save the note. Try again.", 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" className="h-11 text-base font-semibold" />
      <Field label="Subject">
        <SubjectSelect value={subjectId} onChange={setSubjectId} />
      </Field>
      <NoteBodyEditor draft={draft} />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={() => onDone('')}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={empty}>
          Save note
        </Button>
      </div>
    </form>
  );
}
