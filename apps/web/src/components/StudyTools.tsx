/** AI flashcards and quizzes for a topic. */
import { useState } from 'react';
import { Check, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { applyRating, RATING_LABEL, todayISO, type Flashcard, type QuizResponse, type RecallRating, type Topic } from '@student-os/core';
import { flashcards as genFlashcards, quiz as genQuiz } from '../lib/ai';
import { errorMessage } from '../lib/api';
import { db } from '../lib/db';
import { useAll } from '../lib/hooks';
import { create, createMany, getSettings, remove, update } from '../lib/repo';
import { toast, useApp } from '../lib/store';
import { Button, cn, Field, Modal, Select, Textarea } from './ui';

async function topicNotes(topic: Topic) {
  const notes = (await db.entity('note').where('topicId').equals(topic.id).toArray()).filter((n) => !n.deletedAt);
  return [topic.notes ?? '', ...notes.map((n) => n.body)].join('\n\n').slice(0, 20_000) || undefined;
}

export function FlashcardsPanel({ topic }: { topic: Topic }) {
  const cards = (useAll('flashcard') ?? []).filter((c) => c.topicId === topic.id);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Array<{ question: string; answer: string }> | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const online = useApp((s) => s.online);
  const due = cards.filter((c) => !c.dueDate || c.dueDate <= todayISO());

  async function generate() {
    setBusy(true);
    try {
      const res = await genFlashcards(topic.title, await topicNotes(topic), 10);
      setDraft(res.cards);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" loading={busy} disabled={!online} icon={<Sparkles className="size-4" />} onClick={generate}>
          Generate flashcards
        </Button>
        {cards.length > 0 && (
          <Button size="sm" variant="primary" onClick={() => setReviewing(true)} disabled={due.length === 0}>
            Review {due.length} due
          </Button>
        )}
      </div>
      {!online && <p className="text-xs text-muted">AI requires an internet connection. Your saved cards are still available.</p>}
      {cards.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {cards.map((c) => (
            <li key={c.id} className="flex items-start gap-2 p-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{c.front}</div>
                <div className="text-ink-2">{c.back}</div>
              </div>
              <span className="shrink-0 text-xs text-muted">{c.dueDate ? `due ${c.dueDate}` : 'new'}</span>
              <button aria-label="Delete card" className="text-muted hover:text-ink" onClick={() => void remove('flashcard', c.id)}>
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title="Review generated flashcards"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!draft?.length}
              onClick={async () => {
                await createMany(
                  'flashcard',
                  draft!.map((c) => ({ topicId: topic.id, subjectId: topic.subjectId, front: c.question, back: c.answer, dueDate: todayISO() })),
                );
                toast(`Saved ${draft!.length} flashcards`, 'success');
                setDraft(null);
              }}
            >
              Save {draft?.length} cards
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          {draft?.map((c, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_1fr_auto]">
              <Textarea aria-label="Question" value={c.question} onChange={(e) => setDraft(draft.map((d, j) => (j === i ? { ...d, question: e.target.value } : d)))} className="min-h-16" />
              <Textarea aria-label="Answer" value={c.answer} onChange={(e) => setDraft(draft.map((d, j) => (j === i ? { ...d, answer: e.target.value } : d)))} className="min-h-16" />
              <Button size="sm" variant="ghost" aria-label="Remove card" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </Modal>

      {reviewing && <FlashcardReview cards={due} onClose={() => setReviewing(false)} />}
    </div>
  );
}

function FlashcardReview({ cards, onClose }: { cards: Flashcard[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[index];

  async function rate(r: RecallRating) {
    if (!card) return;
    const settings = await getSettings();
    const out = applyRating({ stage: card.stage, ease: card.ease }, card.stage + 1, r, todayISO(), settings.revisionIntervals);
    await update('flashcard', card.id, { stage: out.state.stage, ease: out.state.ease, dueDate: out.upcoming[0]?.dueDate ?? null });
    setFlipped(false);
    if (index + 1 >= cards.length) {
      toast('Flashcard review complete', 'success');
      onClose();
    } else setIndex(index + 1);
  }

  return (
    <Modal open onClose={onClose} title={`Flashcards ${Math.min(index + 1, cards.length)}/${cards.length}`}>
      {card && (
        <div className="space-y-4">
          <button onClick={() => setFlipped((f) => !f)} className="block min-h-40 w-full rounded-xl border border-line bg-surface-2 p-5 text-left">
            <div className="text-xs text-muted">{flipped ? 'Answer' : 'Question — tap to reveal'}</div>
            <div className="mt-2 text-lg">{flipped ? card.back : card.front}</div>
          </button>
          {flipped ? <RatingRow onRate={rate} /> : <Button className="w-full" onClick={() => setFlipped(true)}>Show answer</Button>}
        </div>
      )}
    </Modal>
  );
}

function RatingRow({ onRate }: { onRate: (r: RecallRating) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {(Object.keys(RATING_LABEL) as RecallRating[]).map((r) => (
        <Button key={r} variant="secondary" onClick={() => onRate(r)} className="h-auto flex-col py-2">
          <span className="text-lg">{RATING_LABEL[r].emoji}</span>
          <span className="text-xs">{RATING_LABEL[r].label}</span>
        </Button>
      ))}
    </div>
  );
}

export function QuizPanel({ topic }: { topic: Topic }) {
  const [count, setCount] = useState<5 | 10 | 20>(5);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard' | 'mixed'>('mixed');
  const [busy, setBusy] = useState(false);
  const [quiz, setQuiz] = useState<QuizResponse | null>(null);
  const attempts = (useAll('quizAttempt') ?? []).filter((a) => a.topicId === topic.id).sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  const online = useApp((s) => s.online);

  async function start() {
    setBusy(true);
    try {
      setQuiz(await genQuiz(topic.title, count, difficulty, await topicNotes(topic)));
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Questions">
          <Select value={count} onChange={(e) => setCount(Number(e.target.value) as 5 | 10 | 20)} className="w-24">
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
          </Select>
        </Field>
        <Field label="Difficulty">
          <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)} className="w-28">
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
            <option value="mixed">Mixed</option>
          </Select>
        </Field>
        <Button size="sm" variant="secondary" className="h-10" loading={busy} disabled={!online} icon={<Sparkles className="size-4" />} onClick={start}>
          Generate quiz
        </Button>
      </div>
      {attempts.length > 0 && (
        <div className="text-sm">
          <div className="mb-1 text-xs font-medium text-ink-2">Attempts</div>
          <ul className="space-y-0.5 text-ink-2">
            {attempts.slice(0, 5).map((a) => (
              <li key={a.id} className="tabular">
                {a.takenAt.slice(0, 10)} · {a.correct}/{a.total} ({Math.round((a.correct / Math.max(1, a.total)) * 100)}%) · {a.difficulty}
              </li>
            ))}
          </ul>
        </div>
      )}
      {quiz && <QuizRunner quiz={quiz} topic={topic} difficulty={difficulty} onClose={() => setQuiz(null)} />}
    </div>
  );
}

export function QuizRunner({ quiz, topic, difficulty, onClose }: { quiz: QuizResponse; topic: { id: string | null; subjectId: string | null; title: string }; difficulty: 'easy' | 'medium' | 'hard' | 'mixed'; onClose: () => void }) {
  const [answers, setAnswers] = useState<Array<number | null>>(quiz.questions.map(() => null));
  const [submitted, setSubmitted] = useState(false);
  const correct = quiz.questions.filter((q, i) => answers[i] === q.answerIndex).length;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Quiz: ${topic.title}`}
      wide
      footer={
        submitted ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={answers.some((a) => a === null)}
            onClick={async () => {
              setSubmitted(true);
              await create('quizAttempt', {
                topicId: topic.id,
                subjectId: topic.subjectId,
                title: topic.title,
                difficulty,
                total: quiz.questions.length,
                correct,
                takenAt: new Date().toISOString(),
              });
            }}
          >
            Submit
          </Button>
        )
      }
    >
      {submitted && (
        <div className="mb-4 rounded-lg bg-surface-2 p-3 text-sm">
          Score: <strong>{correct}/{quiz.questions.length}</strong> ({Math.round((correct / quiz.questions.length) * 100)}%)
          {correct / quiz.questions.length < 0.6 && ' — consider an extra revision of this topic.'}
        </div>
      )}
      <ol className="space-y-5">
        {quiz.questions.map((q, i) => (
          <li key={i}>
            <p className="mb-2 text-sm font-medium">
              {i + 1}. {q.question}
            </p>
            <div className="grid gap-1.5">
              {q.options.map((opt, j) => {
                const chosen = answers[i] === j;
                const right = submitted && j === q.answerIndex;
                const wrong = submitted && chosen && j !== q.answerIndex;
                return (
                  <button
                    key={j}
                    disabled={submitted}
                    onClick={() => setAnswers(answers.map((a, k) => (k === i ? j : a)))}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm',
                      chosen && !submitted ? 'border-accent bg-accent-soft' : 'border-line',
                      right && 'border-good',
                      wrong && 'border-critical',
                    )}
                  >
                    {right && <Check className="size-4 shrink-0" style={{ color: 'var(--color-good)' }} />}
                    {wrong && <X className="size-4 shrink-0" style={{ color: 'var(--color-critical)' }} />}
                    {opt}
                  </button>
                );
              })}
            </div>
            {submitted && q.explanation && <p className="mt-1 text-xs text-ink-2">{q.explanation}</p>}
          </li>
        ))}
      </ol>
      {submitted && (
        <Button variant="ghost" size="sm" className="mt-3" icon={<RotateCcw className="size-4" />} onClick={() => { setAnswers(quiz.questions.map(() => null)); setSubmitted(false); }}>
          Retry
        </Button>
      )}
    </Modal>
  );
}
