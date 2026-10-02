import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { timetableExtractionSchema, type SyncOperation } from '@student-os/core';
import { createApp } from './app';
import { validateOperation } from './modules/sync/service';
import { GeminiClient } from './modules/ai/gemini';
import { HttpError } from './lib/http';
import { signActionToken, verifyActionToken } from './modules/push/scheduler';

const now = '2026-10-02T10:00:00.000Z';

function op(overrides: Partial<SyncOperation> = {}, payload: Record<string, unknown> = {}): SyncOperation {
  return {
    operationId: 'op-1',
    entity: 'subject',
    entityId: 'sub-1',
    operation: 'upsert',
    baseVersion: 0,
    timestamp: now,
    deviceId: 'dev-A',
    payload: {
      id: 'sub-1',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 0,
      deviceId: 'dev-A',
      syncStatus: 'pending',
      name: 'DBMS',
      ...payload,
    },
    ...overrides,
  };
}

describe('sync validation', () => {
  it('accepts a valid record and applies schema defaults', () => {
    const rec = validateOperation(op(), Date.parse(now));
    expect(rec).toMatchObject({ id: 'sub-1', name: 'DBMS', color: '#6366f1', active: true });
  });

  it('accepts payloads exactly as the web client sends them (no syncStatus)', () => {
    const o = op();
    const { syncStatus: _drop, ...payload } = o.payload as Record<string, unknown>;
    expect(validateOperation({ ...o, payload }, Date.parse(now))).toMatchObject({ id: 'sub-1', name: 'DBMS' });
  });

  it('forces the entity id from the operation, not the payload', () => {
    const rec = validateOperation(op({ entityId: 'sub-2' }, { id: 'someone-elses-id' }), Date.parse(now));
    expect(rec.id).toBe('sub-2');
  });

  it('rejects malformed payloads', () => {
    expect(() => validateOperation(op({}, { name: '' }))).toThrow(HttpError);
    expect(() => validateOperation(op({ entity: 'classSchedule' }, { weekday: 9, startTime: '25:00' }))).toThrow(HttpError);
    expect(() => validateOperation(op({}, { updatedAt: 'not-a-dateeee' }))).toThrow(HttpError);
  });

  it('turns delete operations into soft deletes', () => {
    const rec = validateOperation(op({ operation: 'delete' }), Date.parse(now));
    expect(rec.deletedAt).toBe(now);
  });

  it('clamps timestamps from clocks running far ahead', () => {
    const rec = validateOperation(op({}, { updatedAt: '2030-01-01T00:00:00.000Z' }), Date.parse(now));
    expect(rec.updatedAt).toBe(now);
  });
});

describe('Gemini output validation', () => {
  function clientReturning(...texts: string[]) {
    const client = new GeminiClient('test-key', 'test-model');
    const generateContent = vi.fn();
    for (const text of texts) generateContent.mockResolvedValueOnce({ text, usageMetadata: {} });
    (client as unknown as { ai: { models: { generateContent: typeof generateContent } } }).ai = { models: { generateContent } };
    return { client, generateContent };
  }
  const opts = { feature: 'timetable', userId: null, system: 's', parts: [{ text: 'x' }], schema: timetableExtractionSchema };

  it('rejects a null subject after one corrective retry', async () => {
    const { client, generateContent } = clientReturning('{"subject": null}', '{"subjects": [{"name": null}]}');
    await expect(client.generateJson(opts)).rejects.toMatchObject({ status: 422, code: 'ai_invalid_output' });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('recovers when the retry is valid', async () => {
    const { client } = clientReturning(
      'not json at all',
      '```json\n{"subjects":[{"name":"OS","day":"Monday","start_time":"10:00","end_time":"11:00"}]}\n```',
    );
    const result = await client.generateJson(opts);
    expect(result.subjects[0]).toMatchObject({ name: 'OS', day: 1, type: 'lecture' });
  });

  it('falls back to the next model when one is overloaded', async () => {
    const client = new GeminiClient('k', 'primary', ['backup']);
    client.retryDelayMs = 0;
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('{"error":{"code":503,"message":"high demand"}}'), { status: 503 }))
      .mockResolvedValueOnce({ text: '{"subjects":[{"name":"OS","day":"Mon","start_time":"9","end_time":"10"}]}', usageMetadata: {} });
    (client as unknown as { ai: unknown }).ai = { models: { generateContent } };
    const out = await client.generateJson(opts);
    expect(out.subjects).toHaveLength(1);
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual(['primary', 'backup']);
  });

  it('reports unavailability when no API key is configured', async () => {
    const client = new GeminiClient('', 'm');
    await expect(client.generateJson(opts)).rejects.toMatchObject({ status: 503 });
  });
});

describe('HTTP security', () => {
  const app = createApp();

  it('serves health checks', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('blocks state-changing requests without the CSRF header', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'password1' });
    expect(res.status).toBe(403);
  });

  it('requires a session for sync', async () => {
    const res = await request(app).post('/api/sync').set('X-Requested-With', 'student-os').send({ deviceId: 'd', cursor: null, operations: [] });
    expect(res.status).toBe(401);
    expect(res.body.error.message).not.toMatch(/stack|prisma/i);
  });

  it('rejects forged session cookies', async () => {
    const res = await request(app).get('/api/subjects').set('Cookie', 'sos_session=forged.token.value');
    expect(res.status).toBe(401);
  });

  it('validates AI input before calling the model', async () => {
    const res = await request(app).post('/api/ai/command').set('X-Requested-With', 'student-os').send({ messages: [], today: 'tomorrow' });
    expect(res.status).toBe(400);
  });
});

describe('notification action tokens', () => {
  it('round-trips and rejects tampering', () => {
    const token = signActionToken('user-1', { key: 'attend:x', type: 'attendance_prompt', entityType: 'class_instance', entityId: 'x', data: {} }, { title: 't' });
    expect(verifyActionToken(token)).toMatchObject({ sub: 'user-1', key: 'attend:x' });
    expect(verifyActionToken(token.slice(0, -2) + 'xx')).toBeNull();
  });

  it('requires a session for notification actions', async () => {
    const res = await request(createApp()).post('/api/notifications/action').set('X-Requested-With', 'student-os').send({ token: 'x'.repeat(20), action: 'present' });
    expect(res.status).toBe(401);
  });
});
