const test = require('node:test'); const assert = require('node:assert/strict');
const { PrController, ApiError } = require('../.test-output/library.cjs');
const binding = { version: 1, workspaceUri: 'file:///repo', snapshotId: 'snap', backendUrl: 'http://127.0.0.1:3001/', repositoryIdentity: 'https://github.com/a/b', indexedCommit: 'a'.repeat(40), connectedAt: 'now' };
const pull = { number: 12, title: 'Actual remote selection', url: 'https://github.com/a/b/pull/12', state: 'open', draft: false, merged: false, head: 'fork-feature', base: 'main', updatedAt: '' };
const comparison = { id: 'comparison-1', pr: { ...pull, baseRepository: binding.repositoryIdentity }, beforeSnapshotId: 'before', afterSnapshotId: 'after' };
function setup() {
  let current = binding, fail; const calls = []; let status = 'complete';
  const api = { backendIdentity: binding.backendUrl,
    listPullRequests: async (b, state, page) => { calls.push(['list', b.snapshotId, state, page]); if (fail) throw fail; return { repository: b.repositoryIdentity, state, page, hasMore: page === 1, pullRequests: [pull] }; },
    startPrAnalysis: async url => { calls.push(['start', url]); if (fail) throw fail; return { id: 'job-1' }; },
    prJob: async id => { calls.push(['job', id]); if (fail) throw fail; return { id, status, progress: status === 'running' ? 45 : 100, message: 'Actual backend message', comparison_id: status === 'complete' ? 'comparison-1' : null, url: pull.url }; },
    prComparison: async id => { calls.push(['comparison', id]); if (fail) throw fail; return comparison; },
  };
  const env = { binding: () => current, trusted: () => true, wait: async () => { status = 'complete'; } };
  const controller = new PrController(api, env);
  return { controller, api, env, calls, setBinding: b => current = b, setFailure: e => fail = e, setStatus: s => status = s };
}
test('PR listing is user driven, snapshot scoped, paginated and deduplicated on reopening', async () => {
  const s = setup(); assert.equal(s.calls.length, 0); await s.controller.open(); await s.controller.open();
  assert.equal(s.calls.length, 1); await s.controller.nextPage(); assert.equal(s.controller.state.page.page, 2);
  s.setBinding(undefined); s.controller.contextChanged(); assert.equal(s.controller.state.page, undefined);
});
test('manual PR identity rejects unrelated bases but accepts a fork branch without local association', async () => {
  const s = setup(); assert.throws(() => s.controller.select('https://github.com/other/repo/pull/1'));
  s.controller.select(pull); assert.equal(s.controller.state.selected.url, pull.url); assert.equal(s.calls.length, 0);
});
test('explicit start polls actual progress, snake_case comparison_id and loads result without repeating POST', async () => {
  const s = setup(); const updates = []; s.controller.onChange(() => updates.push(s.controller.state)); s.controller.select(pull); s.setStatus('running');
  await Promise.all([s.controller.start(), s.controller.start()]);
  assert.equal(s.calls.filter(c => c[0] === 'start').length, 1); assert(updates.some(v => v.job?.progress === 45));
  assert.equal(s.controller.state.comparison.id, 'comparison-1'); await s.controller.start(); await s.controller.refreshComparison();
  assert.equal(s.calls.filter(c => c[0] === 'start').length, 1);
});
test('cancel stops local waiting, retains job ID and resumes without creating another worker', async () => {
  const s = setup(); s.controller.select(pull); s.setStatus('running');
  let entered; const waiting = new Promise(r => entered = r); s.env.wait = async (_ms, signal) => { entered(); await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new ApiError('cancelled', 'cancelled')), { once: true })); };
  const run = s.controller.start(); await waiting; s.controller.cancel(); await run;
  assert.equal(s.controller.state.job.id, 'job-1'); assert.match(s.controller.state.message, /backend.*continue/i);
  s.setStatus('complete'); await s.controller.resume(); assert.equal(s.controller.state.status, 'ready'); assert.equal(s.calls.filter(c => c[0] === 'start').length, 1);
});
test('failed/missing/rate-limited jobs stay recoverable and do not automatically repeat mutation', async () => {
  const s = setup(); s.controller.select(pull); s.setStatus('failed'); await s.controller.start(); assert.equal(s.controller.state.status, 'error');
  s.setFailure(new ApiError('http', 'busy', 429)); await s.controller.refreshList(); assert.match(s.controller.state.message, /429|busy/);
  assert.equal(s.calls.filter(c => c[0] === 'start').length, 1);
});
test('repository/backend changes clear result and late job responses cannot leak', async () => {
  for (const change of [s => s.setBinding({ ...binding, snapshotId: 'new' }), s => s.api.backendIdentity = 'https://other.example/', s => s.setBinding(undefined)]) {
    const s = setup(); s.controller.select(pull); let finish; s.api.prJob = () => new Promise(r => finish = r);
    const run = s.controller.start(); await new Promise(r => setImmediate(r)); change(s); s.controller.contextChanged();
    finish({ id: 'job-1', status: 'complete', progress: 100, message: '', comparison_id: 'comparison-1', url: pull.url }); await run;
    assert.equal(s.controller.state.selected, undefined); assert.equal(s.controller.state.comparison, undefined);
  }
});
test('hidden view and disposal stop polling while local branch changes preserve manual PR selection', async () => {
  const s = setup(); s.controller.select(pull); s.controller.contextChanged(); assert.equal(s.controller.state.selected.url, pull.url);
  s.controller.setVisible(false); assert.match(s.controller.state.message, /backend|waiting|selected/i); s.controller.dispose();
  await s.controller.open(); assert.equal(s.calls.length, 0);
});
test('polling deadline counts time spent waiting for backend responses', async () => {
  const s = setup(); let clock = 0; s.env.now = () => clock; s.controller.select(pull);
  s.api.prJob = async id => { clock += 360001; return { id, status: 'running', progress: 10, message: 'Slow', comparison_id: null, url: pull.url }; };
  await s.controller.start(); assert.equal(s.controller.state.status, 'error'); assert.match(s.controller.state.message, /six minutes/);
  assert.equal(s.calls.filter(c => c[0] === 'comparison').length, 0); s.controller.dispose();
});
test('missing jobs and backend restart failures retain the job ID and recover only through explicit Resume', async () => {
  for (const error of [new ApiError('http', 'PR analysis job not found', 404), new ApiError('network', 'Backend restarted')]) {
    const s = setup(); s.controller.select(pull); s.api.prJob = async () => { throw error; };
    await s.controller.start(); assert.equal(s.controller.state.status, 'error'); assert.equal(s.controller.state.job.id, 'job-1');
    assert.equal(s.calls.filter(c => c[0] === 'start').length, 1);
    s.api.prJob = async id => ({ id, status: 'complete', progress: 100, message: 'Done', comparison_id: 'comparison-1', url: pull.url });
    await s.controller.resume(); assert.equal(s.controller.state.status, 'ready'); assert.equal(s.calls.filter(c => c[0] === 'start').length, 1);
  }
});
test('hidden or disposed views ignore an in-flight job response and never load its comparison', async () => {
  for (const dispose of [false, true]) {
    const s = setup(); s.controller.select(pull); let finish; s.api.prJob = () => new Promise(r => finish = r);
    const run = s.controller.start(); await new Promise(r => setImmediate(r));
    if (dispose) s.controller.dispose(); else s.controller.setVisible(false);
    finish({ id: 'job-1', status: 'complete', progress: 100, message: 'Done', comparison_id: 'comparison-1', url: pull.url }); await run;
    assert.equal(s.controller.state.comparison, undefined); assert.equal(s.calls.filter(c => c[0] === 'comparison').length, 0);
  }
});
test('no binding prevents discovery requests and empty PR lists retain useful recovery state', async () => {
  const s = setup(); s.setBinding(undefined); await s.controller.open(); assert.equal(s.calls.length, 0); assert.equal(s.controller.state.status, 'error');
  s.setBinding(binding); s.api.listPullRequests = async () => ({ repository: binding.repositoryIdentity, state: 'open', page: 1, hasMore: false, pullRequests: [] });
  await s.controller.refreshList('open'); assert.equal(s.controller.state.page.pullRequests.length, 0); assert.match(s.controller.state.message, /No pull requests/);
});
test('selection in a newly active repository discards the previous repository page even before an editor event', async () => {
  const s = setup(); await s.controller.open();
  s.setBinding({ ...binding, workspaceUri: 'file:///other', snapshotId: 'other', repositoryIdentity: 'https://github.com/other/repo' });
  s.controller.select('https://github.com/other/repo/pull/9');
  assert.equal(s.controller.state.page, undefined); assert.equal(s.controller.state.binding.snapshotId, 'other');
});
test('explicit saved-checkpoint comparison replaces local waiting without creating a new backend job', async () => {
  const s = setup(); s.controller.select(pull); let finish; s.api.prJob = () => new Promise(r => finish = r);
  const run = s.controller.start(); await new Promise(r => setImmediate(r));
  await s.controller.reviewStored({ id: comparison.id, prUrl: pull.url, beforeSnapshotId: 'before', afterSnapshotId: 'after' });
  assert.equal(s.controller.state.comparison?.id, comparison.id);
  finish({ id: 'job-1', status: 'failed', progress: 0, message: 'Old request', comparison_id: null, url: pull.url }); await run;
  assert.equal(s.controller.state.comparison.id, comparison.id); assert.equal(s.calls.filter(c => c[0] === 'start').length, 1);
});
