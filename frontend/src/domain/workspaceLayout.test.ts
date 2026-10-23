import { describe, it, expect } from 'vitest';
import {
  automaticWorkspaceMode,
  automaticGraphShare,
  workspaceFileTree,
  componentForCitation,
} from './workspaceLayout';
describe('workspace layout decisions', () => {
  it('keeps simple selections focused on code and gives complex ones more graph space', () => {
    expect(automaticWorkspaceMode(0)).toBe('code');
    expect(automaticWorkspaceMode(2)).toBe('code');
    expect(automaticWorkspaceMode(3)).toBe('split');
    expect(automaticGraphShare(12)).toBeGreaterThan(automaticGraphShare(3));
  });
  it('builds a deterministic tree without losing full paths or duplicating files', () => {
    const tree = workspaceFileTree(['src/api/a.ts', 'README.md', 'src/ui/a.ts', 'src/api/a.ts']);
    expect(tree.files).toEqual(['README.md']);
    expect(tree.folders[0].folders.map((f) => f.name)).toEqual(['api', 'ui']);
    expect(tree.folders[0].folders[0].files).toEqual(['src/api/a.ts']);
    expect(workspaceFileTree([]).files).toEqual([]);
  });
});

it('keeps citation context on its function instead of selecting the enclosing file module', () => {
  const components = [
    { id: 'module', referenceId: 'file' },
    { id: 'function', referenceId: 'fn' },
  ];
  const refs = [
    { id: 'file', file: 'a.ts', startLine: 1, endLine: 100 },
    { id: 'fn', file: 'a.ts', startLine: 10, endLine: 20 },
  ];
  expect(componentForCitation(components, refs, { file: 'a.ts', startLine: 12 }, 'function')).toBe(
    'function',
  );
  expect(componentForCitation(components, refs, { file: 'a.ts', startLine: 12 }, 'other')).toBe(
    'function',
  );
  expect(
    componentForCitation(components, refs, { file: 'missing.ts', startLine: 1 }, 'function'),
  ).toBeUndefined();
});
