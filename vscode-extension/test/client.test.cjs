const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { MentorApi, ApiError } = require('../.test-output/library.cjs');

async function server(t, handler) {
  const instance = createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => { instance.closeAllConnections(); instance.close(); });
  return `http://127.0.0.1:${instance.address().port}`;
}
const hasKind = kind => error => error instanceof ApiError && error.kind === kind;

test('rejects unsafe backend configuration before making a request', async () => {
  for (const base of ['oops', 'http://example.com', 'file:///tmp', 'https://user:pass@example.com', 'http://localhost.evil.com', 'https://example.com?q=x', 'https://example.com#x']) {
    await assert.rejects(new MentorApi(() => base).health(), hasKind('configuration'));
  }
});
test('GET health uses the configured server, real JSON and no workspace payload', async t => {
  const base = await server(t, (req, res) => {
    assert.equal(req.url, '/api/health'); assert.equal(req.method, 'GET');
    assert.equal(req.headers.origin, undefined); assert.equal(req.headers.authorization, undefined);
    res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
  });
  assert.deepEqual(await new MentorApi(() => base).health(), { ok: true });
});
test('POST serializes JSON and supports a future header provider without automatic retries', async t => {
  let calls = 0;
  const base = await server(t, async (req, res) => {
    calls++; assert.equal(req.url, '/api/example'); assert.equal(req.method, 'POST');
    assert.equal(req.headers['content-type'], 'application/json');
    assert.equal(req.headers['x-test'], 'transport-seam');
    let body = ''; for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { question: 'hello' });
    res.setHeader('content-type', 'application/json'); res.end('{"id":"result"}');
  });
  const api = new MentorApi(() => base, { headers: () => ({ 'X-Test': 'transport-seam' }) });
  assert.deepEqual(await api.post('/api/example', { question: 'hello' }), { id: 'result' });
  assert.equal(calls, 1);
});
test('reports HTTP status and backend JSON errors, including non-JSON server errors', async t => {
  let status = 400;
  const base = await server(t, (_req, res) => {
    res.writeHead(status, { 'content-type': status === 500 ? 'text/html' : 'application/json' });
    res.end(status === 500 ? '<html>failed</html>' : '{"error":"Rejected"}');
  });
  const api = new MentorApi(() => base);
  for (status of [400, 401, 403, 404, 429, 500]) {
    await assert.rejects(api.health(), error => error.kind === 'http' && error.status === status);
  }
});
test('never declares malformed or false health responses connected', async t => {
  let body = '{"ok":false}'; let type = 'application/json';
  const base = await server(t, (_req, res) => { res.setHeader('content-type', type); res.end(body); });
  const api = new MentorApi(() => base);
  for (const value of ['{"ok":false}', '{}', 'null', 'not json']) {
    body = value; await assert.rejects(api.health(), hasKind('response'));
  }
  body = '{"ok":true}'; type = 'text/html';
  await assert.rejects(api.health(), hasKind('response'));
});
test('rejects cross-origin paths and redirects rather than leaking headers', async t => {
  const base = await server(t, (_req, res) => { res.writeHead(302, { location: 'http://example.com' }); res.end(); });
  const api = new MentorApi(() => base);
  for (const path of ['https://example.com/api/health', '//example.com/api/health', '/api/../secret', '/api/%2e%2e/secret', '/api/health#fragment']) {
    await assert.rejects(api.get(path), hasKind('configuration'));
  }
  await assert.rejects(api.health(), hasKind('http'));
});
test('timeout includes the response body and caller cancellation is distinct', async t => {
  const base = await server(t, (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); });
  const api = new MentorApi(() => base, { timeoutMs: 40 });
  await assert.rejects(api.health(), hasKind('timeout'));
  const controller = new AbortController();
  const pending = api.health(controller.signal); controller.abort();
  await assert.rejects(pending, hasKind('cancelled'));
});
test('subsequent requests read updated configuration and unreachable servers fail quietly', async t => {
  let base = await server(t, (_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); });
  const api = new MentorApi(() => base);
  await api.health(); base = 'invalid';
  await assert.rejects(api.health(), hasKind('configuration'));
  const closed = createServer(); await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${closed.address().port}`;
  await new Promise(resolve => closed.close(resolve));
  await assert.rejects(api.health(), hasKind('network'));
});

test('repository connection accepts snapshot IDs and completed analysis job IDs, pinning the actual snapshot', async t => {
  const snapshotId = '0123456789abcdef01234567';
  const jobId = '6e2c648d-2c2d-414e-b2b6-86edec13be85';
  const calls = [];
  const snapshot = { snapshotId, repository: 'https://github.com/owner/repo', commit: 'a'.repeat(40),
    components: [], references: [], relationships: [], report: { limitations: [] }, documentation: { snapshotId } };
  const base = await server(t, (req, res) => {
    calls.push(req.url);
    res.setHeader('content-type', 'application/json');
    if (req.url === `/api/snapshots/${snapshotId}`) return res.end(JSON.stringify(snapshot));
    if (req.url === `/api/analyses/${jobId}`) return res.end(JSON.stringify({ id: jobId, status: 'complete', snapshot_id: snapshotId }));
    res.statusCode = 404; res.end('{"error":"Snapshot not found"}');
  });
  const api = new MentorApi(() => base);
  assert.equal((await api.snapshotForConnection(snapshotId)).snapshotId, snapshotId);
  assert.equal((await api.snapshotForConnection(jobId)).snapshotId, snapshotId);
  assert.deepEqual(calls, [ `/api/snapshots/${snapshotId}`, `/api/snapshots/${jobId}`, `/api/analyses/${jobId}`, `/api/snapshots/${snapshotId}` ]);
});

test('snapshot connection reports pending, failed, missing, and inconsistent jobs with actionable errors', async t => {
  let status = 'running';
  let snapshotId;
  const jobId = 'e14fc7d5-33fb-42d2-aefc-9379ab634710';
  const base = await server(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === `/api/analyses/${jobId}` && status !== 'missing')
      return res.end(JSON.stringify({ id: jobId, status, snapshot_id: snapshotId }));
    res.statusCode = 404; res.end('{"error":"Snapshot not found"}');
  });
  const api = new MentorApi(() => base);
  await assert.rejects(api.snapshotForConnection(jobId), /still running/);
  status = 'failed'; await assert.rejects(api.snapshotForConnection(jobId), /analysis failed/i);
  status = 'complete'; await assert.rejects(api.snapshotForConnection(jobId), /no completed snapshot/i);
  snapshotId = '0123456789abcdef01234567';
  await assert.rejects(api.snapshotForConnection(jobId), /snapshot is missing/i);
  status = 'missing';
  await assert.rejects(api.snapshotForConnection(jobId), /same backend and database/i);
});
