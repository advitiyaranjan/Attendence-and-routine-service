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
  temperature?: number;
}

/**
 * The only place in the codebase that talks to Gemini. Every response is
 * parsed as JSON and validated against a Zod schema; one corrective retry is
 * attempted before giving up.
 */
function statusOf(err: unknown): number {
  const s = (err as { status?: number }).status;
  if (typeof s === 'number') return s;
  return Number(/"code":s*(d{3})/.exec(String((err as Error)?.message))?.[1] ?? 0);
}

export class GeminiClient {
  private ai: GoogleGenAI | null;

  private models: string[];
  /** Pause before the second pass over the model chain. */
  retryDelayMs = 2500;

  constructor(
    apiKey: string | undefined = env.GEMINI_API_KEY,
    model: string = env.GEMINI_MODEL,
    fallbacks: string[] = env.GEMINI_FALLBACK_MODELS,
  ) {
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
  private async callWithFallback(request: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>) {
    let lastErr: unknown;
    // Two passes over the chain; Google-side overloads are usually brief.
    for (const [pass, delay] of [0, this.retryDelayMs].entries()) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      for (const model of this.models) {
        try {
          return await this.ai!.models.generateContent({ ...request, model });
        } catch (err) {
          lastErr = err;
          const status = statusOf(err);
          if (![404, 429, 500, 503].includes(status)) throw err;
          console.warn(`[ai] ${model} unavailable (${status}), pass ${pass + 1}`);
        }
      }
    }
    throw lastErr;
  }

  get available(): boolean {
    return this.ai !== null;
  }

  async generateJson<T>(opts: GenerateOptions<T>): Promise<T> {
    if (!this.ai) throw new HttpError(503, 'ai_unavailable', 'AI features are not configured on this server.');

    let parts = opts.parts;
    let lastError = 'Unknown error';
    for (let attempt = 0; attempt < 2; attempt++) {
      let text: string | undefined;
      let usage = { input: 0, output: 0 };
      try {
        const response = await this.callWithFallback({
          contents: [{ role: 'user', parts }],
          config: {
            systemInstruction: opts.system,
            responseMimeType: 'application/json',
            temperature: opts.temperature ?? 0.3,
          },
        });
        text = response.text;
        usage = {
          input: response.usageMetadata?.promptTokenCount ?? 0,
          output: response.usageMetadata?.candidatesTokenCount ?? 0,
        };
      } catch (err) {
        console.error(`[ai:${opts.feature}] Gemini request failed`, statusOf(err), String((err as Error).message).slice(0, 200));
        await this.record(opts, usage, false);
        if ([429, 503].includes(statusOf(err))) {
          throw new HttpError(503, 'ai_busy', "Gemini is very busy right now (on Google's side). Please try again in a minute.");
        }
        throw new HttpError(502, 'ai_failed', 'The AI service is temporarily unavailable. Please try again shortly.');
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
