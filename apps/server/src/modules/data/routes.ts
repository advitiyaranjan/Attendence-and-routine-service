/**
 * Read-only REST access to synced data (for integrations and the web dashboard).
 * Writes go through POST /api/sync so offline and online edits share one path.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { EntityName } from '@student-os/core';
import { prisma } from '../../db';
import { HttpError, parseBody } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { storeFor, type Tx } from '../sync/store';

export const dataRouter = Router();
dataRouter.use(requireAuth);

const COLLECTIONS: Record<string, Exclude<EntityName, 'settings'>> = {
  baskets: 'basket',
  subjects: 'subject',
  classes: 'classSchedule',
  'class-instances': 'classInstance',
  attendance: 'attendanceRecord',
  tasks: 'task',
  calendar: 'calendarEvent',
  'study-sessions': 'studySession',
  topics: 'topic',
  revisions: 'revisionSchedule',
  exams: 'exam',
  assignments: 'assignment',
  notes: 'note',
  flashcards: 'flashcard',
  quizzes: 'quizAttempt',
  'daily-reviews': 'dailyReview',
  reminders: 'reminder',
  'ai-activity': 'aiActionLog',
};

const query = z.object({
  includeDeleted: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

dataRouter.get('/settings', async (req, res) => {
  const [settings] = await storeFor('settings').findMany(prisma as unknown as Tx, req.userId!, []);
  res.json({ data: settings ?? null });
});

dataRouter.get('/:collection', async (req, res) => {
  const entity = COLLECTIONS[req.params.collection as string];
  if (!entity) throw new HttpError(404, 'not_found', 'Unknown collection');
  const { includeDeleted, limit } = parseBody(query, req.query);
  const delegate = (prisma as unknown as Record<string, { findMany(a: unknown): Promise<{ id: string }[]> }>)[entity]!;
  const rows = await delegate.findMany({
    where: { userId: req.userId!, ...(includeDeleted === 'true' ? {} : { deletedAt: null }) },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { id: true },
  });
  const data = await storeFor(entity).findMany(prisma as unknown as Tx, req.userId!, rows.map((r) => r.id));
  res.json({ data });
});
