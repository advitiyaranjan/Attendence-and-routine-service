import type { RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env, isProd } from '../env';
import { HttpError } from '../lib/http';

export const SESSION_COOKIE = 'sos_session';
const SESSION_DAYS = 30;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Starts a session. Browsers use the httpOnly cookie; the Android app (a
 * different origin, where third-party cookies are unreliable) stores the
 * returned token and sends it as a Bearer header.
 */
export function issueSession(res: Response, userId: string): string {
  const token = jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: `${SESSION_DAYS}d`, algorithm: 'HS256' });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 86_400_000,
    path: '/',
  });
  return token;
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Attaches req.userId when a valid session cookie is present. */
export const readSession: RequestHandler = (req, _res, next) => {
  const header = req.get('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer ?? req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string') {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
      if (typeof payload === 'object' && typeof payload.sub === 'string') req.userId = payload.sub;
    } catch {
      // invalid/expired token → treated as signed out
    }
  }
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.userId) throw new HttpError(401, 'unauthenticated', 'Please sign in to continue.');
  next();
};

/**
 * CSRF defence for cookie-authenticated requests: state-changing requests must
 * carry a custom header, which cross-site forms cannot set without a CORS preflight.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'student-os') {
    throw new HttpError(403, 'csrf', 'Request blocked.');
  }
  next();
};
