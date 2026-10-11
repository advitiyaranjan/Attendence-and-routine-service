import { describe, expect, it } from 'vitest';
import { currentMilestone, goalHealth, goalProgress, goalSchema, milestoneProgress, milestoneSchema, milestoneState, taskSchema, type Goal, type Milestone, type Task } from './index';

const meta = (id: string) => ({ id, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null, version: 0, deviceId: 'd', syncStatus: 'synced' as const });
const goal = (p: Partial<Goal> = {}): Goal => goalSchema.parse({ ...meta('g'), title: 'Internship', startDate: '2026-01-01', targetDate: '2026-12-31', ...p });
const ms = (id: string, order: number, p: Partial<Milestone> = {}): Milestone => milestoneSchema.parse({ ...meta(id), goalId: 'g', title: id, order, ...p });
const task = (id: string, p: Partial<Task> = {}): Task => taskSchema.parse({ ...meta(id), title: id, ...p });

describe('goal progress', () => {
  it('derives milestone progress from its tasks, and done wins', () => {
    const m = ms('m1', 0);
    const tasks = [task('a', { milestoneId: 'm1', status: 'done' }), task('b', { milestoneId: 'm1' })];
    expect(milestoneProgress(m, tasks)).toMatchObject({ percent: 50, source: 'tasks' });
    expect(milestoneProgress({ ...m, status: 'done' }, tasks).percent).toBe(100);
    expect(milestoneProgress({ ...m, manualProgress: 30 }, []).percent).toBe(30);
    // Manual progress is ignored once the milestone has tasks.
    expect(milestoneProgress({ ...m, manualProgress: 90 }, tasks).percent).toBe(50);
  });

  it('weights milestones equally and counts each task once', () => {
    const g = goal();
    const milestones = [ms('m1', 0, { status: 'done' }), ms('m2', 1)];
    // A task with both goalId and milestoneId counts only inside its milestone.
    const tasks = [task('a', { goalId: 'g', milestoneId: 'm2', status: 'done' }), task('b', { goalId: 'g', milestoneId: 'm2' })];
    const p = goalProgress(g, milestones, tasks);
    expect(p.percent).toBe(75);
    expect(p).toMatchObject({ milestonesDone: 1, milestonesTotal: 2, tasksDone: 1, tasksTotal: 2 });
  });

  it('treats tasks with no milestone as one extra unit', () => {
    const tasks = [task('a', { goalId: 'g', status: 'done' }), task('b', { goalId: 'g' })];
    expect(goalProgress(goal(), [ms('m1', 0)], tasks).percent).toBe(25);
    expect(goalProgress(goal(), [], tasks).percent).toBe(50);
  });

  it('reopening a task lowers progress again', () => {
    const milestones = [ms('m1', 0)];
    expect(goalProgress(goal(), milestones, [task('a', { milestoneId: 'm1', status: 'done' })]).percent).toBe(100);
    expect(goalProgress(goal(), milestones, [task('a', { milestoneId: 'm1', status: 'todo' })]).percent).toBe(0);
  });

  it('uses the manual figure in manual mode and 100 when completed', () => {
    expect(goalProgress(goal({ progressMode: 'manual', manualProgress: 40 }), [ms('m1', 0)], []).percent).toBe(40);
    expect(goalProgress(goal({ status: 'completed' }), [ms('m1', 0)], []).percent).toBe(100);
  });

  it('ignores milestones of other goals', () => {
    expect(goalProgress(goal(), [ms('m1', 0, { goalId: 'other', status: 'done' })], []).percent).toBe(0);
  });
});

describe('roadmap', () => {
  it('handles milestones completed out of order', () => {
    const milestones = [ms('m1', 0), ms('m2', 1, { status: 'done' }), ms('m3', 2)];
    expect(currentMilestone(milestones)?.id).toBe('m1');
    expect(milestoneState(milestones[1]!, '2026-03-01', 'm1')).toBe('done');
    expect(milestoneState(milestones[0]!, '2026-03-01', 'm1')).toBe('active');
    expect(milestoneState(milestones[2]!, '2026-03-01', 'm1')).toBe('upcoming');
  });

  it('prefers a milestone marked in progress as current', () => {
    expect(currentMilestone([ms('m1', 0), ms('m2', 1, { status: 'in_progress' })])?.id).toBe('m2');
  });

  it('marks past-date open milestones overdue, and blocked ones blocked', () => {
    expect(milestoneState(ms('m1', 0, { targetDate: '2026-02-01' }), '2026-03-01', null)).toBe('overdue');
    expect(milestoneState(ms('m1', 0, { status: 'blocked', targetDate: '2026-02-01' }), '2026-03-01', null)).toBe('blocked');
  });
});

describe('goal health', () => {
  const g = goal({ startDate: '2026-01-01', targetDate: '2026-01-31' });
  const prog = (percent: number) => ({ percent, mode: 'auto' as const, milestonesDone: 0, milestonesTotal: 0, tasksDone: 0, tasksTotal: 0 });

  it('is on track when progress keeps up with time', () => {
    expect(goalHealth(g, prog(50), [], '2026-01-16').level).toBe('on_track');
  });

  it('does not call a goal on track from progress alone when milestones are overdue', () => {
    const late = [ms('m1', 0, { targetDate: '2026-01-05' }), ms('m2', 1, { targetDate: '2026-01-06' })];
    expect(goalHealth(g, prog(60), late, '2026-01-16').level).toBe('behind');
    expect(goalHealth(g, prog(60), late.slice(0, 1), '2026-01-16').level).toBe('attention');
  });

  it('flags slow progress', () => {
    expect(goalHealth(g, prog(10), [], '2026-01-21').level).toBe('behind');
    expect(goalHealth(g, prog(45), [], '2026-01-19').level).toBe('attention');
  });

  it('shows a missed target as overdue, not failed, and paused/completed as such', () => {
    const h = goalHealth(g, prog(80), [], '2026-02-05');
    expect(h.level).toBe('overdue');
    expect(h.reasons[0]).toMatch(/Reschedule/);
    expect(goalHealth({ ...g, status: 'paused' }, prog(0), [], '2026-02-05').level).toBe('paused');
    expect(goalHealth({ ...g, status: 'completed' }, prog(100), [], '2026-02-05').level).toBe('completed');
  });

  it('asks for a target date when there is none', () => {
    expect(goalHealth(goal({ targetDate: null }), prog(0), [], '2026-02-05').level).toBe('no_deadline');
  });
});
