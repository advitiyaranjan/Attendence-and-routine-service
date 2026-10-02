import { GoogleGenAI, type Part } from '@google/genai';
import { extractJson } from '@student-os/core';
import type { ZodType } from 'zod';
import { prisma } from '../../db';
import { env } from '../../env';
import { HttpError } from '../../lib/http';

export interface GenerateOptions<T> {
  feature: string;
  userId: string | null;
  system: string;
  parts: Part[];
  schema: ZodType<T>;
  /** Model chain to try for this request (defaults to the configured chain). */
  models?: string[];
}

/** HTTP status of a Gemini SDK error (from `.status`, or the JSON error body in the message). */
export function statusOf(err: unknown): number {
  const s = (err as { status?: number } | null)?.status;
  if (typeof s === 'number') return s;
  return Number(/"code":\s*(\d{3})/.exec(String((err as Error | null)?.message))?.[1] ?? 0);
}

/** The API key is missing, wrong, or not allowed to use the Gemini API. Retrying other models won't help. */
function isKeyError(err: unknown): boolean {
  const status = statusOf(err);
  if (status === 401 || status === 403) return true;
  return status === 400 && /API[_ ]?KEY|PERMISSION_DENIED/i.test(String((err as Error | null)?.message));
}

class DeadlineError extends Error {}

/**
 * The only place in the codebase that talks to Gemini. Every response is
 * parsed as JSON and validated against a Zod schema; one corrective retry is
 * attempted before giving up.
 *
 * Gemini 3 models are tuned for the default temperature (1.0); lower values
 * can make them loop or return broken JSON, so we never override it.
 */

export class GeminiClient {
  private ai: GoogleGenAI | null;

  private models: string[];
  /** Pause before the second pass over the model chain. */
  retryDelayMs = 2500;
  /** Total time one request may spend on Gemini, so serverless hosts (e.g. Vercel) never time out first. */
  budgetMs: number;

  constructor(
    apiKey: string | undefined = env.GEMINI_API_KEY,
    model: string = env.GEMINI_MODEL,
    fallbacks: string[] = env.GEMINI_FALLBACK_MODELS,
    budgetMs: number = env.AI_TIMEOUT_MS,
  ) {
    this.budgetMs = budgetMs;
    this.ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
    this.models = [model, ...fallbacks.filter((m) => m !== model)];
  }

  private get model() {
    return this.models[0]!;
  }

  /**
   * Call the primary model, falling back to the next one when a model is
   * overloaded, rate-limited or unavailable (503 / 429 / 404 / 500).
   */
  private async callWithFallback(request: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>, deadline: number, models: string[] = this.models) {
    let lastErr: unknown;
    // Two passes over the chain; Google-side overloads are usually brief.
    for (const [pass, delay] of [0, this.retryDelayMs].entries()) {
      if (delay) {
        if (Date.now() + delay + 5000 > deadline) break;
        await new Promise((r) => setTimeout(r, delay));
      }
      for (const model of models) {
        const remaining = deadline - Date.now();
        if (remaining < 3000) throw new DeadlineError('AI time budget used up');
        try {
          return await this.ai!.models.generateContent({
            ...request,
            model,
            config: { ...request.config, httpOptions: { timeout: remaining } },
          });
        } catch (err) {
          lastErr = err;
          if (Date.now() >= deadline - 500) throw new DeadlineError('Gemini request timed out');
          const status = statusOf(err);
          if (![404, 429, 500, 503].includes(status)) throw err;
          console.warn(`[ai] ${model} unavailable (${status}), pass ${pass + 1}`);
        }
      }
    }
    throw lastErr;
  }

  /** The configured chain, for building per-request variants (e.g. AI Power). */
  get chain(): string[] {
    return [...this.models];
  }

  get available(): boolean {
    return this.ai !== null;
  }

  async generateJson<T>(opts: GenerateOptions<T>): Promise<T> {
    if (!this.ai) throw new HttpError(503, 'ai_unavailable', 'AI features are not configured on this server.');

    const deadline = Date.now() + this.budgetMs;
    let parts = opts.parts;
    let lastError = 'Unknown error';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0 && deadline - Date.now() < 5000) break;
      let text: string | undefined;
      let usage = { input: 0, output: 0 };
      try {
        const response = await this.callWithFallback(
          {
            contents: [{ role: 'user', parts }],
            config: { systemInstruction: opts.system, responseMimeType: 'application/json' },
          },
          deadline,
          opts.models,
        );
        text = response.text;
        usage = {
          input: response.usageMetadata?.promptTokenCount ?? 0,
          output: response.usageMetadata?.candidatesTokenCount ?? 0,
        };
      } catch (err) {
        const status = statusOf(err);
        console.error(`[ai:${opts.feature}] Gemini request failed`, status, String((err as Error)?.message).slice(0, 300));
        await this.record(opts, usage, false);
        throw toHttpError(err);
      }

      try {
        const result = opts.schema.safeParse(extractJson(text ?? ''));
        if (result.success) {
          await this.record(opts, usage, true);
          return result.data;
        }
        lastError = result.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Invalid JSON';
      }
      await this.record(opts, usage, false);
      parts = [
        ...opts.parts,
        { text: `Your previous answer was invalid (${lastError}). Respond again with ONLY valid JSON matching the required format.` },
      ];
    }
    console.warn(`[ai:${opts.feature}] invalid output after retry: ${lastError}`);
    throw new HttpError(422, 'ai_invalid_output', "The AI couldn't produce a usable result. Try rephrasing or try again.");
  }

  private async record(opts: GenerateOptions<unknown>, usage: { input: number; output: number }, success: boolean) {
    try {
      await prisma.aIUsage.create({
        data: {
          userId: opts.userId,
          feature: opts.feature,
          model: this.model,
          inputTokens: usage.input,
          outputTokens: usage.output,
          success,
        },
      });
    } catch {
      // usage tracking must never break the feature
    }
  }
}

/** Map a Gemini failure to a message the student can act on. Details stay in the server log. */
function toHttpError(err: unknown): HttpError {
  if (err instanceof DeadlineError) {
    return new HttpError(504, 'ai_timeout', 'The AI took too long to respond. Please try again, or try a smaller file.');
  }
  if (isKeyError(err)) {
    return new HttpError(503, 'ai_misconfigured', "AI isn't set up correctly on the server: the Gemini API key was rejected. Check GEMINI_API_KEY.");
  }
  const status = statusOf(err);
  if (status === 404) {
    return new HttpError(503, 'ai_misconfigured', "The configured Gemini model isn't available. Check GEMINI_MODEL on the server.");
  }
  if (status === 429 || status === 503) {
    return new HttpError(503, 'ai_busy', "Gemini is very busy right now (on Google's side). Please try again in a minute.");
  }
  if (status === 400) {
    return new HttpError(422, 'ai_rejected', "The AI couldn't read that request. If you uploaded a file, try a clearer image or a PDF.");
  }
  return new HttpError(502, 'ai_failed', 'The AI service is temporarily unavailable. Please try again shortly.');
}
