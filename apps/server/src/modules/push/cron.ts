import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '../../db';
import { env } from '../../env';
import { HttpError } from '../../lib/http';
import { PushScheduler } from './scheduler';
import type { PushSender } from './sender';

function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Serverless hosts (e.g. Vercel) can't keep the in-process push scheduler
 * running, so a cron job calls this once a minute instead. Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`; any external scheduler can do the same.
 */
export function cronRouter(sender: PushSender) {
  const router = Router();
  router.get('/cron/push', async (req, res) => {
    if (!env.CRON_SECRET) throw new HttpError(404, 'not_found', 'Not found');
    if (!sameSecret(req.get('authorization') ?? '', `Bearer ${env.CRON_SECRET}`)) throw new HttpError(401, 'unauthenticated', 'Invalid cron secret.');
    if (!sender.enabled) {
      res.json({ enabled: false, sent: 0 });
      return;
    }
    const sent = await new PushScheduler(prisma, sender).tick();
    res.json({ enabled: true, sent });
  });
  return router;
}
