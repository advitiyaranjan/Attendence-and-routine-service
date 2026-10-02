import type { Part } from '@google/genai';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  actionCatalog,
  commandResponseSchema,
  flashcardsResponseSchema,
  quizResponseSchema,
  validateIntents,
  WEEKDAYS,
  weekdayOf,
  type AIPermissions,
  reviewSummarySchema,
  timetableExtractionSchema,
} from '@student-os/core';
import { HttpError } from '../../lib/http';
import { GeminiClient } from './gemini';
import * as P from './prompts';

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']);
const EXCEL_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

/** Turn an uploaded file into Gemini parts: images/PDF inline, documents as extracted text. */
export async function attachmentParts(file: UploadedFile): Promise<Part[]> {
  const name = file.originalname.toLowerCase();
  const header: Part = { text: `ATTACHMENT "${file.originalname}":` };
  if (IMAGE_TYPES.has(file.mimetype) || file.mimetype === 'application/pdf' || name.endsWith('.pdf')) {
    const mimeType = file.mimetype === 'application/octet-stream' ? 'application/pdf' : file.mimetype;
    return [header, { inlineData: { mimeType, data: file.buffer.toString('base64') } }];
  }
  if (EXCEL_TYPES.has(file.mimetype) || name.endsWith('.xlsx')) return [header, { text: await excelToText(file.buffer) }];
  if (name.endsWith('.docx') || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return [header, { text: await docxToText(file.buffer) }];
  }
  if (file.mimetype.startsWith('text/') || /\.(txt|md|csv|tsv|json)$/.test(name)) {
    return [header, { text: file.buffer.toString('utf8').slice(0, 100_000) }];
  }
  throw new HttpError(415, 'unsupported_file', `"${file.originalname}" isn't supported. Attach images, PDFs, Word, Excel or text files.`);
}

/** Plain text from a .docx (paragraphs and tabs), without extra dependencies beyond JSZip. */
async function docxToText(buffer: Buffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const xml = (await zip.file('word/document.xml')?.async('string')) ?? '';
    return xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .slice(0, 100_000);
  } catch {
    throw new HttpError(400, 'invalid_file', "That Word file couldn't be read. Try saving it as PDF.");
  }
}

function contextPart(context: unknown): Part {
  return { text: `CONTEXT:\n${JSON.stringify(context ?? {})}` };
}

/** Single entry point for every AI feature. */
export class AIService {
  constructor(private gemini = new GeminiClient()) {}

  get available() {
    return this.gemini.available;
  }

  async analyzeTimetable(userId: string | null, file: UploadedFile) {
    const parts: Part[] = [{ text: 'Extract the class timetable from this file.' }];
    const name = file.originalname.toLowerCase();

    if (IMAGE_TYPES.has(file.mimetype) || file.mimetype === 'application/pdf') {
      parts.push({ inlineData: { mimeType: file.mimetype, data: file.buffer.toString('base64') } });
    } else if (EXCEL_TYPES.has(file.mimetype) || name.endsWith('.xlsx')) {
      parts.push({ text: await excelToText(file.buffer) });
    } else if (file.mimetype.startsWith('text/') || name.endsWith('.csv') || name.endsWith('.tsv')) {
      parts.push({ text: file.buffer.toString('utf8').slice(0, 100_000) });
    } else {
      throw new HttpError(415, 'unsupported_file', 'Upload a PDF, image, Excel (.xlsx) or CSV file.');
    }

    return this.gemini.generateJson({
      feature: 'timetable',
      userId,
      system: P.TIMETABLE_SYSTEM,
      parts,
      schema: timetableExtractionSchema,
    });
  }

  /**
   * Natural-language command → validated intents. Only actions the student
   * permits are offered to the model, and the output is filtered again.
   */
  async command(userId: string | null, messages: ChatMessage[], context: unknown, today: string, permissions: Partial<AIPermissions>, files: UploadedFile[] = []) {
    const attachments = (await Promise.all(files.map(attachmentParts))).flat();
    const transcript = messages
      .slice(-16)
      .map((m) => `${m.role === 'user' ? 'Student' : 'AI Pilot'}: ${m.content}`)
      .join('\n\n');
    const raw = await this.gemini.generateJson({
      feature: 'command',
      userId,
      system: P.commandSystem(today, WEEKDAYS[weekdayOf(today)]!, actionCatalog(permissions)),
      parts: [
        contextPart(context),
        ...attachments,
        {
          text: `CONVERSATION:\n${transcript}\n\n${files.length ? `The student attached ${files.length} file(s) above with their last message. ` : ''}Respond to the student's last message.`,
        },
      ],
      schema: commandResponseSchema,
    });
    const { intents, rejected } = validateIntents(raw.actions, permissions);
    return { reply: raw.reply, intents, rejected, clarification: raw.clarification };
  }

  async generateFlashcards(userId: string | null, topic: string, notes: string | undefined, count: number) {
    return this.gemini.generateJson({
      feature: 'flashcards',
      userId,
      system: P.FLASHCARDS_SYSTEM,
      parts: [{ text: `Topic: ${topic}\nNumber of cards: ${count}\n${notes ? `Notes:\n${notes}` : ''}` }],
      schema: flashcardsResponseSchema,
    });
  }

  async generateQuiz(userId: string | null, topic: string, count: number, difficulty: string, notes?: string) {
    return this.gemini.generateJson({
      feature: 'quiz',
      userId,
      system: P.QUIZ_SYSTEM,
      parts: [{ text: `Topic: ${topic}\nQuestions: ${count}\nDifficulty: ${difficulty}\n${notes ? `Notes:\n${notes}` : ''}` }],
      schema: quizResponseSchema,
    });
  }

  async summarizeNotes(userId: string | null, title: string, body: string) {
    return this.gemini.generateJson({
      feature: 'notes',
      userId,
      system: P.NOTES_SYSTEM,
      parts: [{ text: `Title: ${title}\n\n${body}` }],
      schema: reviewSummarySchema,
    });
  }

  async review(userId: string | null, period: 'daily' | 'weekly', data: unknown) {
    return this.gemini.generateJson({
      feature: `${period}_review`,
      userId,
      system: P.REVIEW_SYSTEM,
      parts: [{ text: `This is a ${period} review.` }, contextPart(data)],
      schema: reviewSummarySchema,
    });
  }
}

async function excelToText(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new HttpError(400, 'invalid_file', "That Excel file couldn't be read. Try exporting it as CSV.");
  }
  const lines: string[] = [];
  workbook.eachSheet((sheet) => {
    lines.push(`# Sheet: ${sheet.name}`);
    sheet.eachRow((row) => {
      const values = (row.values as unknown[]).slice(1).map((v) => {
        if (v === null || v === undefined) return '';
        if (v instanceof Date) return v.toISOString().slice(11, 16);
        if (typeof v === 'object' && v && 'text' in v) return String((v as { text: unknown }).text);
        if (typeof v === 'object' && v && 'result' in v) return String((v as { result: unknown }).result);
        return String(v);
      });
      lines.push(values.map((s) => s.replace(/[\r\n]+/g, ' ')).join(' | '));
    });
  });
  return lines.join('\n').slice(0, 100_000);
}
