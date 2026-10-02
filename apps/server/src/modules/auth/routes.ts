import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { prisma } from '../../db';
import { env } from '../../env';
import { HttpError, parseBody } from '../../lib/http';
import { clearSession, issueSession } from '../../middleware/auth';

export const authRouter = Router();

/**
 * Brute-force protection for credential endpoints only. GET /me runs on every
 * app start, so limiting it would lock out students who simply reload often.
 */
const signInLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many sign-in attempts. Please wait a few minutes and try again.' } },
});

// Compared against when the email doesn't exist, so response timing doesn't reveal accounts.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 12);

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  name: z.string().trim().max(100).optional(),
});

function publicUser(u: { id: string; email: string | null; name: string | null; googleId: string | null }) {
  return { id: u.id, email: u.email, name: u.name, hasGoogle: !!u.googleId };
}

authRouter.post('/register', signInLimit, async (req, res) => {
  const { email, password, name } = parseBody(credentials, req.body);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new HttpError(409, 'email_taken', 'An account with this email already exists.');
  const user = await prisma.user.create({
    data: { email, name: name ?? null, passwordHash: await bcrypt.hash(password, 12), lastLoginAt: new Date() },
  });
  const token = issueSession(res, user.id);
  res.status(201).json({ user: publicUser(user), token });
});

authRouter.post('/login', signInLimit, async (req, res) => {
  const { email, password } = parseBody(credentials.pick({ email: true, password: true }), req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !ok) throw new HttpError(401, 'invalid_credentials', 'Incorrect email or password.');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = issueSession(res, user.id);
  res.json({ user: publicUser(user), token });
});

const googleClient = env.GOOGLE_CLIENT_ID ? new OAuth2Client(env.GOOGLE_CLIENT_ID) : null;

/** Google Identity Services: the browser obtains an ID token, we verify it here. */
authRouter.post('/google', signInLimit, async (req, res) => {
  if (!googleClient || !env.GOOGLE_CLIENT_ID) throw new HttpError(501, 'google_disabled', 'Google sign-in is not configured.');
  const { credential } = parseBody(z.object({ credential: z.string().min(10).max(5000) }), req.body);
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, 'invalid_google_token', 'Google sign-in failed. Please try again.');
  }
  if (!payload?.sub || !payload.email || !payload.email_verified) {
    throw new HttpError(401, 'invalid_google_token', 'Google account email is not verified.');
  }
  const email = payload.email.toLowerCase();
  const user =
    (await prisma.user.findUnique({ where: { googleId: payload.sub } })) ??
    (await prisma.user.upsert({
      where: { email },
      update: { googleId: payload.sub, lastLoginAt: new Date() },
      create: { email, googleId: payload.sub, name: payload.name ?? null, lastLoginAt: new Date() },
    }));
  const token = issueSession(res, user.id);
  res.json({ user: publicUser(user), token });
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  if (!req.userId) {
    res.json({ user: null, googleClientId: env.GOOGLE_CLIENT_ID ?? null });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    clearSession(res);
    res.json({ user: null, googleClientId: env.GOOGLE_CLIENT_ID ?? null });
    return;
  }
  res.json({ user: publicUser(user), googleClientId: env.GOOGLE_CLIENT_ID ?? null });
});
