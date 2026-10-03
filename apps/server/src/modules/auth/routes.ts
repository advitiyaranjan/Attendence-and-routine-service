import { createHash } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { prisma } from '../../db';
import { env } from '../../env';
import { HttpError, parseBody } from '../../lib/http';
import { clearSession, issueSession, requireAuth } from '../../middleware/auth';
import { resendOtp, startOtp, verifyOtp } from '../../lib/otp';

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

const challenge = z.object({ challengeId: z.string().uuid(), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
const emailOnly = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

/** Step 1 of sign-up: check the details, then email a code. The account is created only once the code is confirmed. */
authRouter.post('/register', signInLimit, async (req, res) => {
  const { email, password, name } = parseBody(credentials, req.body);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new HttpError(409, 'email_taken', 'An account with this email already exists.');
  const challengeId = await startOtp(email, 'register', { payload: { passwordHash: await bcrypt.hash(password, 12), name: name ?? null } });
  res.status(202).json({ otp: { challengeId, email, purpose: 'register' } });
});

/** Step 1 of sign-in: check the password, then email a code. */
authRouter.post('/login', signInLimit, async (req, res) => {
  const { email, password } = parseBody(credentials.pick({ email: true, password: true }), req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !ok) throw new HttpError(401, 'invalid_credentials', 'Incorrect email or password.');
  const challengeId = await startOtp(email, 'login', { userId: user.id });
  res.status(202).json({ otp: { challengeId, email, purpose: 'login' } });
});

/** Step 2 of sign-up / sign-in: confirm the emailed code and start the session. */
authRouter.post('/otp/verify', signInLimit, async (req, res) => {
  const { challengeId, code, purpose } = parseBody(challenge.extend({ purpose: z.enum(['register', 'login']) }), req.body);
  const row = await verifyOtp(challengeId, code, purpose);
  let user;
  if (row.purpose === 'register') {
    const payload = row.payload as { passwordHash: string; name: string | null };
    if (await prisma.user.findUnique({ where: { email: row.email } })) throw new HttpError(409, 'email_taken', 'An account with this email already exists.');
    user = await prisma.user.create({ data: { email: row.email, name: payload.name, passwordHash: payload.passwordHash, lastLoginAt: new Date() } });
  } else {
    user = await prisma.user.update({ where: { id: row.userId! }, data: { lastLoginAt: new Date() } });
  }
  const token = issueSession(res, user.id);
  res.status(row.purpose === 'register' ? 201 : 200).json({ user: publicUser(user), token });
});

authRouter.post('/otp/resend', signInLimit, async (req, res) => {
  const { challengeId } = parseBody(z.object({ challengeId: z.string().uuid() }), req.body);
  await resendOtp(challengeId);
  res.json({ ok: true });
});

/**
 * Forgot password: email a reset code. The response is the same whether or not
 * the account exists, so this can't be used to discover who has an account.
 */
authRouter.post('/password/forgot', signInLimit, async (req, res) => {
  const { email } = parseBody(emailOnly, req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const challengeId = user ? await startOtp(email, 'reset', { userId: user.id }) : crypto.randomUUID();
  res.status(202).json({ otp: { challengeId, email, purpose: 'reset' } });
});

authRouter.post('/password/reset', signInLimit, async (req, res) => {
  const { challengeId, code, password } = parseBody(challenge.extend({ password: credentials.shape.password }), req.body);
  const row = await verifyOtp(challengeId, code, 'reset');
  const user = await prisma.user.update({ where: { id: row.userId! }, data: { passwordHash: await bcrypt.hash(password, 12), lastLoginAt: new Date() } });
  const token = issueSession(res, user.id);
  res.json({ user: publicUser(user), token });
});

/** Change email: a code goes to the NEW address; the change applies once it is confirmed. */
authRouter.post('/email/change', requireAuth, signInLimit, async (req, res) => {
  const { email } = parseBody(emailOnly, req.body);
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me) throw new HttpError(401, 'unauthorized', 'Please sign in again.');
  if (me.email === email) throw new HttpError(400, 'same_email', 'That is already your email.');
  if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, 'email_taken', 'Another account already uses this email.');
  const challengeId = await startOtp(email, 'change_email', { userId: me.id });
  res.status(202).json({ otp: { challengeId, email, purpose: 'change_email' } });
});

authRouter.post('/email/change/verify', requireAuth, signInLimit, async (req, res) => {
  const { challengeId, code } = parseBody(challenge, req.body);
  const row = await verifyOtp(challengeId, code, 'change_email');
  if (row.userId !== req.userId) throw new HttpError(400, 'otp_invalid', 'This code has expired. Please ask for a new one.');
  if (await prisma.user.findUnique({ where: { email: row.email } })) throw new HttpError(409, 'email_taken', 'Another account already uses this email.');
  const user = await prisma.user.update({ where: { id: row.userId }, data: { email: row.email } });
  res.json({ user: publicUser(user) });
});

const googleClient = env.GOOGLE_CLIENT_ID ? new OAuth2Client(env.GOOGLE_CLIENT_ID) : null;

/** Google Identity Services: the browser obtains an ID token, we verify it here. */
authRouter.post('/google', signInLimit, async (req, res) => {
  if (!googleClient || !env.GOOGLE_CLIENT_ID) throw new HttpError(501, 'google_disabled', 'Google sign-in is not configured.');
  const { credential, nonce } = parseBody(z.object({ credential: z.string().min(10).max(5000), nonce: z.string().max(200).optional() }), req.body);
  let payload;
  try {
    const audience = [env.GOOGLE_CLIENT_ID, env.GOOGLE_ANDROID_CLIENT_ID].filter((x): x is string => !!x);
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, 'invalid_google_token', 'Google sign-in failed. Please try again.');
  }
  // Android app sign-in (Chrome tab → app link): the token carries sha256(nonce), and only the
  // app that started the sign-in knows the nonce, so a token caught from the link can't be used alone.
  if (payload?.nonce && createHash('sha256').update(nonce ?? '').digest('hex') !== payload.nonce) {
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
    res.json({ user: null, googleClientId: env.GOOGLE_CLIENT_ID ?? null, googleAndroidClientId: env.GOOGLE_ANDROID_CLIENT_ID ?? null });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    clearSession(res);
    res.json({ user: null, googleClientId: env.GOOGLE_CLIENT_ID ?? null, googleAndroidClientId: env.GOOGLE_ANDROID_CLIENT_ID ?? null });
    return;
  }
  res.json({ user: publicUser(user), googleClientId: env.GOOGLE_CLIENT_ID ?? null, googleAndroidClientId: env.GOOGLE_ANDROID_CLIENT_ID ?? null });
});
