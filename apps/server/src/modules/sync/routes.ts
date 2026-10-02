import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { syncRequestSchema } from '@student-os/core';
import { prisma } from '../../db';
import { parseBody } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { SyncService } from './service';

export const syncRouter = Router();
const service = new SyncService(prisma);

syncRouter.use(requireAuth);
syncRouter.use(rateLimit({ windowMs: 60_000, limit: 120, keyGenerator: (req) => req.userId!, standardHeaders: 'draft-7', legacyHeaders: false }));

/**
 * POST /api/sync
 * Push queued offline operations, then pull everything changed since `cursor`.
 */
syncRouter.post('/', async (req, res) => {
  const body = parseBody(syncRequestSchema, req.body);
  res.json(await service.sync(req.userId!, body, req.get('user-agent')));
});

/** GET /api/sync/conflicts — recent conflicts, so nothing is ever silently lost. */
syncRouter.get('/conflicts', async (req, res) => {
  const conflicts = await prisma.conflictLog.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({ conflicts });
});
