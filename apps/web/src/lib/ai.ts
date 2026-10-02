/** Client side of the AI features. Gemini is only reachable through our server. */
import { fmtPct, type QuizResponse, type ReviewSummary, type TimetableExtraction } from '@student-os/core';
import { api, ApiError } from './api';
import { useApp } from './store';

export function aiStatus() {
  return api<{ available: boolean }>('/api/ai/status');
}

/** Ask the server whether AI works, and remember why not if it doesn't. */
export async function refreshAiStatus(): Promise<boolean> {
  try {
    const s = await aiStatus();
    useApp.setState({ aiAvailable: s.available, aiIssue: s.available ? null : "AI isn't configured on the server yet (GEMINI_API_KEY is not set)." });
    return s.available;
  } catch (err) {
    const issue =
      err instanceof ApiError && (err.code === 'no_server' || err.code === 'no_api' || err.code === 'offline')
        ? err.message
        : "Can't reach the AI service right now. Please try again shortly.";
    useApp.setState({ aiAvailable: false, aiIssue: issue });
    return false;
  }
}

/** Hosts such as Vercel reject request bodies over 4.5 MB; stay safely below that. */
const MAX_UPLOAD = 4 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2400;

/** Shrink large photos/screenshots (keeps them readable for the AI) so uploads stay small and fast. */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/heic' || file.type === 'image/heif') return file;
  if (file.size < 1_500_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export async function extractTimetable(file: File) {
  const upload = await shrinkImage(file);
  if (upload.size > MAX_UPLOAD) {
    throw new ApiError('That file is larger than 4 MB. Upload a screenshot or a smaller PDF instead.', 'too_large', 413);
  }
  const form = new FormData();
  form.append('file', upload);
  return api<TimetableExtraction>('/api/ai/timetable', { form });
}

export function flashcards(topic: string, notes?: string, count = 10) {
  return api<{ cards: Array<{ question: string; answer: string }> }>('/api/ai/flashcards', { body: { topic, notes, count } });
}

export function quiz(topic: string, count: 5 | 10 | 20, difficulty: 'easy' | 'medium' | 'hard' | 'mixed', notes?: string) {
  return api<QuizResponse>('/api/ai/quiz', { body: { topic, count, difficulty, notes } });
}

export function summarizeNote(title: string, body: string) {
  return api<ReviewSummary>('/api/ai/notes', { body: { title, body } });
}

export function review(period: 'daily' | 'weekly', data: unknown) {
  return api<ReviewSummary>('/api/ai/review', { body: { period, data } });
}

export { fmtPct };
