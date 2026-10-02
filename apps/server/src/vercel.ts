/**
 * Vercel serverless entry: the same Express app as src/index.ts, without the
 * in-process push scheduler (serverless functions can't run timers; see
 * GET /api/cron/push). Bundled by scripts/vercel-build.mjs.
 *
 * A configuration problem (e.g. a missing environment variable) is answered as
 * JSON naming the variable, instead of an opaque crash on every request.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let app: Handler | null = null;
let problem = 'The server failed to start. Check the function logs on Vercel.';
try {
  const { createApp } = await import('./app');
  app = createApp() as unknown as Handler;
} catch (err) {
  const issues = (err as { issues?: Array<{ path: PropertyKey[]; message: string }> }).issues;
  if (issues?.length) problem = issues.map((i) => `${i.path.map(String).join('.') || 'config'}: ${i.message}`).join('; ');
  console.error('[vercel] startup failed:', err);
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (app) return app(req, res);
  res.statusCode = 500;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: { code: 'server_misconfigured', message: `Server configuration problem: ${problem}` } }));
}
