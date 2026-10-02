import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { addDays, diffDays, RATING_LABEL, type RecallRating, type RevisionSchedule, type Topic } from '@student-os/core';
import { TopicForm } from '../components/forms';
import { FlashcardsPanel, QuizPanel } from '../components/StudyTools';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Stat, SubjectDot, Tabs } from '../components/ui';
import { completeRevision } from '../lib/actions';
import { useAll, useSettings, useSubjectMap, useToday } from '../lib/hooks';
import { remove, removeMany } from '../lib/repo';
import { toast } from '../lib/store';

export function RatingButtons({ onRate }: { onRate: (r: RecallRating) => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(Object.keys(RATING_LABEL) as RecallRating[]).map((r) => (
          <Button
            key={r}
            variant="secondary"
            disabled={busy}
            className="h-auto flex-col py-3"
            onClick={async () => {
              setBusy(true);
              try {
                await onRate(r);
              } finally {
                setBusy(false);
              }
            }}
          >
            <span className="text-2xl">{RATING_LABEL[r].emoji}</span>
            <span className="text-xs">{RATING_LABEL[r].label}</span>
          </Button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">Forgot → tomorrow · Partially → 2 days · Remembered → next step · Easily → longer interval. Your schedule adapts over time.</p>
    </div>
  );
}

type Tab = 'due' | 'upcoming' | 'topics' | 'strength';

export default function Revision() {
  const [tab, setTab] = useState<Tab>('due');
  const [adding, setAdding] = useState(false);
  const [rating, setRating] = useState<RevisionSchedule | null>(null);
  const [openTopic, setOpenTopic] = useState<Topic | null>(null);
  const today = useToday();
  const settings = useSettings();
  const subjects = useSubjectMap();
  const revisions = useAll('revisionSchedule') ?? [];
  const topics = useAll('topic') ?? [];
  const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);

  const pending = revisions.filter((r) => r.status === 'pending' && topicById.has(r.topicId));
  const overdue = pending.filter((r) => r.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const dueToday = pending.filter((r) => r.dueDate === today);
  const upcoming = pending.filter((r) => r.dueDate > today && r.dueDate <= addDays(today, 30)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const mastered = topics.filter((t) => t.mastered);
  const recent = topics.filter((t) => t.learnedOn && diffDays(t.learnedOn, today) <= 7);
  const total = settings.revisionIntervals.length;

  const row = (r: RevisionSchedule, action = true) => {
    const topic = topicById.get(r.topicId)!;
    const subject = r.subjectId ? subjects.get(r.subjectId) : undefined;
    return (
      <li key={r.id} className="flex items-center gap-3 py-2">
        <SubjectDot color={subject?.color ?? '#888'} />
        <div className="min-w-0 flex-1">
          <button className="truncate text-left text-sm font-medium hover:underline" onClick={() => setOpenTopic(topic)}>
            {topic.title}
          </button>
          <div className="text-xs text-muted">
            {subject?.name ?? 'No subject'} · Revision {r.stage}/{total}
            {r.dueDate < today ? ` · ${diffDays(r.dueDate, today)}d overdue` : r.dueDate > today ? ` · ${r.dueDate}` : ''}
          </div>
        </div>
        {action && (
          <Button size="sm" variant={r.dueDate <= today ? 'primary' : 'secondary'} onClick={() => setRating(r)}>
            Revise
          </Button>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Revision"
        subtitle="Spaced repetition that adapts to how well you remember."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
            Topic learned
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Due today" value={dueToday.length} />
        <Stat label="Overdue" value={overdue.length} />
        <Stat label="Upcoming (30 days)" value={upcoming.length} />
        <Stat label="Mastered" value={mastered.length} sub={`${topics.length} topics total`} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'due', label: 'Due' },
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'topics', label: 'Topics' },
          { value: 'strength', label: 'Weak / strong' },
        ]}
      />

      {tab === 'due' && (
        <Card>
          {overdue.length + dueToday.length === 0 ? (
            <EmptyState title="Nothing due" body="Log what you learn with “Topic learned” and revisions appear here automatically." />
          ) : (
            <>
              {overdue.length > 0 && <h3 className="text-xs font-semibold text-critical-ink">Overdue</h3>}
              <ul className="divide-y divide-line">{overdue.map((r) => row(r))}</ul>
              {dueToday.length > 0 && <h3 className="mt-3 text-xs font-semibold text-ink-2">Due today</h3>}
              <ul className="divide-y divide-line">{dueToday.map((r) => row(r))}</ul>
            </>
          )}
          {recent.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <h3 className="mb-1 text-xs font-semibold text-ink-2">Recently learned</h3>
              <div className="flex flex-wrap gap-1.5">
                {recent.map((t) => (
                  <button key={t.id} onClick={() => setOpenTopic(t)}>
                    <Badge>{t.title}</Badge>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === 'upcoming' && (
        <Card>{upcoming.length === 0 ? <p className="text-sm text-ink-2">No revisions in the next 30 days.</p> : <ul className="divide-y divide-line">{upcoming.map((r) => row(r))}</ul>}</Card>
      )}

      {tab === 'topics' && <TopicTree topics={topics} revisions={pending} onOpen={setOpenTopic} />}

      {tab === 'strength' && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <h3 className="mb-2 text-sm font-semibold">Weak topics</h3>
            <p className="mb-2 text-xs text-muted">Topics you've forgotten or only partly remembered.</p>
            <StrengthList topics={topics.filter((t) => t.ease < 0.95 && !t.mastered).sort((a, b) => a.ease - b.ease)} onOpen={setOpenTopic} />
          </Card>
          <Card>
            <h3 className="mb-2 text-sm font-semibold">Strong topics</h3>
            <p className="mb-2 text-xs text-muted">Remembered easily or mastered.</p>
            <StrengthList topics={topics.filter((t) => t.ease > 1.05 || t.mastered).sort((a, b) => b.ease - a.ease)} onOpen={setOpenTopic} />
          </Card>
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Topic learned">
        <TopicForm onDone={() => setAdding(false)} />
      </Modal>

      <Modal open={!!rating} onClose={() => setRating(null)} title={`How well did you remember “${rating ? topicById.get(rating.topicId)?.title : ''}”?`}>
        <RatingButtons
          onRate={async (r) => {
            const msg = await completeRevision(rating!, r);
            toast(msg, 'success');
            setRating(null);
          }}
        />
      </Modal>

      {openTopic && <TopicDetail topic={openTopic} revisions={revisions.filter((r) => r.topicId === openTopic.id)} onClose={() => setOpenTopic(null)} />}
    </div>
  );
}

function StrengthList({ topics, onOpen }: { topics: Topic[]; onOpen: (t: Topic) => void }) {
  if (!topics.length) return <p className="text-sm text-ink-2">Not enough revision history yet.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {topics.slice(0, 15).map((t) => (
        <li key={t.id} className="flex justify-between gap-2">
          <button className="truncate text-left hover:underline" onClick={() => onOpen(t)}>
            {t.title}
          </button>
          <span className="shrink-0 text-xs text-muted">{t.mastered ? 'Mastered' : `ease ×${t.ease.toFixed(2)}`}</span>
        </li>
      ))}
    </ul>
  );
}

/** Subject → Chapter → Topic → Subtopic knowledge tree. */
function TopicTree({ topics, revisions, onOpen }: { topics: Topic[]; revisions: RevisionSchedule[]; onOpen: (t: Topic) => void }) {
  const subjects = useSubjectMap();
  const children = new Map<string | null, Topic[]>();
  for (const t of topics) {
    const parent = t.parentId && topics.some((p) => p.id === t.parentId) ? t.parentId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(t);
  }
  const roots = children.get(null) ?? [];
  const bySubject = new Map<string, Topic[]>();
  for (const t of roots) {
    const key = t.subjectId ?? '';
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key)!.push(t);
  }
  if (!topics.length) return <EmptyState title="No topics yet" body="Every topic you log becomes part of your knowledge tree." />;

  const nextDue = (id: string) => revisions.filter((r) => r.topicId === id).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]?.dueDate;

  function Node({ t, depth }: { t: Topic; depth: number }) {
    const [open, setOpen] = useState(true);
    const kids = children.get(t.id) ?? [];
    return (
      <li>
        <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: depth * 16 }}>
          {kids.length ? (
            <button onClick={() => setOpen(!open)} aria-label={open ? 'Collapse' : 'Expand'} className="text-muted">
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          ) : (
            <span className="w-3.5" />
          )}
          <button className="text-left text-sm hover:underline" onClick={() => onOpen(t)}>
            {t.title}
          </button>
          {t.mastered ? <Badge>Mastered</Badge> : nextDue(t.id) && <span className="text-xs text-muted">next {nextDue(t.id)}</span>}
        </div>
        {open && kids.length > 0 && (
          <ul>
            {kids.map((k) => (
              <Node key={k.id} t={k} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-3">
      {[...bySubject.entries()].map(([subjectId, list]) => (
        <Card key={subjectId}>
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <SubjectDot color={subjects.get(subjectId)?.color ?? '#888'} /> {subjects.get(subjectId)?.name ?? 'No subject'}
          </h3>
          <ul>
            {list.map((t) => (
              <Node key={t.id} t={t} depth={0} />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function TopicDetail({ topic, revisions, onClose }: { topic: Topic; revisions: RevisionSchedule[]; onClose: () => void }) {
  const [tab, setTab] = useState<'schedule' | 'flashcards' | 'quiz'>('schedule');
  const sorted = [...revisions].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return (
    <Modal open onClose={onClose} title={topic.title} wide>
      <div className="space-y-4">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'schedule', label: 'Schedule' },
            { value: 'flashcards', label: 'Flashcards' },
            { value: 'quiz', label: 'Quiz' },
          ]}
        />
        {tab === 'schedule' && (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">
              Learned {topic.learnedOn ?? '—'} · stage {topic.stage} · personal ease ×{topic.ease.toFixed(2)}
            </p>
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {sorted.map((r) => (
                <li key={r.id} className="flex justify-between px-3 py-1.5">
                  <span>Revision {r.stage}</span>
                  <span className="text-ink-2">
                    {r.status === 'done' ? `✓ ${r.completedAt?.slice(0, 10)} · ${r.rating ? RATING_LABEL[r.rating].label : ''}` : r.dueDate}
                  </span>
                </li>
              ))}
            </ul>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                if (!confirm(`Delete “${topic.title}” and its revision schedule?`)) return;
                await removeMany(
                  'revisionSchedule',
                  revisions.map((r) => r.id),
                );
                await remove('topic', topic.id);
                toast('Topic deleted', 'info');
                onClose();
              }}
            >
              Delete topic
            </Button>
          </div>
        )}
        {tab === 'flashcards' && <FlashcardsPanel topic={topic} />}
        {tab === 'quiz' && <QuizPanel topic={topic} />}
      </div>
    </Modal>
  );
}
