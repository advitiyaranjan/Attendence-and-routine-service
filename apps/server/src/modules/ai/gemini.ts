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
export class GeminiClient {
  private ai: GoogleGenAI | null;

  constructor(
    apiKey: string | undefined = env.GEMINI_API_KEY,
    private model: string = env.GEMINI_MODEL,
  ) {
    this.ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
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
        const response = await this.ai.models.generateContent({
          model: this.model,
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
        console.error(`[ai:${opts.feature}] Gemini request failed`, err);
        await this.record(opts, usage, false);
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
