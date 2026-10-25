import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
process.env.DATABASE_PATH = ':memory:';
delete process.env.LLM_API_KEY;
const { db, saveSnapshot } = await import('../src/storage.js');
const { collaborationRoutes } = await import('../src/collaborationAuth.js');
const { handoffRoutes } = await import('../src/handoffRoutes.js');
const { ideTeamRoutes } = await import('../src/ideTeamRoutes.js');
const { checkpointRoutes } = await import('../src/checkpointRoutes.js');
const { analyze } = await import('../src/analyzer.js');
const { seedIdeDemo } = await import('../src/ideDemoSeed.js');
const app = express(); app.use(express.json());
app.use('/api/collaboration', collaborationRoutes);
app.use('/api/handoffs', handoffRoutes);
app.use('/api/ide/team', ideTeamRoutes);
app.use('/api/ide/checkpoints', checkpointRoutes);
app.use((error, _req, res, _next) => res.status(error.status || 400).json({ error: error.message }));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
after(() => new Promise(resolve => server.close(resolve)));
const base = `http://127.0.0.1:${server.address().port}`;
async function api(path, cookie = '', body, method = body ? 'POST' : 'GET') {
  const result = await fetch(base + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: result.status, data: await result.json(), cookie: result.headers.get('set-cookie')?.split(';')[0] || '' };
}
test('local demo seeding is opt-in, forbidden in production, and preserves existing credentials', () => {
  assert.throws(() => seedIdeDemo(db, { enabled: false }), /requires/);
  assert.throws(() => seedIdeDemo(db, { enabled: true, production: true }), /forbidden/);
  seedIdeDemo(db, { enabled: true });
  const before = db.prepare('SELECT password_hash FROM collaboration_users ORDER BY id').all();
  seedIdeDemo(db, { enabled: true });
  assert.deepEqual(db.prepare('SELECT password_hash FROM collaboration_users ORDER BY id').all(), before);
  assert.equal(db.prepare('SELECT count(*) AS n FROM collaboration_users').get().n, 2);
});
test('IDE sessions are user-owned; web handoffs retain membership checks and senior feedback', async () => {
  const junior = await api('/api/collaboration/login', '', { email: 'junior@demo.com', password: 'Demo@12345Local' });
  const senior = await api('/api/collaboration/login', '', { email: 'senior@demo.com', password: 'Demo@12345Local' });
  assert.equal(junior.status, 200); assert.equal(senior.status, 200);
  const outsider = await api('/api/collaboration/register', '', { name: 'Outside reviewer', email: 'outside@test.example', password: 'separate password 123' });
  const account = await api('/api/collaboration/me', junior.cookie);
  const workspaceId = account.data.workspaces[0].id;
  const files = { 'src/auth.ts': 'export function verifyEmail(token: string) {\n  return token.length > 0;\n}\n' };
  const graph = analyze({ repository: 'https://github.com/example/email-check', commit: 'a'.repeat(40), files });
  saveSnapshot(graph, { snapshotId: graph.snapshotId }, '', files);
  const component = graph.components.find(c => c.name === 'verifyEmail');
  const body = { requestId: randomUUID(), snapshotId: graph.snapshotId, taskTitle: 'Email verification', notes: { discovery: 'Verification is implemented.', unresolved: 'Check token expiration.', nextStep: 'Review expiration handling.' }, localContext: { branch: 'email-check', headCommit: graph.commit, gitStatus: 'modified' }, sourceReferenceIds: [component.referenceId] };
  assert.equal((await api('/api/ide/team/checkpoints/capabilities')).status, 401);
  assert.equal((await api('/api/ide/team/checkpoints/capabilities', junior.cookie)).data.mode, 'authenticated-user');
  const created = await api('/api/ide/team/checkpoints', junior.cookie, body);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.checkpoint.id, suffix = `?snapshotId=${graph.snapshotId}`;
  assert.equal((await api('/api/ide/team/checkpoints' + suffix, junior.cookie)).data.items.length, 1);
  assert.equal((await api('/api/ide/team/checkpoints' + suffix, senior.cookie)).data.items.length, 0);
  for (const method of ['GET', 'DELETE']) assert.equal((await api(`/api/ide/team/checkpoints/${id}${suffix}`, senior.cookie, undefined, method)).status, 404);
  assert.equal((await api(`/api/ide/team/checkpoints/${id}/resume`, senior.cookie, { currentSnapshotId: graph.snapshotId, localContext: body.localContext })).status, 404);
  assert.equal((await api('/api/ide/team/checkpoints', senior.cookie, body)).status, 404, 'Request UUID reuse must not expose another user\'s session');
  assert.equal((await api(`/api/ide/team/checkpoints/${id}/resume`, junior.cookie, { currentSnapshotId: graph.snapshotId, localContext: body.localContext })).data.detail.checkpoint.notes.unresolved, body.notes.unresolved);
  const requestId = randomUUID();
  const handoff = await api('/api/handoffs', junior.cookie, { requestId, workspaceId, snapshotId: graph.snapshotId, referenceId: component.referenceId, startLine: 1, endLine: 3, title: body.taskTitle, question: `${body.notes.unresolved}\nSaved session: ${id}`, actualBehavior: body.notes.discovery, expectedBehavior: body.notes.nextStep, attemptedSolutions: '', assignedTo: senior.data.user.id });
  assert.equal(handoff.status, 201, JSON.stringify(handoff.data));
  const shared = `/api/handoffs/${requestId}`;
  assert.equal((await api(shared)).status, 401);
  assert.equal((await api(shared, outsider.cookie)).status, 404);
  const link = await api(shared + '/share', junior.cookie, {});
  assert.equal(link.data.path, `/#/handoffs/${requestId}`);
  assert.equal((await api(shared, senior.cookie)).data.snapshot.function_name, 'verifyEmail');
  const reply = await api(shared + '/comments', senior.cookie, { content: 'Add an expiration check before accepting the token.' });
  assert.equal(reply.status, 201);
  const refreshed = await api(shared, junior.cookie);
  assert(refreshed.data.comments.some(c => c.content.includes('expiration check')));
  assert.equal((await api(`/api/ide/team/checkpoints/${id}${suffix}`, junior.cookie, undefined, 'DELETE')).status, 200);
  assert.equal((await api(shared, senior.cookie)).status, 200, 'Deleting a personal checkpoint must preserve its shared handoff');
});


test('native local IDE connection needs no credentials and does not unlock anonymous web requests', async () => {
  const previous = process.env.CODEBASE_MENTOR_IDE_DEMO;
  const previousMode = process.env.NODE_ENV;
  const connect = (headers = {}) => new Promise((resolve, reject) => {
    const request = httpRequest(base + '/api/ide/team/connect', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Codebase-Mentor-Client': 'vscode', ...headers }
    }, response => { response.resume(); response.on('end', () => resolve({ status: response.statusCode, headers: new Headers(response.headers) })); });
    request.on('error', reject); request.end('{}');
  });
  try {
    delete process.env.CODEBASE_MENTOR_IDE_DEMO;
    assert.equal((await connect()).status, 403);
    process.env.CODEBASE_MENTOR_IDE_DEMO = '1';
    assert.equal((await connect({ Origin: 'http://localhost:5173' })).status, 403);
    assert.equal((await connect({ 'Sec-Fetch-Site': 'same-origin' })).status, 403);
    assert.equal((await connect({ 'X-Forwarded-For': '203.0.113.1' })).status, 403);
    assert.equal((await connect({ Host: 'remote.example.test' })).status, 403);
    assert.equal((await connect({ 'X-Codebase-Mentor-Client': '' })).status, 403);
    process.env.NODE_ENV = 'production';
    assert.equal((await connect()).status, 403);
    if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
    const response = await connect();
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal((await api('/api/collaboration/me', cookie)).data.user.email, 'junior@demo.com');
    assert.equal((await api('/api/collaboration/me')).status, 401);
    assert.equal((await api('/api/ide/team/checkpoints/capabilities', cookie)).status, 200);
    assert.equal((await api('/api/handoffs')).status, 401);
  } finally {
    if (previous === undefined) delete process.env.CODEBASE_MENTOR_IDE_DEMO; else process.env.CODEBASE_MENTOR_IDE_DEMO = previous;
    if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
  }
});
