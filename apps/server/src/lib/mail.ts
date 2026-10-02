import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env';
import { HttpError } from './http';

let transport: Transporter | null = null;

export const mailConfigured = () => !!env.SMTP_URL;

/**
 * Send a plain transactional email. Without SMTP_URL, development and tests
 * print the message to the console; production refuses, so codes are never lost.
 */
export async function sendMail(to: string, subject: string, text: string, html?: string) {
  if (!env.SMTP_URL) {
    if (env.NODE_ENV === 'production') throw new HttpError(503, 'email_unavailable', "Email isn't set up on this server yet, so codes can't be sent.");
    if (env.NODE_ENV === 'development') console.info(`[mail → ${to}] ${subject}\n${text}`);
    return;
  }
  transport ??= nodemailer.createTransport(env.SMTP_URL);
  try {
    await transport.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
  } catch (e) {
    console.error('Email send failed', e);
    throw new HttpError(502, 'email_failed', "We couldn't send the email. Please try again in a moment.");
  }
}
