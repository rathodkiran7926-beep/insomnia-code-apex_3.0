import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
process.env.DATABASE_PATH = ':memory:';
const { db, saveSnapshot } = await import('../src/storage.js');
const { analyze } = await import('../src/analyzer.js');
const files = { 'a.ts': 'export const value = 1;\n' };
const make = (commit, source = files, repository = 'https://github.com/Owner/Repo') => {
  const g = analyze({ repository, commit: commit.repeat(40), files: source });
  saveSnapshot(g, { snapshotId: g.snapshotId }, '', source); return g;
};
const first = make('a'), second = make('b', { 'a.ts': 'export const value = 2;\n' }), foreign = make('c', { 'z.ts': 'export const z = 1;' }, 'https://github.com/other/repo');
db.prepare('INSERT INTO source_references VALUES (?,?,?)').run('foreign-only', foreign.snapshotId, JSON.stringify({ ...foreign.references[0], id: 'foreign-only' }));
let base, server;
test.before(async () => {
  const { default: express } = await import('express'); const { z } = await import('zod');
  const { ideRoutes } = await import('../src/ideRoutes.js');
  const app = express(); app.use(express.json({ limit: '24kb' })); app.use('/api/ide', ideRoutes);
  app.use((e, _q, r, _n) => r.status(e instanceof z.ZodError ? 400 : e.status || 500).json({ error: 'Request failed' }));
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/ide/checkpoints`;
});
test.after(() => { server.closeAllConnections(); server.close(); db.close(); });
const payload = (extra = {}) => ({ requestId: randomUUID(), snapshotId: first.snapshotId, taskTitle: '  Investigate value  ', notes: { discovery: ' original\n note ', unresolved: '?', nextStep: '' }, localContext: { branch: 'topic', headCommit: 'a'.repeat(40), gitStatus: 'modified' }, sourceReferenceIds: [first.references[0].id], ...extra });
const send = (path = '', method = 'GET', body, headers = {}) => fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
const scope = `?snapshotId=${first.snapshotId}`;
let saved;
test('checkpoint routes default disabled; explicit enable still rejects browser, DNS rebinding and forwarded requests', async () => {
  delete process.env.CODEBASE_MENTOR_LOCAL_CHECKPOINTS;
  assert.equal((await (await send('/capabilities')).json()).enabled, false);
  for (const method of ['GET', 'POST', 'DELETE']) assert.equal((await send('', method, method === 'POST' ? payload() : undefined)).status, 403);
  process.env.CODEBASE_MENTOR_LOCAL_CHECKPOINTS = '1';
  const status = await new Promise((resolve, reject) => { const q = request(base, { headers: { Host: 'attacker.example' } }, r => { r.resume(); resolve(r.statusCode); }); q.on('error', reject); q.end(); });
  assert.equal(status, 403);
  for (const headers of [{ Origin: 'https://attacker.example' }, { Forwarded: 'for=127.0.0.1' }, { 'X-Forwarded-For': '127.0.0.1' }, { Origin: 'null' }]) assert.equal((await send('', 'GET', undefined, headers)).status, 403, JSON.stringify(headers));
  assert.equal((await (await send('/capabilities')).json()).enabled, true);
});
test('save derives immutable identity and preserves explicit notes, with source-backed detail and idempotency', async () => {
  const p = payload(); const response = await send('', 'POST', p); assert.equal(response.status, 201);
  const detail = await response.json(); saved = detail.checkpoint;
  assert.equal(saved.repositoryIdentity, 'https://github.com/owner/repo'); assert.equal(saved.indexedCommit, 'a'.repeat(40));
  assert.deepEqual(saved.notes, p.notes); assert.equal(saved.taskTitle, p.taskTitle);
  assert.equal(detail.snapshotAvailable, true); assert(detail.references.length); assert(detail.components.length);
  assert(detail.references.every(r => r.snapshotId === first.snapshotId && !('excerpt' in r)));
  assert.equal((await (await send('', 'POST', p)).json()).checkpoint.id, saved.id);
  assert.equal((await send('', 'POST', { ...p, taskTitle: 'different' })).status, 409);
});
test('reject forged ownership, malformed bodies, missing snapshots, excessive notes/references and foreign evidence', async () => {
  for (const p of [payload({ repositoryIdentity: 'forged' }), payload({ indexedCommit: 'x' }), payload({ taskTitle: ' ' }), payload({ notes: { discovery: 'x'.repeat(2001), unresolved: '', nextStep: '' } }), payload({ sourceReferenceIds: Array(9).fill('x') }), payload({ sourceReferenceIds: ['foreign-only'] }), payload({ localContext: { gitStatus: 'fake' } }), payload({ requestId: 'not-a-uuid' })]) assert.equal((await send('', 'POST', p)).status, 400);
  assert.equal((await send('', 'POST', payload({ snapshotId: 'missing' }))).status, 404);
  assert.equal((await send('', 'POST', payload({ notes: { discovery: 'é'.repeat(16000), unresolved: '', nextStep: '' } }))).status, 413);
});

test('checkpoint authored controls fail before persistence while editing whitespace remains exact', async () => {
  process.env.CODEBASE_MENTOR_LOCAL_CHECKPOINTS = '1';
  const before = db.prepare('SELECT count(*) AS n FROM task_checkpoints').get().n;
  for (const control of ['\0', '\x01', '\x7f']) {
    for (const changed of [
      { taskTitle: `invalid${control}title` },
      { notes: { discovery: `invalid${control}note`, unresolved: '', nextStep: '' } },
      { notes: { discovery: '', unresolved: `invalid${control}note`, nextStep: '' } },
      { notes: { discovery: '', unresolved: '', nextStep: `invalid${control}note` } },
      { localContext: { branch: `invalid${control}branch`, gitStatus: 'clean' } },
    ]) assert.equal((await send('', 'POST', payload(changed))).status, 400);
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM task_checkpoints').get().n, before);
  const input = payload({ taskTitle: '  exact\t title\r\n ', notes: { discovery: '\t original\r\n note ', unresolved: '', nextStep: '\n' } });
  const response = await send('', 'POST', input);
  assert.equal(response.status, 201);
  const detail = await response.json();
  assert.equal(detail.checkpoint.taskTitle, input.taskTitle);
  assert.deepEqual(detail.checkpoint.notes, input.notes);
});
test('repository-scoped history excludes private notes and refs, orders and pages with bounds', async () => {
  await send('', 'POST', payload({ snapshotId: foreign.snapshotId, sourceReferenceIds: [] }));
  await Promise.all(Array.from({ length: 4 }, (_, i) => send('', 'POST', payload({ taskTitle: `task ${i}` }))));
  const a = await (await send(scope + '&limit=2')).json(), b = await (await send(scope + '&limit=2&offset=2')).json();
  assert.equal(a.items.length, 2); assert.equal(a.hasMore, true); assert(!a.items.some(x => x.repositoryIdentity !== 'https://github.com/owner/repo'));
  assert(a.items.every(x => !('notes' in x) && !('sourceReferenceIds' in x))); assert(!b.items.some(x => a.items.some(y => x.id === y.id)));
  for (const query of ['&limit=26', '&offset=-1', '&extra=1']) assert.equal((await send(scope + query)).status, 400);
  assert.equal((await send(`/${saved.id}?snapshotId=${foreign.snapshotId}`)).status, 409);
  assert.equal((await send(`/${randomUUID()}${scope}`)).status, 404);
});
test('resume compares stored whole files only and labels local metadata separately', async () => {
  const same = await (await send(`/${saved.id}/resume`, 'POST', { currentSnapshotId: first.snapshotId, localContext: { headCommit: 'a'.repeat(40), gitStatus: 'clean' } })).json();
  assert.deepEqual(same.detail.checkpoint.notes, saved.notes); assert.deepEqual(same.versions, { indexed: 'same', localHead: 'same' }); assert.equal(same.changes.items[0].status, 'unchanged');
  const changed = await (await send(`/${saved.id}/resume`, 'POST', { currentSnapshotId: second.snapshotId, localContext: { headCommit: 'b'.repeat(40), gitStatus: 'modified' } })).json();
  assert.deepEqual(changed.versions, { indexed: 'different', localHead: 'different' }); assert.equal(changed.changes.items[0].status, 'changed'); assert.equal(changed.changes.items[0].scope, 'file'); assert.equal(changed.currentSnapshot.snapshotId, second.snapshotId);
  db.prepare('DELETE FROM source_files WHERE snapshot_id=?').run(second.snapshotId);
  const unknown = await (await send(`/${saved.id}/resume`, 'POST', { currentSnapshotId: second.snapshotId, localContext: { gitStatus: 'unknown' } })).json();
  assert.equal(unknown.versions.localHead, 'unknown'); assert.equal(unknown.changes.items[0].status, 'unknown'); assert.equal(unknown.changes.status, 'unavailable'); assert(!unknown.comparison);
});
test('failed transactional write rolls back without damaging existing checkpoints', async () => {
  db.exec("CREATE TRIGGER fail_checkpoint BEFORE INSERT ON task_checkpoints WHEN NEW.task_title='fail' BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.equal((await send('', 'POST', payload({ taskTitle: 'fail' }))).status, 500);
  db.exec('DROP TRIGGER fail_checkpoint'); assert.equal((await send(`/${saved.id}${scope}`)).status, 200);
  assert.equal((await send('', 'POST', payload({ taskTitle: 'after rollback' }))).status, 201);
});
test('concurrent duplicate saves produce one persisted checkpoint and preserve rollback integrity', async () => {
  const p = payload({ taskTitle: 'one deliberate save' });
  const responses = await Promise.all(Array.from({ length: 8 }, () => send('', 'POST', p)));
  assert.equal(responses.filter(r => r.status === 201).length, 1);
  const ids = await Promise.all(responses.map(async r => (await r.json()).checkpoint.id)); assert.equal(new Set(ids).size, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM task_checkpoints WHERE request_id=?').get(p.requestId).n, 1);
});
test('unsafe persisted source paths or citation URLs never become checkpoint evidence', async () => {
  const original = first.references[0];
  for (const changes of [{ file: '../secret' }, { url: 'https://attacker.example/a' }, { snapshotId: foreign.snapshotId }]) {
    db.prepare('UPDATE source_references SET data=? WHERE snapshot_id=? AND id=?').run(JSON.stringify({ ...original, ...changes }), first.snapshotId, original.id);
    assert.equal((await send('', 'POST', payload())).status, 400);
  }
  db.prepare('UPDATE source_references SET data=? WHERE snapshot_id=? AND id=?').run(JSON.stringify(original), first.snapshotId, original.id);
});
test('checkpoint creation rejects malformed immutable citation coordinates before persistence', async () => {
  const original = first.references[0], url = new URL(original.url);
  const count = () => db.prepare('SELECT count(*) AS n FROM task_checkpoints').get().n;
  const before = count();
  try {
    for (const invalid of [original.url.split('#')[0], original.url.replace(/#.*$/, '#L999-L999'), original.url.replace('#', '?download=1#'), original.url.replace('https://', 'https://user:password@'), original.url.replace('/blob/', '/tree/'), original.url.replace('/a.ts', '/%61.ts')]) {
      db.prepare('UPDATE source_references SET data=? WHERE snapshot_id=? AND id=?').run(JSON.stringify({ ...original, url: invalid }), first.snapshotId, original.id);
      assert.equal((await send('', 'POST', payload())).status, 400, invalid);
      assert.equal(count(), before);
    }
    url.pathname = url.pathname.replace('/Owner/Repo/', '/OWNER/REPO/');
    db.prepare('UPDATE source_references SET data=? WHERE snapshot_id=? AND id=?').run(JSON.stringify({ ...original, url: url.href }), first.snapshotId, original.id);
    assert.equal((await send('', 'POST', payload())).status, 201);
  } finally {
    db.prepare('UPDATE source_references SET data=? WHERE snapshot_id=? AND id=?').run(JSON.stringify(original), first.snapshotId, original.id);
  }
});
test('resume offers existing PR comparison only for exact snapshots and verified same-repository PR identity', async () => {
  db.exec('CREATE TABLE IF NOT EXISTS pr_comparisons(id TEXT PRIMARY KEY,base_snapshot_id TEXT NOT NULL,head_snapshot_id TEXT NOT NULL,data TEXT NOT NULL)');
  const comparisonId = randomUUID();
  const comparison = { id: comparisonId, beforeSnapshotId: first.snapshotId, afterSnapshotId: second.snapshotId, pr: { url: 'https://github.com/owner/repo/pull/42', baseRepository: first.repository, headRepository: first.repository, baseCommit: first.commit, headCommit: second.commit } };
  db.prepare('INSERT INTO pr_comparisons VALUES (?,?,?,?)').run(comparisonId, first.snapshotId, second.snapshotId, JSON.stringify(comparison));
  const resume = async () => (await (await send(`/${saved.id}/resume`, 'POST', { currentSnapshotId: second.snapshotId, localContext: { gitStatus: 'unknown' } })).json());
  assert.deepEqual((await resume()).comparison, { id: comparisonId, prUrl: 'https://github.com/owner/repo/pull/42', beforeSnapshotId: first.snapshotId, afterSnapshotId: second.snapshotId });
  db.prepare('UPDATE pr_comparisons SET data=? WHERE id=?').run(JSON.stringify({ ...comparison, pr: { ...comparison.pr, baseRepository: foreign.repository } }), comparisonId);
  assert.equal((await resume()).comparison, undefined);
});
test('checkpoint survives separate backend processes against the same file SQLite database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mentor-checkpoint-'));
  const database = join(directory, 'checkpoint.sqlite');
  const script = `import {db,saveSnapshot} from './src/storage.js';
    import {migrateCheckpoints,createCheckpoint,getCheckpoint} from './src/checkpoints.js';
    migrateCheckpoints(db);
    if(process.env.STAGE==='save') {
      saveSnapshot({snapshotId:'persist',repository:'https://github.com/a/b',commit:'a'.repeat(40),components:[],relationships:[],references:[],report:{limitations:[]}}, {}, '');
      const result=createCheckpoint(db,{requestId:'00000000-0000-4000-8000-000000000001',snapshotId:'persist',taskTitle:'Survive restart',notes:{discovery:'exact persisted note',unresolved:'?',nextStep:''},localContext:{gitStatus:'unknown'},sourceReferenceIds:[]});
      console.log(result.detail.checkpoint.id);
    } else { console.log(JSON.stringify(getCheckpoint(db,process.env.CHECKPOINT_ID,'persist'))); }
    db.close();`;
  try {
    const cwd = new URL('..', import.meta.url);
    const run = env => spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd, env: { ...process.env, DATABASE_PATH: database, ...env }, encoding: 'utf8' });
    const a = run({ STAGE: 'save' }); assert.equal(a.status, 0, a.stderr);
    const b = run({ STAGE: 'read', CHECKPOINT_ID: a.stdout.trim() }); assert.equal(b.status, 0, b.stderr);
    const detail = JSON.parse(b.stdout); assert.equal(detail.checkpoint.notes.discovery, 'exact persisted note'); assert.equal(detail.checkpoint.taskTitle, 'Survive restart');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('missing original snapshot preserves notes, and deleting one checkpoint leaves analysis and others intact', async () => {
  const other = (await (await send('', 'POST', payload())).json()).checkpoint;
  db.prepare('DELETE FROM snapshots WHERE id=?').run(first.snapshotId);
  const detail = await (await send(`/${saved.id}?snapshotId=${second.snapshotId}`)).json(); assert.equal(detail.snapshotAvailable, false); assert.deepEqual(detail.checkpoint.notes, saved.notes); assert.equal(detail.references.length, 0);
  const q = `?snapshotId=${second.snapshotId}`;
  assert.equal((await send(`/${saved.id}${q}`, 'DELETE')).status, 200); assert.equal((await send(`/${saved.id}${q}`, 'DELETE')).status, 404);
  assert.equal((await send(`/${other.id}${q}`)).status, 200); assert(db.prepare('SELECT id FROM snapshots WHERE id=?').get(second.snapshotId));
});
