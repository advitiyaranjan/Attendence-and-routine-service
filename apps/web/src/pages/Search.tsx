import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Search as SearchIcon } from 'lucide-react';
import { fmtPct, formatTime12, WEEKDAYS } from '@student-os/core';
import { Card, Input, PageHeader, SubjectDot } from '../components/ui';
import { useAll, useAttendance } from '../lib/hooks';

const FILLER = new Set(['show', 'me', 'everything', 'all', 'related', 'to', 'about', 'for', 'the', 'my', 'stuff', 'things', 'on', 'of', 'find', 'search']);

interface Hit {
  group: string;
  title: string;
  detail?: string;
  href: string;
  color?: string;
}

/** Local, offline global search. Natural phrasing like "show everything related to operating systems" works too. */
export default function Search() {
  const [q, setQ] = useState('');
  const subjects = useAll('subject') ?? [];
  const schedules = useAll('classSchedule') ?? [];
  const tasks = useAll('task') ?? [];
  const notes = useAll('note') ?? [];
  const topics = useAll('topic') ?? [];
  const revisions = useAll('revisionSchedule') ?? [];
  const exams = useAll('exam') ?? [];
  const assignments = useAll('assignment') ?? [];
  const flashcards = useAll('flashcard') ?? [];
  const att = useAttendance();

  const hits = useMemo(() => {
    const terms = q
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w && !FILLER.has(w));
    if (!terms.length) return [];
    const phrase = terms.join(' ');
    const matches = (...texts: Array<string | null | undefined>) => {
      const hay = texts.filter(Boolean).join(' ').toLowerCase();
      return hay.includes(phrase) || terms.every((t) => hay.includes(t));
    };
    // Subjects matching the query pull in everything linked to them.
    const subjectIds = new Set(subjects.filter((s) => matches(s.name, s.code, s.faculty)).map((s) => s.id));
    const linked = (id: string | null) => !!id && subjectIds.has(id);
    const sub = (id: string | null) => subjects.find((s) => s.id === id);
    const topicTitle = new Map(topics.map((t) => [t.id, t.title]));
    const out: Hit[] = [];

    for (const s of subjects.filter((s) => subjectIds.has(s.id))) {
      const a = att?.subjects.find((x) => x.subject.id === s.id)?.summary;
      out.push({ group: 'Subjects', title: s.name, detail: a ? `Attendance ${fmtPct(a.percent)} · ${a.present}/${a.conducted}` : s.code ?? undefined, href: '/subjects', color: s.color });
    }
    for (const c of schedules.filter((c) => linked(c.subjectId) || matches(c.room, c.faculty))) {
      out.push({ group: 'Classes', title: `${sub(c.subjectId)?.name ?? 'Class'} — ${WEEKDAYS[c.weekday]![0]!.toUpperCase()}${WEEKDAYS[c.weekday]!.slice(1)}`, detail: `${formatTime12(c.startTime)}${c.room ? ` · ${c.room}` : ''}`, href: '/classes', color: sub(c.subjectId)?.color });
    }
    for (const t of tasks.filter((t) => linked(t.subjectId) || matches(t.title, t.notes, t.category))) {
      out.push({ group: 'Tasks', title: t.title, detail: `${t.status === 'done' ? 'Done' : t.dueDate ? `Due ${t.dueDate}` : t.category}`, href: '/tasks' });
    }
    for (const t of topics.filter((t) => linked(t.subjectId) || matches(t.title, t.notes))) {
      const next = revisions.filter((r) => r.topicId === t.id && r.status === 'pending').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
      out.push({ group: 'Topics & revision', title: t.title, detail: t.mastered ? 'Mastered' : next ? `Next revision ${next.dueDate}` : undefined, href: '/revision' });
    }
    for (const n of notes.filter((n) => linked(n.subjectId) || matches(n.title, n.body))) {
      out.push({ group: 'Notes', title: n.title, detail: n.body.slice(0, 80), href: `/notes?open=${n.id}` });
    }
    for (const e of exams.filter((e) => linked(e.subjectId) || matches(e.title, e.topics))) {
      out.push({ group: 'Exams', title: e.title, detail: e.date, href: '/deadlines' });
    }
    for (const a of assignments.filter((a) => linked(a.subjectId) || matches(a.title, a.description))) {
      out.push({ group: 'Assignments', title: a.title, detail: `Due ${a.deadline}`, href: '/deadlines' });
    }
    for (const f of flashcards.filter((f) => linked(f.subjectId) || matches(f.front, f.back))) {
      out.push({ group: 'Flashcards', title: f.front, detail: f.topicId ? topicTitle.get(f.topicId) : undefined, href: '/revision' });
    }
    return out;
  }, [q, subjects, schedules, tasks, notes, topics, revisions, exams, assignments, flashcards, att]);

  const groups = [...new Set(hits.map((h) => h.group))];

  return (
    <div className="space-y-5">
      <PageHeader title="Search" />
      <div className="relative">
        <SearchIcon className="absolute left-3 top-3 size-4 text-muted" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder='Try "DBMS" or "show everything related to operating systems"' className="pl-9" aria-label="Search" />
      </div>
      {q && hits.length === 0 && <p className="text-sm text-ink-2">No results.</p>}
      {groups.map((g) => (
        <Card key={g}>
          <h2 className="mb-2 text-sm font-semibold text-ink-2">
            {g} <span className="font-normal text-muted">({hits.filter((h) => h.group === g).length})</span>
          </h2>
          <ul className="divide-y divide-line">
            {hits
              .filter((h) => h.group === g)
              .slice(0, 20)
              .map((h, i) => (
                <li key={i}>
                  <Link to={h.href} className="flex items-center gap-2 py-2 hover:underline">
                    {h.color && <SubjectDot color={h.color} />}
                    <span className="text-sm">{h.title}</span>
                    {h.detail && <span className="truncate text-xs text-muted">· {h.detail}</span>}
                  </Link>
                </li>
              ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
