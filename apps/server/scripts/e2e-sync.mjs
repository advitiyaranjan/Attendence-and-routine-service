// End-to-end check of a running API + Postgres: auth, sync, conflicts, idempotency, isolation.
// Usage: start the server (npm run dev:server), then `node apps/server/scripts/e2e-sync.mjs`.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const BASE = process.env.API_URL ?? 'http://localhost:4000';
function client() {
  let cookie = '';
  return async (path, body, method = body ? 'POST' : 'GET') => {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'student-os', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}
const now = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const meta = (id, deviceId, version, updatedAt) => ({ id, createdAt: now(-10_000), updatedAt, deletedAt: null, version, deviceId, syncStatus: 'pending' });
const op = (entity, record, baseVersion, deviceId, operation = 'upsert') => ({
  operationId: randomUUID(), entity, entityId: record.id, operation, payload: record, baseVersion, timestamp: now(), deviceId,
});

const health = await client()('/api/health');
assert.equal(health.status, 200);

// --- Auth
const A = client();
const email = `student-${Date.now()}@example.com`;
let r = await A('/api/auth/register', { email, password: 'correct-horse', name: 'Advitiya' });
assert.equal(r.status, 201, JSON.stringify(r.body));
r = await A('/api/auth/me');
assert.equal(r.body.user.email, email);
const bad = await client()('/api/auth/login', { email, password: 'wrong-password' });
assert.equal(bad.status, 401);
console.log('✓ register / me / wrong password rejected');

// Same account on a second device
const B = client();
r = await B('/api/auth/login', { email, password: 'correct-horse' });
assert.equal(r.status, 200);

// --- Device A pushes a subject, schedule, attendance and settings
const subjectId = randomUUID();
const scheduleId = randomUUID();
const instanceId = randomUUID();
const subject = { ...meta(subjectId, 'dev-A', 0, now()), name: 'DBMS', color: '#2a78d6' };
const schedule = { ...meta(scheduleId, 'dev-A', 0, now()), subjectId, weekday: 1, startTime: '09:00', endTime: '10:00' };
const instance = { ...meta(instanceId, 'dev-A', 0, now()), scheduleId, subjectId, date: '2026-10-05', startTime: '09:00', endTime: '10:00', status: 'present' };
const settings = { ...meta('settings', 'dev-A', 0, now()), minAttendance: 80, onboarded: true };
// Deliberately out of order: the server must apply parents first.
const ops1 = [op('classInstance', instance, 0, 'dev-A'), op('classSchedule', schedule, 0, 'dev-A'), op('subject', subject, 0, 'dev-A'), op('settings', settings, 0, 'dev-A')];
r = await A('/api/sync', { deviceId: 'dev-A', cursor: null, operations: ops1 });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.deepEqual(r.body.results.map((x) => x.status), ['applied', 'applied', 'applied', 'applied']);
const cursorA = r.body.cursor;
console.log('✓ push applied (parents ordered before children), cursor', cursorA);

// Idempotent retry: same operation ids → same results, no duplicate changes
r = await A('/api/sync', { deviceId: 'dev-A', cursor: cursorA, operations: ops1 });
assert.deepEqual(r.body.results.map((x) => x.status), ['applied', 'applied', 'applied', 'applied']);
assert.equal(r.body.changes.length, 0);
console.log('✓ retried upload is idempotent');

// --- Device B pulls everything
r = await B('/api/sync', { deviceId: 'dev-B', cursor: null, operations: [] });
const pulled = Object.fromEntries(r.body.changes.map((c) => [c.entity, c.record]));
assert.equal(pulled.subject.name, 'DBMS');
assert.equal(pulled.classInstance.status, 'present');
assert.equal(pulled.settings.minAttendance, 80);
assert.equal(pulled.settings.id, 'settings');
let cursorB = r.body.cursor;
console.log('✓ second device pulled', r.body.changes.length, 'records');

// --- Conflict: both devices edit the same attendance offline (both based on version 1)
const fromA = { ...pulled.classInstance, status: 'present', deviceId: 'dev-A', updatedAt: now(1000) };
const fromB = { ...pulled.classInstance, status: 'absent', deviceId: 'dev-B', updatedAt: now(2000) }; // later edit
r = await A('/api/sync', { deviceId: 'dev-A', cursor: cursorA, operations: [op('classInstance', fromA, 1, 'dev-A')] });
assert.equal(r.body.results[0].status, 'applied');
r = await B('/api/sync', { deviceId: 'dev-B', cursor: cursorB, operations: [op('classInstance', fromB, 1, 'dev-B')] });
assert.equal(r.body.results[0].status, 'conflict_won', JSON.stringify(r.body.results));
cursorB = r.body.cursor;
// A late, older edit from A loses and receives the winner back
const lateA = { ...pulled.classInstance, status: 'cancelled', deviceId: 'dev-A', updatedAt: now(500) };
r = await A('/api/sync', { deviceId: 'dev-A', cursor: cursorA, operations: [op('classInstance', lateA, 2, 'dev-A')] });
assert.equal(r.body.results[0].status, 'conflict_lost');
const winner = r.body.changes.find((c) => c.entity === 'classInstance').record;
assert.equal(winner.status, 'absent');
r = await A('/api/sync/conflicts');
assert.equal(r.body.conflicts.length, 2);
assert.ok(r.body.conflicts.some((c) => c.loser.status === 'cancelled'), 'loser preserved');
console.log('✓ concurrent edits resolved by last-write-wins; losers preserved in conflict log');

// --- Soft delete propagates
const del = { ...pulled.subject, deletedAt: now(3000), updatedAt: now(3000), deviceId: 'dev-B' };
r = await B('/api/sync', { deviceId: 'dev-B', cursor: cursorB, operations: [op('subject', del, 1, 'dev-B', 'delete')] });
assert.equal(r.body.results[0].status, 'applied');
r = await A('/api/sync', { deviceId: 'dev-A', cursor: cursorA, operations: [] });
assert.ok(r.body.changes.find((c) => c.entity === 'subject').record.deletedAt);
console.log('✓ soft delete synced to the other device');

// --- Validation and isolation
r = await A('/api/sync', { deviceId: 'dev-A', cursor: null, operations: [op('task', { ...meta(randomUUID(), 'dev-A', 0, now()), title: '' }, 0, 'dev-A')] });
assert.equal(r.body.results[0].status, 'rejected');
const C = client();
await C('/api/auth/register', { email: `other-${Date.now()}@example.com`, password: 'another-pass' });
r = await C('/api/sync', { deviceId: 'dev-C', cursor: null, operations: [op('subject', { ...subject, name: 'Hijacked', updatedAt: now(9000) }, 5, 'dev-C')] });
assert.equal(r.body.results[0].status, 'rejected');
assert.equal(r.body.changes.length, 0);
r = await C('/api/subjects');
assert.equal(r.body.data.length, 0);
r = await A('/api/subjects?includeDeleted=true');
assert.equal(r.body.data[0].name, 'DBMS');
console.log('✓ invalid records rejected; other accounts cannot read or overwrite data');

// --- AI without a key degrades gracefully
r = await A('/api/ai/status');
console.log('  AI status:', r.body);
r = await A('/api/ai/tasks', { text: 'solve 15 DSA questions', today: '2026-10-02' });
assert.equal(r.status, 503);
assert.match(r.body.error.message, /not configured/);
console.log('✓ AI endpoints report unavailable cleanly without a Gemini key');
console.log('\nALL E2E CHECKS PASSED');
