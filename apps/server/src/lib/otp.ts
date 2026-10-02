/**
 * One-time email codes (6 digits) for sign-up, sign-in, password reset and
 * email changes. Only an HMAC of the code is stored; codes expire after
 * 10 minutes, allow 5 attempts, and can be re-sent once a minute.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { HttpError } from './http';
import { sendMail } from './mail';

export type OtpPurpose = 'register' | 'login' | 'reset' | 'change_email';

const TTL_MS = 10 * 60_000;
const RESEND_MS = 60_000;
export const MAX_ATTEMPTS = 5;

const hash = (id: string, code: string) => createHmac('sha256', env.JWT_SECRET).update(`${id}:${code}`).digest('hex');

const SUBJECT: Record<OtpPurpose, string> = {
  register: 'Confirm your email',
  login: 'Your sign-in code',
  reset: 'Reset your password',
  change_email: 'Confirm your new email',
};

const ACTION: Record<OtpPurpose, string> = {
  register: 'finish creating your Student OS account',
  login: 'sign in to Student OS',
  reset: 'reset your Student OS password',
  change_email: 'change your Student OS email to this address',
};

function newCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

async function deliver(email: string, purpose: OtpPurpose, code: string) {
  const text = `Your code is ${code}\n\nUse it to ${ACTION[purpose]}. It expires in 10 minutes.\nIf you didn't ask for this, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px"><p>Use this code to ${ACTION[purpose]}:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p style="color:#666">It expires in 10 minutes. If you didn't ask for this, you can ignore this email.</p></div>`;
  await sendMail(email, `${SUBJECT[purpose]}: ${code}`, text, html);
}

/** Create a challenge and email its code. Returns the challenge id the client verifies against. */
export async function startOtp(email: string, purpose: OtpPurpose, opts: { userId?: string; payload?: Prisma.InputJsonValue } = {}) {
  const recent = await prisma.emailOtp.findFirst({ where: { email, purpose, createdAt: { gt: new Date(Date.now() - RESEND_MS) } } });
  if (recent) throw new HttpError(429, 'otp_cooldown', 'A code was just sent. Please wait a minute before asking for another.');
  // One live challenge per email and purpose.
  await prisma.emailOtp.deleteMany({ where: { email, purpose } });
  const code = newCode();
  const row = await prisma.emailOtp.create({
    data: { email, purpose, userId: opts.userId ?? null, payload: opts.payload ?? Prisma.JsonNull, codeHash: 'pending', expiresAt: new Date(Date.now() + TTL_MS) },
  });
  await prisma.emailOtp.update({ where: { id: row.id }, data: { codeHash: hash(row.id, code) } });
  try {
    await deliver(email, purpose, code);
  } catch (e) {
    await prisma.emailOtp.delete({ where: { id: row.id } }).catch(() => undefined);
    throw e;
  }
  return row.id;
}

/** Send a fresh code for an existing challenge (same id, new code, new expiry). */
export async function resendOtp(id: string) {
  const row = await prisma.emailOtp.findUnique({ where: { id } });
  // Unknown ids (e.g. a reset for an email with no account) succeed silently, so accounts can't be probed.
  if (!row) return;
  if (Date.now() - row.createdAt.getTime() < RESEND_MS) throw new HttpError(429, 'otp_cooldown', 'Please wait a minute before asking for another code.');
  const code = newCode();
  await prisma.emailOtp.update({ where: { id }, data: { codeHash: hash(id, code), attempts: 0, createdAt: new Date(), expiresAt: new Date(Date.now() + TTL_MS) } });
  await deliver(row.email, row.purpose as OtpPurpose, code);
}

/** Check a code. On success the challenge is consumed and returned. */
export async function verifyOtp(id: string, code: string, purpose: OtpPurpose) {
  const row = await prisma.emailOtp.findUnique({ where: { id } });
  if (!row || row.purpose !== purpose || row.expiresAt.getTime() < Date.now()) {
    throw new HttpError(400, 'otp_invalid', 'This code has expired. Please ask for a new one.');
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await prisma.emailOtp.delete({ where: { id } }).catch(() => undefined);
    throw new HttpError(400, 'otp_locked', 'Too many wrong codes. Please ask for a new one.');
  }
  const expected = Buffer.from(row.codeHash, 'hex');
  const given = Buffer.from(hash(id, code.trim()), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    await prisma.emailOtp.update({ where: { id }, data: { attempts: { increment: 1 } } });
    const left = MAX_ATTEMPTS - row.attempts - 1;
    throw new HttpError(400, 'otp_wrong', left > 0 ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Please ask for a new one.');
  }
  await prisma.emailOtp.delete({ where: { id } });
  return row;
}
