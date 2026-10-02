import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { allowedOrigins } from './env';
import { errorHandler, notFound } from './lib/http';
import { readSession, requireCsrfHeader } from './middleware/auth';
import { authRouter } from './modules/auth/routes';
import { syncRouter } from './modules/sync/routes';
import { dataRouter } from './modules/data/routes';
import { aiRouter } from './modules/ai/routes';
import { pushRouter } from './modules/push/routes';
import { WebPushSender, type PushSender } from './modules/push/sender';

export function createApp(opts: { pushSender?: PushSender } = {}) {
  const pushSender = opts.pushSender ?? new WebPushSender();
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(readSession);
  app.use('/api', requireCsrfHeader);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api', pushRouter(pushSender));
  app.use('/api', dataRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
