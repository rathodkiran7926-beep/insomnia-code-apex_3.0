const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePrUrl, validatePullRequestPage, validatePrJob, validatePrComparison } = require('../.test-output/library.cjs');
const repo = 'https://github.com/a/b', fork = 'https://github.com/fork/b', url = `${repo}/pull/7`;
const sha = 'a'.repeat(40), head = 'b'.repeat(40);
const component = (side) => ({ id: `c-${side}`, name: 'entry', role: 'function', reference: { id: `r-${side}`, snapshotId: side, file: 'src/app.ts', startLine: 1, endLine: 2, url: `${side === 'before' ? repo : fork}/blob/${side === 'before' ? sha : head}/src/app.ts#L1-L2` } });
const comparison = () => ({ id: 'comparison', createdAt: '2026-10-24T00:00:00Z', beforeSnapshotId: 'before', afterSnapshotId: 'after', pr: { url, number: 7, title: 'Change app', state: 'open', baseRepository: repo, headRepository: fork, baseCommit: sha, headCommit: head, targetCommit: 'c'.repeat(40), baseBranch: 'main', headBranch: 'feature', changedFiles: 1, limited: false, files: [{ path: 'src/app.ts', previousPath: null, status: 'modified', additions: 2, deletions: 1, patch: 'SECRET_PATCH', hidden: false, patchLimited: false }] }, components: [{ status: 'modified', before: component('before'), after: component('after'), ambiguous: false }], edges: { added: [{ id: 'edge', source: 'c-after', target: 'other', type: 'calls', certainty: 'possible', reference: component('after').reference }], removed: [] }, impact: { before: [], after: [{ ...component('after'), depth: 1, via: 'imports' }] }, setup: { environment: [{ name: 'TOKEN', change: 'added', path: '.env.example' }], dependencies: [{ path: 'package.json', section: 'dependencies', name: 'lib', before: 'SECRET_OLD', after: 'SECRET_NEW' }], scripts: [{ path: 'package.json', section: 'scripts', name: 'start', before: null, after: 'SECRET_COMMAND' }], migrations: [{ path: 'migrations/1.sql', status: 'added' }], guides: { before: [], after: [{ path: 'package.json', packageManager: 'SECRET_MANAGER', engines: { node: 'SECRET_ENGINE' }, scripts: { start: 'SECRET_COMMAND' } }] } }, warnings: ['Static evidence only'] });
const page = () => ({ repository: repo, state: 'all', page: 1, hasMore: false, pullRequests: [{ number: 7, title: 'Change app', url, state: 'open', draft: false, merged: false, head: 'feature', base: 'main', updatedAt: '2026-10-24T00:00:00Z', author: 'dev' }] });

test('PR URL parsing accepts a canonical matching public GitHub pull URL only', () => {
  assert.equal(typeof parsePrUrl, 'function');
  assert.deepEqual(parsePrUrl('https://github.com/A/B/pull/7/', repo), { url, repositoryIdentity: repo, number: 7 });
  for (const bad of [`${repo}/pull/0`, `${repo}/pull/9007199254740992`, `${url}?x=1`, `${url}#x`, `${url}/files`, 'https://user@github.com/a/b/pull/7', 'https://github.com/a/%62/pull/7', `${fork}/pull/7`, 'https://github.com/./b/pull/7']) assert.throws(() => parsePrUrl(bad, repo));
});
test('PR page validates identity, filters, pagination, duplicate numbers and bounded rows', () => {
  assert.equal(typeof validatePullRequestPage, 'function');
  assert.equal(validatePullRequestPage(page(), repo, 'all', 1).pullRequests[0].number, 7);
  for (const mutate of [b => b.repository = fork, b => b.state = 'open', b => b.page = 2, b => b.pullRequests[0].url = `${fork}/pull/7`, b => b.pullRequests[0].number = 8, b => b.pullRequests[0].draft = 'false', b => b.pullRequests[0].updatedAt = 'bad', b => b.pullRequests.push(b.pullRequests[0]), b => b.pullRequests = Array(31).fill(b.pullRequests[0])]) { const b = page(); mutate(b); assert.throws(() => validatePullRequestPage(b, repo, 'all', 1)); }
});
test('PR jobs validate requested identity and coherent terminal status', () => {
  assert.equal(typeof validatePrJob, 'function');
  const body = { id: 'job', status: 'complete', progress: 100, message: 'Done', comparison_id: 'comparison', url };
  assert.equal(validatePrJob(body, 'job').comparison_id, 'comparison');
  for (const patch of [{ id: 'other' }, { status: 'unknown' }, { progress: 101 }, { comparison_id: '../bad' }, { comparison_id: null }, { status: 'running' }, { url: 'https://evil.test/pull/7' }]) assert.throws(() => validatePrJob({ ...body, ...patch }, 'job'));
});
test('PR comparison validates fork side citations and preserves edge meaning while discarding executable values', () => {
  assert.equal(typeof validatePrComparison, 'function');
  const result = validatePrComparison(comparison(), 'comparison', repo, url);
  assert.equal(result.components[0].after.reference.url, component('after').reference.url);
  assert.equal(result.edges.added[0].type, 'calls'); assert.equal(result.edges.added[0].certainty, 'possible');
  assert.equal(result.impact.after[0].depth, 1); assert.equal(result.impact.after[0].via, 'imports');
  assert.deepEqual(result.setup.dependencies[0], { path: 'package.json', section: 'dependencies', name: 'lib', before: 'present', after: 'present' });
  assert.deepEqual(result.setup.guides.after[0], { path: 'package.json', packageManager: true, engines: true, scripts: true });
  assert.equal(JSON.stringify(result).includes('SECRET'), false); assert.equal('patch' in result.pr.files[0], false);
});
test('PR comparison rejects identity/side/path/commit mismatches and malformed bounded metadata', () => {
  for (const mutate of [b => b.id = 'other', b => b.pr.url = `${repo}/pull/8`, b => b.pr.number = 8, b => b.pr.baseRepository = fork, b => b.pr.headCommit = 'main', b => b.components[0].after.reference.snapshotId = 'before', b => b.components[0].after.reference.url = component('before').reference.url, b => b.edges.added[0].reference = component('before').reference, b => b.components[0].before.reference.file = '../secret', b => b.pr.files[0].path = '../secret', b => b.impact.after[0].depth = 4, b => b.setup.environment[0].name = 'TOKEN=secret', b => b.setup.scripts[0].after = {}, b => b.components[0].status = 'added', b => b.warnings = Array(20001).fill('bad')]) { const b = comparison(); mutate(b); assert.throws(() => validatePrComparison(b, 'comparison', repo, url)); }
});
test('backend GitHub repository casing is normalized while repository URLs with credentials are rejected', () => {
  const listing = page(); listing.repository = 'https://github.com/A/B';
  assert.equal(validatePullRequestPage(listing, repo, 'all', 1).repository, repo);
  const body = comparison(); body.pr.baseRepository = 'https://github.com/A/B'; body.pr.headRepository = 'https://github.com/Fork/B';
  assert.equal(validatePrComparison(body, 'comparison', repo, url).pr.headRepository, fork);
  body.pr.headRepository = 'https://user@github.com/fork/b'; assert.throws(() => validatePrComparison(body, 'comparison', repo, url));
});
test('shared snapshot IDs are valid only when both sides identify the same repository and commit', () => {
  const body = comparison();
  body.afterSnapshotId = body.beforeSnapshotId;
  body.pr.headRepository = body.pr.baseRepository;
  body.pr.headCommit = body.pr.baseCommit;
  body.components = []; body.edges = { added: [], removed: [] }; body.impact = { before: [], after: [] };
  const result = validatePrComparison(body, 'comparison', repo, url);
  assert.equal(result.beforeSnapshotId, result.afterSnapshotId);
  body.pr.headCommit = head; assert.throws(() => validatePrComparison(body, 'comparison', repo, url));
  body.pr.headCommit = sha; body.pr.headRepository = fork; assert.throws(() => validatePrComparison(body, 'comparison', repo, url));
});
test('large exclusion warning lists retain the first 200 messages and explicitly count omitted warnings', () => {
  const body = comparison(); body.warnings = Array.from({ length: 250 }, (_, i) => `Before: excluded/file-${i}.js: excluded by analyzer`);
  const result = validatePrComparison(body, 'comparison', repo, url);
  assert.deepEqual(result.warnings.slice(0, 200), body.warnings.slice(0, 200));
  assert.equal(result.warnings.length, 201);
  assert.match(result.warnings[200], /50 .*warnings omitted/i);
  body.warnings = ['bad\0warning']; assert.throws(() => validatePrComparison(body, 'comparison', repo, url));
});
module.exports = { comparison, page, repo, url };
