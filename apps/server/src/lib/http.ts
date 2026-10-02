import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, type ZodType } from 'zod';

/** An error whose message is safe to show to the user. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new HttpError(400, 'invalid_input', first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input');
  }
  return result.data;
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
};

/** Never leak raw technical errors to the client. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'invalid_input', message: 'Invalid input' } });
    return;
  }
  if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: { code: 'too_large', message: 'That file is too large.' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong. Please try again.' } });
};
