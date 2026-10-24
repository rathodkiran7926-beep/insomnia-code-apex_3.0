const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { once } = require('node:events');
const path = require('node:path');
const { MentorApi, Connection, BindingStore, RepositoryController } = require('../.test-output/library.cjs');

test('actual shared backend supports health, stopped-server failure and retry after restart', async t => {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  let backend;
  let diagnostics = '';
  let snapshotId;
  async function start() {
    backend = spawn(process.execPath, [path.join(__dirname, 'backend-fixture.mjs')], {
      cwd: path.resolve(__dirname, '../../backend'),
      env: { ...process.env, PORT: String(port), DATABASE_PATH: ':memory:', MENTOR_FIXTURE_INPUTS: JSON.stringify([{ repository: 'https://github.com/mentor-fixtures/repo', commit: 'a'.repeat(40) }]) },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    backend.stdout.on('data', chunk => {
      diagnostics += chunk;
      const match = /MENTOR_FIXTURES:(\[[^\n]+\])/.exec(diagnostics);
      if (match) snapshotId = JSON.parse(match[1])[0].snapshotId;
    });
    backend.stderr.on('data', chunk => { diagnostics += chunk; });
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {}
      if (backend.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Real backend startup failed: ${diagnostics}`);
  }
  async function stop() {
    if (backend && backend.exitCode === null) {
      const exited = once(backend, 'exit'); backend.kill(); await exited;
    }
  }
  const connection = new Connection(new MentorApi(() => `http://127.0.0.1:${port}`));
  t.after(async () => { connection.dispose(); await stop(); });
  await start(); await connection.check();
  assert.equal(connection.state.status, 'connected');
  const api = new MentorApi(() => `http://127.0.0.1:${port}`);
  const snapshot = await api.snapshot(snapshotId);
  assert.equal(snapshot.repositoryIdentity, 'https://github.com/mentor-fixtures/repo');
  assert.equal(snapshot.indexedCommit, 'a'.repeat(40));
  const evidence = await api.evidence(snapshotId);
  const resolved = await api.resolveSelection(evidence, 'src/index.ts', 1, 1);
  assert.equal(resolved.candidates[0].name, 'greet');
  const answer = await api.question(evidence, resolved.candidates[0].componentId, 'Explain this component');
  assert.equal(answer.mode, 'facts'); assert.equal(answer.componentId, resolved.candidates[0].componentId);
  const indexedSource = await api.source(evidence, answer.citations[0]);
  assert.ok(indexedSource.excerpt.includes('export function greet'));
  assert.equal(indexedSource.snapshotId, snapshotId);
  await assert.rejects(api.snapshot('does-not-exist'), error => error.status === 404);
  const values = new Map();
  const store = new BindingStore({ get: key => values.get(key), update: async (key, value) => values.set(key, value) });
  const folder = { uri: 'file:///fixture', name: 'fixture' };
  const env = { folders: () => [folder], trusted: () => true, git: () => ({ identity: snapshot.repositoryIdentity, head: snapshot.indexedCommit }) };
  const controller = new RepositoryController(api, store, env);
  await controller.connect(folder, snapshotId, async () => true);
  assert.equal(controller.context(folder).comparison.revision, 'matched');
  controller.dispose();
  const restarted = new RepositoryController(api, store, env); await restarted.restore();
  assert.equal(restarted.context(folder).status, 'ready');
  await stop(); await connection.check();
  assert.equal(connection.state.status, 'disconnected');
  await restarted.refresh(folder); assert.equal(restarted.context(folder).status, 'unavailable');
  await start(); await connection.check();
  assert.equal(connection.state.status, 'connected');
  await restarted.refresh(folder); assert.equal(restarted.context(folder).status, 'ready');
  await restarted.disconnect(folder); assert.equal(restarted.context(folder).binding, undefined); restarted.dispose();
});
