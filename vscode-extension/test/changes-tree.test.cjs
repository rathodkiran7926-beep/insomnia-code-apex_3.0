const test = require('node:test');
const assert = require('node:assert/strict');
const { ChangesTree, ChangesItem, editor } = require('../.test-output/activation.cjs');
const ref = id => ({ id, snapshotId: 'snapshot', file: 'src/a.ts', startLine: 2, endLine: 5, url: 'https://github.com/a/b/blob/sha/src/a.ts' });
const component = (id, referenceId) => ({ id, name: id, role: 'function', reference: ref(referenceId) });
const selected = { number: 7, title: 'Remote change', url: 'https://github.com/a/b/pull/7', state: 'open', draft: true, merged: false, base: 'main', head: 'feature' };
const comparison = () => ({
  id: 'cmp', pr: { ...selected, baseBranch: 'main', headBranch: 'feature', baseCommit: 'a'.repeat(40), targetCommit: 'b'.repeat(40), headCommit: 'c'.repeat(40), files: [{ path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1, hidden: true, patchLimited: true }], changedFiles: 1, limited: true },
  components: [{ status: 'modified', before: component('old', 'decl-before'), after: component('new', 'decl-after'), ambiguous: true }],
  edges: { added: [{ id: 'edge', source: 'new', target: 'other', type: 'imports', reference: ref('edge-after') }], removed: [] },
  impact: { before: [], after: [{ ...component('impacted', 'impact-after'), depth: 2, via: 'imports' }] },
  setup: { dependencies: [{ name: 'lib', section: 'dependencies', path: 'package.json', before: null, after: 'present' }], scripts: [{ name: 'empty', path: 'package.json', before: 'present', after: null }], environment: [{ name: 'TOKEN', change: 'added', path: '.env.example' }], migrations: [{ path: 'migrations/one.sql', status: 'added' }], guides: { before: [], after: [{ path: 'package.json', packageManager: true, engines: false, scripts: true }] } }, warnings: []
});
function fixture(extra = {}, connected = true) {
  const pr = { state: { status: 'ready', message: 'Stored comparison', viewId: 'view-7', selected, comparison: comparison(), ...extra } };
  const tree = new ChangesTree(pr, () => connected);
  return { tree, pr };
}
const group = (tree, rows, label) => tree.getChildren(rows.find(row => row.label.startsWith(label)));
const walk = (tree, rows = tree.getChildren()) => rows.flatMap(row => [row, ...walk(tree, tree.getChildren(row))]);

test('manual PR header uses authoritative comparison metadata after analysis completes', () => {
  const result = comparison(); result.pr.title = 'Actual backend PR title'; result.pr.number = 23;
  const { tree } = fixture({ manual: true, selected: { ...selected, title: 'PR #7 · metadata loads during analysis' }, comparison: result });
  const labels = tree.getChildren().map(row => row.label);
  assert(labels.includes('#23 Actual backend PR title'));
  assert(!labels.some(label => label.includes('metadata loads during analysis')));
  tree.dispose();
});

test('Changes returns native rows and keeps declaration, relationship and side action identities separate', () => {
  const { tree } = fixture(); const roots = tree.getChildren();
  assert(roots.some(row => row.command?.command === 'codebaseMentor.reanalyzePr'));
  assert(roots.every(row => row instanceof ChangesItem && row instanceof editor.TreeItem));
  const components = group(tree, roots, 'Architecture Components'); const sides = tree.getChildren(components[0]);
  assert.deepEqual(sides.map(row => row.action), [
    { viewId: 'view-7', side: 'before', componentId: 'old', referenceId: 'decl-before' },
    { viewId: 'view-7', side: 'after', componentId: 'new', referenceId: 'decl-after' }
  ]);
  assert(sides.every(row => row.contextValue === 'prComponent' && row.command.command === 'codebaseMentor.openPrSource'));
  assert.match(components[0].label, /ambiguous/i);
  const edge = walk(tree, group(tree, roots, 'Relationship Changes')).find(row => row.action?.referenceId === 'edge-after');
  assert.equal(edge.action.componentId, undefined); assert.equal(edge.action.side, 'after'); assert.match(edge.label, /imports/); assert.doesNotMatch(edge.label, /calls/);
  const file = group(tree, roots, 'Changed Files')[0];
  assert.deepEqual(file.action, { viewId: 'view-7', fileIndex: 0 }); assert.equal(file.command.command, 'codebaseMentor.openPrDiff');
  assert.match(file.description, /content withheld/); assert.match(file.description, /patch limited/);
  assert(roots.some(row => row.label === 'Potential Impact — Static Analysis'));
  assert.match(walk(tree, group(tree, roots, 'Potential Impact')).find(row => row.action?.componentId === 'impacted').description, /depth 2.*via imports/);
  const text = walk(tree).map(row => `${row.label} ${row.description ?? ''}`).join('\n');
  assert.match(text, /Merge base.*aaaa/); assert.match(text, /Target.*bbbb/); assert.match(text, /Head.*cccc/);
  tree.dispose();
});

test('setup shows only presence and unknown environment requiredness, with static execution notice', () => {
  const result = comparison(); result.setup.scripts.push({ name: 'blank', path: 'package.json', before: '', after: 'DO_NOT_RENDER_COMMAND' });
  const { tree } = fixture({ comparison: result }); const text = walk(tree).map(row => `${row.label} ${row.description ?? ''}`).join('\n');
  assert.match(text, /lib.*dependencies.*package.json/); assert.match(text, /absent → present/);
  assert.match(text, /TOKEN.*added.*.env.example/); assert.match(text, /requiredness unknown/i);
  assert.match(text, /Setup has not been executed/); assert.match(text, /package manager present.*engines absent.*scripts present/i);
  assert.doesNotMatch(text, /DO_NOT_RENDER_COMMAND/); assert.match(text, /present → present/);
  tree.dispose();
});

test('all result lists are bounded and keep warning omission notice visible', () => {
  const result = comparison(); result.components = Array.from({ length: 103 }, () => result.components[0]);
  result.warnings = [...Array.from({ length: 200 }, (_, i) => `Warning ${i}`), '700 additional comparison warnings omitted from this bounded view.'];
  const { tree } = fixture({ comparison: result }); const roots = tree.getChildren();
  const components = group(tree, roots, 'Architecture Components'); assert.equal(components.length, 101); assert.match(components.at(-1).label, /3.*omitted/);
  const warnings = group(tree, roots, 'Warnings'); assert.equal(warnings.length, 201); assert.match(warnings.at(-1).label, /700 additional comparison warnings omitted/);
  tree.dispose();
});

test('discovery, manual selection, progress, cancellation and empty sections have explicit actions', () => {
  const { tree, pr } = fixture({ comparison: undefined, selected: undefined, status: 'idle', page: { pullRequests: [selected], page: 2, hasMore: true, state: 'all' } });
  let roots = tree.getChildren(); const listed = group(tree, roots, 'Pull Requests');
  assert.equal(listed[0].command.command, 'codebaseMentor.selectPr'); assert.equal(listed[0].action.url, selected.url);
  for (const name of ['refreshPrList', 'prNextPage', 'prPreviousPage', 'prFilterList', 'prEnterUrl']) assert(walk(tree).some(row => row.command?.command === `codebaseMentor.${name}`));
  pr.state = { ...pr.state, selected, manual: true, status: 'selected' }; roots = tree.getChildren();
  assert(roots.some(row => row.command?.command === 'codebaseMentor.startPrAnalysis'));
  assert.doesNotMatch(walk(tree).map(row => row.label).join('\n'), /draft/i);
  pr.state = { ...pr.state, status: 'running', job: { id: 'job', progress: 42, status: 'running', message: 'Parsing' } };
  assert(walk(tree).some(row => /42%/.test(row.label)));
  for (const name of ['resumePrJob', 'cancelPrWaiting', 'refreshPrComparison']) assert(walk(tree).some(row => row.command?.command === `codebaseMentor.${name}`));
  let refreshed = 0; tree.onDidChangeTreeData(() => refreshed++); tree.refresh(); assert.equal(refreshed, 1);
  tree.dispose(); tree.refresh(); assert.equal(refreshed, 1);
  const disconnected = fixture({ comparison: undefined }, false); assert(disconnected.tree.getChildren().some(row => row.command?.command === 'codebaseMentor.connectRepository')); disconnected.tree.dispose();
  const empty = comparison(); empty.components = []; empty.edges.added = []; empty.impact.after = []; empty.pr.files = [];
  const blank = fixture({ comparison: empty }); assert(walk(blank.tree).some(row => /No architecture component changes/.test(row.label))); blank.tree.dispose();
});
