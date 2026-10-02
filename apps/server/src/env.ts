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
    GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
    GOOGLE_CLIENT_ID: z.string().optional(),
    /** Allow AI features without an account (rate limited per IP). */
    AI_ALLOW_GUEST: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    AI_DAILY_LIMIT: z.coerce.number().int().min(1).default(200),
    /** Web Push (VAPID). Generate with: npm run vapid -w @student-os/server */
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),
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
export const allowedOrigins = env.CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
export const isProd = env.NODE_ENV === 'production';
