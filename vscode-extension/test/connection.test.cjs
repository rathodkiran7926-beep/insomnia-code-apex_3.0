const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Connection, ApiError } = require('../.test-output/library.cjs');

test('connecting transitions to connected only after health success', async () => {
  let finish;
  const connection = new Connection({ health: () => new Promise(resolve => { finish = resolve; }) });
  const states = []; connection.onChange(state => states.push(state.status));
  const pending = connection.check();
  assert.equal(connection.state.status, 'connecting');
  finish({ ok: true }); await pending;
  assert.deepEqual(states, ['connecting', 'connected']); connection.dispose();
});
test('failure categories remain distinguishable and manual retry can recover', async () => {
  let error;
  const connection = new Connection({ health: async () => { if (error) throw error; return { ok: true }; } });
  for (const [kind, expected] of [['network', 'disconnected'], ['timeout', 'disconnected'], ['http', 'server-error'], ['response', 'server-error'], ['configuration', 'invalid-configuration']]) {
    error = new ApiError(kind, 'Failure'); await connection.check();
    assert.equal(connection.state.status, expected);
  }
  error = undefined; await connection.check(); assert.equal(connection.state.status, 'connected');
  connection.dispose();
});
test('a new check cancels the old request and ignores its stale response', async () => {
  const requests = [];
  const connection = new Connection({ health: signal => new Promise(resolve => requests.push({ signal, resolve })) });
  const first = connection.check(); const second = connection.check();
  assert.equal(requests[0].signal.aborted, true);
  requests[1].resolve({ ok: true }); await second;
  requests[0].resolve({ ok: true }); await first;
  assert.equal(connection.state.status, 'connected'); connection.dispose();
});
test('disposal aborts in-flight requests, prevents future work and emits no late changes', async () => {
  let signal; let finish; let changes = 0;
  const connection = new Connection({ health: value => { signal = value; return new Promise(resolve => { finish = resolve; }); } });
  connection.onChange(() => changes++);
  const pending = connection.check(); connection.dispose();
  assert.equal(signal.aborted, true);
  finish({ ok: true }); await pending; await connection.check();
  assert.equal(changes, 1);
});
