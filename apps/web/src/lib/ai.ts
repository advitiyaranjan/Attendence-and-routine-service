/** Client side of the AI features. Gemini is only reachable through our server. */
import { fmtPct, type QuizResponse, type ReviewSummary, type TimetableExtraction } from '@student-os/core';
import { api } from './api';

export function aiStatus() {
  return api<{ available: boolean }>('/api/ai/status');
}

export function extractTimetable(file: File) {
  const form = new FormData();
  form.append('file', file);
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
