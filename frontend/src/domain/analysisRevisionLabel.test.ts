import { expect, it } from 'vitest';
import { displayedSnapshotRevision, labelForActiveJob, revisionLabelForRequest } from './analysisRevisionLabel';

it('labels a successfully submitted revision without altering the snapshot graph', () => {
  const graph = { branch: 'main', revision: 'main' };
  const first = labelForActiveJob('job-a', JSON.stringify({ jobId: 'job-a', label: revisionLabelForRequest('release') }));
  expect(displayedSnapshotRevision(graph, first)).toBe('release');
  expect(graph.branch).toBe('main');
  expect(revisionLabelForRequest('  feature/a  ')).toBe('feature/a');
  expect(revisionLabelForRequest(' ')).toBe('Default branch');
});

it('does not reuse a previous job label or trust invalid local storage', () => {
  const old = JSON.stringify({ jobId: 'job-a', label: 'release' });
  expect(labelForActiveJob('job-b', old)).toBeNull();
  expect(labelForActiveJob('job-a', '{invalid')).toBeNull();
  expect(labelForActiveJob('job-a', JSON.stringify({ jobId: 'job-a', label: 42 }))).toBeNull();
  expect(labelForActiveJob('job-a', JSON.stringify({ jobId: 'job-a', label: 'x'.repeat(201) }))).toBeNull();
  expect(displayedSnapshotRevision({ branch: 'main' }, null)).toBe('main');
  expect(displayedSnapshotRevision({}, null)).toBe('Pinned commit');
});
