const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEvidence, validateResolution, validateMentorAnswer, validateSource, safeSourcePath } = require('../.test-output/library.cjs');
const sha = 'a'.repeat(40);
const reference = { id: 'ref0', snapshotId: 'snap', file: 'src/a.ts', startLine: 2, endLine: 4, url: `https://github.com/a/b/blob/${sha}/src/a.ts#L2-L4`, excerpt: 'not retained' };
const snapshot = { snapshotId: 'snap', repository: 'https://github.com/a/b', commit: sha, components: [{ id: 'c0', name: 'first', role: 'function', referenceId: 'ref0' }], references: [reference], relationships: [], report: { limitations: [] }, documentation: { snapshotId: 'snap' } };
const answer = { snapshotId: 'snap', componentId: 'c0', mode: 'facts', notice: 'Source facts only', answer: 'Checks the input.', referenceIds: ['ref0'], citations: [reference] };
test('validated snapshot evidence contains authoritative IDs and no source excerpts', () => {
  const evidence = validateEvidence(snapshot, 'snap');
  assert.equal(evidence.references[0].id, 'ref0'); assert.equal(evidence.references[0].excerpt, undefined);
  assert.equal(evidence.components[0].name, 'first');
  assert.throws(() => validateEvidence({ ...snapshot, references: [{ ...reference, snapshotId: 'other' }] }, 'snap'));
});
test('resolver candidates must match stored component and source identities', () => {
  const evidence = validateEvidence(snapshot, 'snap');
  const result = { snapshotId: 'snap', candidates: [{ componentId: 'c0', name: 'first', role: 'function', referenceId: 'ref0' }], scope: 'declaration', notice: 'Indexed component' };
  assert.equal(validateResolution(result, evidence).candidates.length, 1);
  for (const bad of [{ ...result, snapshotId: 'other' }, { ...result, candidates: [{ ...result.candidates[0], componentId: 'invented' }] }, { ...result, candidates: [{ ...result.candidates[0], referenceId: 'made-up' }] }]) assert.throws(() => validateResolution(bad, evidence));
  assert.equal(validateResolution({ ...result, candidates: [], scope: 'none' }, evidence).candidates.length, 0);
});
test('facts, fallback and AI responses preserve provenance but malformed citations fail closed', () => {
  const evidence = validateEvidence(snapshot, 'snap');
  for (const mode of ['facts', 'ai']) assert.equal(validateMentorAnswer({ ...answer, mode }, evidence, 'c0').mode, mode);
  for (const bad of [{ ...answer, answer: '' }, { ...answer, mode: 'chat' }, { ...answer, componentId: 'c1' }, { ...answer, snapshotId: 'other' }, { ...answer, referenceIds: ['invented'] }, { ...answer, citations: [{ ...reference, startLine: 1 }] }, { ...answer, citations: [{ ...reference, file: '../secret' }] }, { ...answer, citations: [{ ...reference, url: 'https://evil.com' }] }]) assert.throws(() => validateMentorAnswer(bad, evidence, 'c0'));
});
test('safe paths and pinned source reject traversal, hostile URLs and incorrect coordinates', () => {
  const evidence = validateEvidence(snapshot, 'snap');
  const source = { snapshotId: 'snap', file: 'src/a.ts', startLine: 1, endLine: 5, complete: true, excerpt: 'one\ntwo\nthree\nfour\n', url: `https://github.com/a/b/blob/${sha}/src/a.ts#L1` };
  assert.equal(validateSource(source, evidence, reference).excerpt, source.excerpt);
  for (const path of ['../secret', '/root', 'C:/file', 'a\\b', 'a//b', 'a/%2e%2e/b', '.git/config']) assert.equal(safeSourcePath(path), false);
  for (const bad of [{ ...source, complete: false }, { ...source, snapshotId: 'other' }, { ...source, file: 'other.ts' }, { ...source, endLine: 1 }, { ...source, url: `https://github.com/a/b/blob/main/src/a.ts#L1` }]) assert.throws(() => validateSource(bad, evidence, reference));
  assert.throws(() => validateSource({ ...source, url: 'https://github.com/a/b/blob/main/src/a.ts#L1' }, { ...evidence, indexedCommit: 'main' }, reference));
});
module.exports = { snapshot, reference, answer };
