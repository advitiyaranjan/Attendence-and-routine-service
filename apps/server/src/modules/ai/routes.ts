import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { aiPermissionsSchema, isoDate } from '@student-os/core';
import { prisma } from '../../db';
import { env } from '../../env';
import { HttpError, parseBody } from '../../lib/http';
import { AIService } from './service';

export const aiRouter = Router();
const ai = new AIService();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

const allowAi: RequestHandler = async (req, _res, next) => {
  if (!req.userId && !env.AI_ALLOW_GUEST) throw new HttpError(401, 'unauthenticated', 'Sign in to use AI features.');
  if (req.userId) {
    const since = new Date(Date.now() - 86_400_000);
    const used = await prisma.aIUsage.count({ where: { userId: req.userId, createdAt: { gte: since } } });
    if (used >= env.AI_DAILY_LIMIT) throw new HttpError(429, 'ai_quota', 'Daily AI limit reached. It resets within 24 hours.');
  }
  next();
};

// Cheap availability check, polled on app start and when the chat opens: not rate limited.
aiRouter.get('/status', (_req, res) => {
  res.json({ available: ai.available });
});

aiRouter.use(
  rateLimit({
    windowMs: 60_000,
    limit: (req) => (req.userId ? 20 : 8),
    keyGenerator: (req) => req.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many AI requests. Please wait a minute.' } },
  }),
);

aiRouter.use(allowAi);

/** Context is pre-filtered on the client by the student's AI Data Controls; cap its size here too. */
const context = z
  .unknown()
  .optional()
  .refine((v) => JSON.stringify(v ?? {}).length <= 40_000, 'Context too large');

aiRouter.post('/timetable', upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'no_file', 'Choose a timetable file to upload.');
  res.json(await ai.analyzeTimetable(req.userId ?? null, req.file));
});

aiRouter.post('/command', async (req, res) => {
  const body = parseBody(
    z.object({
      messages: z
        .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }))
        .min(1)
        .max(40),
      context,
      today: isoDate,
      permissions: aiPermissionsSchema.partial().default({}),
    }),
    req.body,
  );
  res.json(await ai.command(req.userId ?? null, body.messages, body.context, body.today, body.permissions));
});

aiRouter.post('/flashcards', async (req, res) => {
  const body = parseBody(
    z.object({ topic: z.string().trim().min(1).max(300), notes: z.string().max(30_000).optional(), count: z.number().int().min(1).max(30).default(10) }),
    req.body,
  );
  res.json(await ai.generateFlashcards(req.userId ?? null, body.topic, body.notes, body.count));
});

aiRouter.post('/quiz', async (req, res) => {
  const body = parseBody(
    z.object({
      topic: z.string().trim().min(1).max(300),
      notes: z.string().max(30_000).optional(),
      count: z.union([z.literal(5), z.literal(10), z.literal(20)]).default(5),
      difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed'),
    }),
    req.body,
  );
  res.json(await ai.generateQuiz(req.userId ?? null, body.topic, body.count, body.difficulty, body.notes));
});

aiRouter.post('/notes', async (req, res) => {
  const body = parseBody(z.object({ title: z.string().max(300), body: z.string().min(1).max(60_000) }), req.body);
  res.json(await ai.summarizeNotes(req.userId ?? null, body.title, body.body));
});

aiRouter.post('/review', async (req, res) => {
  const body = parseBody(z.object({ period: z.enum(['daily', 'weekly']), data: context }), req.body);
  res.json(await ai.review(req.userId ?? null, body.period, body.data));
});
