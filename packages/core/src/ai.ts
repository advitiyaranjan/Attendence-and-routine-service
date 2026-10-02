/**
 * Schemas for structured Gemini output. Every AI response that can change app
 * data is validated here before it reaches the user for confirmation. AI output
 * never carries database ids — subjects are referenced by name and mapped on
 * the client.
 */
import { z } from 'zod';
import { normalizeTime, parseWeekday, isISODate } from './dates';

const time = z
  .string()
  .transform((v, ctx) => {
    const t = normalizeTime(v);
    if (!t) {
      ctx.addIssue({ code: 'custom', message: `Invalid time "${v}"` });
      return z.NEVER;
    }
    return t;
  });

const weekday = z.string().transform((v, ctx) => {
  const d = parseWeekday(v);
  if (d === null) {
    ctx.addIssue({ code: 'custom', message: `Invalid day "${v}"` });
    return z.NEVER;
  }
  return d;
});

const date = z.string().refine(isISODate, 'Expected YYYY-MM-DD date');

const optString = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim() : null));

const classTypeLoose = z
  .string()
  .nullish()
  .transform((v): 'lecture' | 'lab' | 'tutorial' | 'other' => {
    const s = (v ?? '').toLowerCase();
    if (s.includes('lab') || s.includes('practical')) return 'lab';
    if (s.includes('tut')) return 'tutorial';
    if (!s || s.includes('lec') || s.includes('theory')) return 'lecture';
    return 'other';
  });

export const timetableEntrySchema = z.object({
  name: z.string().trim().min(1),
  code: optString,
  faculty: optString,
  room: optString,
  day: weekday,
  start_time: time,
  end_time: time,
  type: classTypeLoose,
  credits: z.number().min(0).max(50).nullish().transform((v) => v ?? null),
});
export type TimetableEntry = z.infer<typeof timetableEntrySchema>;

export const timetableExtractionSchema = z.object({
  semester: optString,
  academic_year: optString,
  days: z.array(z.string()).default([]),
  subjects: z.array(timetableEntrySchema).max(200),
  warnings: z.array(z.string()).default([]),
});
export type TimetableExtraction = z.infer<typeof timetableExtractionSchema>;

const priority = z
  .string()
  .nullish()
  .transform((v): 'low' | 'medium' | 'high' | 'urgent' => {
    const s = (v ?? '').toLowerCase();
    return s === 'low' || s === 'high' || s === 'urgent' ? s : 'medium';
  });

export const aiTaskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  category: z.string().trim().max(50).nullish().transform((v) => v || 'Study'),
  priority,
  dueDate: date.nullish().transform((v) => v ?? null),
  estimatedMinutes: z.number().int().min(0).max(1440).nullish().transform((v) => v ?? null),
  subjectName: optString,
});
export type AITask = z.infer<typeof aiTaskSchema>;

export const aiEventSchema = z.object({
  title: z.string().trim().min(1).max(300),
  type: z.enum(['study', 'revision', 'practice', 'personal']).catch('study'),
  date,
  startTime: time.nullish().transform((v) => v ?? null),
  endTime: time.nullish().transform((v) => v ?? null),
  subjectName: optString,
});
export type AIEvent = z.infer<typeof aiEventSchema>;

export const aiTopicSchema = z.object({
  title: z.string().trim().min(1).max(300),
  subjectName: optString,
  learnedOn: date.nullish().transform((v) => v ?? null),
});

export const aiActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create_tasks'), summary: optString, tasks: z.array(aiTaskSchema).min(1).max(50) }),
  z.object({ type: z.literal('create_events'), summary: optString, events: z.array(aiEventSchema).min(1).max(100) }),
  z.object({ type: z.literal('create_topics'), summary: optString, topics: z.array(aiTopicSchema).min(1).max(50) }),
]);
export type AIAction = z.infer<typeof aiActionSchema>;

/**
 * Lenient wrapper: valid actions are kept, malformed ones are dropped (and
 * counted) instead of failing the whole reply.
 */
export const chatResponseSchema = z.object({
  reply: z.string().max(20_000),
  actions: z
    .array(z.unknown())
    .default([])
    .transform((items) => items.map((i) => aiActionSchema.safeParse(i)).filter((r) => r.success).map((r) => r.data)),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

export const parsedTasksSchema = z.object({ tasks: z.array(aiTaskSchema).max(50) });

export const flashcardsResponseSchema = z.object({
  cards: z
    .array(z.object({ question: z.string().trim().min(1).max(2000), answer: z.string().trim().min(1).max(5000) }))
    .min(1)
    .max(50),
});

export const quizResponseSchema = z.object({
  questions: z
    .array(
      z
        .object({
          question: z.string().trim().min(1).max(2000),
          options: z.array(z.string().trim().min(1).max(500)).min(2).max(6),
          answerIndex: z.number().int().min(0),
          explanation: z.string().max(2000).nullish().transform((v) => v ?? null),
        })
        .refine((q) => q.answerIndex < q.options.length, 'answerIndex out of range'),
    )
    .min(1)
    .max(30),
});
export type QuizResponse = z.infer<typeof quizResponseSchema>;

export const reviewSummarySchema = z.object({
  summary: z.string().min(1).max(5000),
  highlights: z.array(z.string().max(500)).max(10).default([]),
  suggestions: z.array(z.string().max(500)).max(10).default([]),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

/** Extract the first JSON object/array from model text (handles ```json fences). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (start === -1 || end <= start) throw new Error('No JSON found in model output');
    return JSON.parse(candidate.slice(start, end + 1));
  }
}
