import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    DATABASE_URL: z.string().optional(),
    JWT_SECRET: z.string().default('dev-only-insecure-secret-change-me'),
    /** Comma-separated list of allowed browser origins. */
    CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
    /** Tried in order when the primary model is overloaded or unavailable. */
    /** Used first at AI Power "Maximum" / "Low". */
    GEMINI_PRO_MODEL: z.string().default('gemini-3.1-pro-preview'),
    GEMINI_LITE_MODEL: z.string().default('gemini-3.1-flash-lite'),
    GEMINI_FALLBACK_MODELS: z
      .string()
      .default('gemini-3.7-flash,gemini-3.5-flash,gemini-3.1-flash-lite')
      .transform((v) => v.split(',').map((m) => m.trim()).filter(Boolean)),
    GOOGLE_CLIENT_ID: z.string().optional(),
    /** Android OAuth client (package + SHA-1). Tokens issued for it are accepted too. */
    GOOGLE_ANDROID_CLIENT_ID: z.string().optional(),
    /** Email for one-time codes, e.g. smtps://user:app-password@smtp.gmail.com:465 */
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default('Student OS <no-reply@localhost>'),
    /** Allow AI features without an account (rate limited per IP). */
    AI_ALLOW_GUEST: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    AI_DAILY_LIMIT: z.coerce.number().int().min(1).default(200),
    /** Max time (ms) one AI request may spend on Gemini, including fallbacks. Keep under your host's function timeout. */
    AI_TIMEOUT_MS: z.coerce.number().int().min(5000).default(50_000),
    /** Web Push (VAPID). Generate with: npm run vapid -w @student-os/server */
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),
    /** Protects GET /api/cron/push (serverless push scheduling). Vercel Cron sends it automatically. */
    CRON_SECRET: z.string().min(16).optional(),
    PUSH_SCHEDULER: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.JWT_SECRET.startsWith('dev-only') || env.JWT_SECRET.length < 32) {
        ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'Set a JWT_SECRET of at least 32 characters in production' });
      }
      if (!env.DATABASE_URL) ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'DATABASE_URL is required in production' });
    }
  });

export const env = schema.parse(process.env);
/** Browser origins plus the Android app's WebView origins (Capacitor). */
export const allowedOrigins = [
  ...env.CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
];
export const isProd = env.NODE_ENV === 'production';
