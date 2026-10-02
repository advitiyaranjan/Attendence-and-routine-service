import { useState } from 'react';
import { Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { diffDays, formatMinutes, type Assignment, type Exam } from '@student-os/core';
import { AssignmentForm, ExamForm } from '../components/forms';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Select, Stat, SubjectDot, cn } from '../components/ui';
import { useCopilot } from '../lib/copilot/store';
import { useAll, useSubjectMap, useToday } from '../lib/hooks';
import { remove, update } from '../lib/repo';
import { useApp } from '../lib/store';
import { countdown } from './Dashboard';

export default function Deadlines() {
  const today = useToday();
  const subjects = useSubjectMap();
  const exams = useAll('exam') ?? [];
  const assignments = useAll('assignment') ?? [];
  const [editingExam, setEditingExam] = useState<Exam | 'new' | null>(null);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | 'new' | null>(null);
  const online = useApp((s) => s.online);

  const open = assignments.filter((a) => a.status !== 'submitted');
  const dueToday = open.filter((a) => a.deadline === today).length;
  const dueWeek = open.filter((a) => a.deadline >= today && diffDays(today, a.deadline) <= 7).length;
  const overdue = open.filter((a) => a.deadline < today).length;
  const upcomingExams = exams.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const pastExams = exams.filter((e) => e.date < today).sort((a, b) => b.date.localeCompare(a.date));

  function makePlan(exam: Exam) {
    const subject = exam.subjectId ? subjects.get(exam.subjectId)?.name : null;
    useCopilot.getState().setOpen(true);
    void useCopilot
      .getState()
      .send(
        `Create a preparation plan for "${exam.title}"${subject ? ` (${subject})` : ''} on ${exam.date}, ${diffDays(today, exam.date)} days from today.` +
          (exam.topics ? ` Syllabus: ${exam.topics}.` : '') +
          ' Include study sessions, revision sessions and at least one practice test, avoiding my classes.',
      );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Exams & Assignments" subtitle="Countdowns, preparation and submission status." />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Due today" value={dueToday} />
        <Stat label="Due this week" value={dueWeek} />
        <Stat label="Overdue" value={overdue} />
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-2">Exams</h2>
          <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setEditingExam('new')}>
            Exam
          </Button>
        </div>
        {upcomingExams.length === 0 && <EmptyState title="No upcoming exams" />}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {upcomingExams.map((e) => {
            const days = diffDays(today, e.date);
            const subject = e.subjectId ? subjects.get(e.subjectId) : undefined;
            return (
              <Card key={e.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium">
                      {subject && <SubjectDot color={subject.color} />} {e.title}
                    </div>
                    <div className="text-xs text-ink-2">
                      {e.date}
                      {e.startTime && ` · ${e.startTime}`}
                      {e.room && ` · ${e.room}`} · <span className="capitalize">{e.kind}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-semibold tabular">{days}</div>
                    <div className="text-xs text-muted">{days === 1 ? 'day' : 'days'} left</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={!online} icon={<Sparkles className="size-4" />} onClick={() => void makePlan(e)}>
                    Preparation plan
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Edit exam" onClick={() => setEditingExam(e)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Delete exam"
                    onClick={async () => {
                      if (confirm(`Delete ${e.title}?`)) await remove('exam', e.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
        {pastExams.length > 0 && <p className="text-xs text-muted">{pastExams.length} past exam(s) hidden.</p>}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-2">Assignments</h2>
          <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setEditingAssignment('new')}>
            Assignment
          </Button>
        </div>
        {assignments.length === 0 && <EmptyState title="No assignments" />}
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {assignments
              .slice()
              .sort((a, b) => Number(a.status === 'submitted') - Number(b.status === 'submitted') || a.deadline.localeCompare(b.deadline))
              .map((a) => {
                const subject = a.subjectId ? subjects.get(a.subjectId) : undefined;
                const days = diffDays(today, a.deadline);
                return (
                  <li key={a.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3', a.status === 'submitted' && 'opacity-60')}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {subject && <SubjectDot color={subject.color} />} {a.title}
                      </div>
                      <div className="text-xs text-muted">
                        {subject?.name ?? 'No subject'} · {a.priority} priority
                        {a.estimatedMinutes ? ` · ~${formatMinutes(a.estimatedMinutes)}` : ''}
                      </div>
                    </div>
                    <Badge className={cn(days < 0 && a.status !== 'submitted' && 'text-critical-ink')}>{a.status === 'submitted' ? 'Submitted' : countdown(days)}</Badge>
                    <Select
                      value={a.status}
                      onChange={(e) => void update('assignment', a.id, { status: e.target.value as Assignment['status'] })}
                      className="h-8 w-32"
                      aria-label="Status"
                    >
                      <option value="todo">To do</option>
                      <option value="in_progress">In progress</option>
                      <option value="submitted">Submitted</option>
                    </Select>
                    <Button size="sm" variant="ghost" aria-label="Edit assignment" onClick={() => setEditingAssignment(a)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Delete assignment"
                      onClick={async () => {
                        if (confirm(`Delete ${a.title}?`)) await remove('assignment', a.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                );
              })}
          </ul>
        </Card>
      </section>

      <Modal open={!!editingExam} onClose={() => setEditingExam(null)} title={editingExam === 'new' ? 'New exam' : 'Edit exam'}>
        {editingExam && <ExamForm initial={editingExam === 'new' ? undefined : editingExam} onDone={() => setEditingExam(null)} />}
      </Modal>
      <Modal open={!!editingAssignment} onClose={() => setEditingAssignment(null)} title={editingAssignment === 'new' ? 'New assignment' : 'Edit assignment'}>
        {editingAssignment && <AssignmentForm initial={editingAssignment === 'new' ? undefined : editingAssignment} onDone={() => setEditingAssignment(null)} />}
      </Modal>
    </div>
  );
}
