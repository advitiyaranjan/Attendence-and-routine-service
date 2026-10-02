import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import type { Note, ReviewSummary } from '@student-os/core';
import { NoteForm, SubjectSelect } from '../components/forms';
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, SubjectDot, Tabs, Textarea, cn } from '../components/ui';
import { flashcards, summarizeNote } from '../lib/ai';
import { errorMessage } from '../lib/api';
import { useAll, useSubjectMap } from '../lib/hooks';
import { createMany, remove, update } from '../lib/repo';
import { toast, useApp } from '../lib/store';

export default function Notes() {
  const notes = (useAll('note') ?? []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const subjects = useSubjectMap();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const openId = params.get('open');
  const open = notes.find((n) => n.id === openId) ?? null;
  const filtered = notes.filter((n) => !query || `${n.title} ${n.body}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notes"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Note
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[16rem_1fr]">
        <div className={cn('space-y-2', open && 'hidden md:block')}>
          <Input placeholder="Filter notes" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter notes" />
          {filtered.length === 0 && <p className="p-2 text-sm text-ink-2">No notes.</p>}
          <ul className="space-y-1">
            {filtered.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => setParams({ open: n.id })}
                  className={cn('w-full rounded-lg px-3 py-2 text-left hover:bg-surface-2', n.id === openId && 'bg-surface-2')}
                >
                  <div className="flex items-center gap-2 truncate text-sm font-medium">
                    {n.subjectId && <SubjectDot color={subjects.get(n.subjectId)?.color ?? '#888'} />} {n.title}
                  </div>
                  <div className="truncate text-xs text-muted">{n.body.slice(0, 80) || 'Empty note'}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          {open ? (
            <NoteEditor key={open.id} note={open} onClose={() => setParams({})} />
          ) : (
            <EmptyState title="Select or create a note" body="Notes support Markdown. Link them to a topic so AI flashcards and quizzes can use them." />
          )}
        </div>
      </div>
      <Modal open={creating} onClose={() => setCreating(false)} title="New note">
        <NoteForm
          onDone={(id) => {
            setCreating(false);
            if (id) setParams({ open: id });
          }}
        />
      </Modal>
    </div>
  );
}

function NoteEditor({ note, onClose }: { note: Note; onClose: () => void }) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [mode, setMode] = useState<'write' | 'preview'>(note.body ? 'preview' : 'write');
  const [ai, setAi] = useState<ReviewSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const topics = useAll('topic') ?? [];
  const online = useApp((s) => s.online);

  // Debounced autosave; every save is a local write that syncs in the background.
  useEffect(() => {
    if (title === note.title && body === note.body) return;
    const t = setTimeout(() => void update('note', note.id, { title: title.trim() || 'Untitled', body }), 600);
    return () => clearTimeout(t);
  }, [title, body, note]);

  async function summarize() {
    setBusy('summary');
    try {
      setAi(await summarizeNote(title, body));
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function makeCards() {
    setBusy('cards');
    try {
      const res = await flashcards(title, body, 10);
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

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" className="md:hidden" onClick={onClose}>
          ← Notes
        </Button>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 flex-1 border-0 px-0 text-lg font-semibold" aria-label="Title" />
        <Button
          size="sm"
          variant="ghost"
          aria-label="Delete note"
          onClick={async () => {
            if (!confirm('Delete this note?')) return;
            await remove('note', note.id);
            onClose();
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Subject">
          <SubjectSelect value={note.subjectId} onChange={(v) => void update('note', note.id, { subjectId: v })} />
        </Field>
        <Field label="Topic">
          <Select value={note.topicId ?? ''} onChange={(e) => void update('note', note.id, { topicId: e.target.value || null })}>
            <option value="">None</option>
            {topics
              .filter((t) => !note.subjectId || t.subjectId === note.subjectId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={mode}
          onChange={setMode}
          options={[
            { value: 'write', label: 'Write' },
            { value: 'preview', label: 'Preview' },
          ]}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={!online || !body.trim()} loading={busy === 'summary'} icon={<Sparkles className="size-4" />} onClick={summarize}>
            Summarise
          </Button>
          <Button size="sm" variant="secondary" disabled={!online || !body.trim()} loading={busy === 'cards'} onClick={makeCards}>
            Flashcards
          </Button>
        </div>
      </div>
      {mode === 'write' ? (
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-80 font-mono text-[13px]" placeholder="# Heading&#10;- Key point" aria-label="Note body" />
      ) : (
        <div className="prose-sm min-h-40 text-sm" onDoubleClick={() => setMode('write')}>
          {body ? <ReactMarkdown>{body}</ReactMarkdown> : <p className="text-muted">Nothing written yet.</p>}
        </div>
      )}
      {ai && (
        <div className="rounded-lg bg-surface-2 p-3 text-sm">
          <div className="mb-1 flex items-center gap-1 font-medium">
            <Sparkles className="size-4 text-accent" /> AI summary
          </div>
          <div className="prose-sm">
            <ReactMarkdown>{ai.summary}</ReactMarkdown>
          </div>
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
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => {
              setBody(`${body}\n\n## AI revision points\n${ai.highlights.map((h) => `- ${h}`).join('\n')}`);
              setAi(null);
            }}
          >
            Append revision points to note
          </Button>
        </div>
      )}
    </Card>
  );
}
