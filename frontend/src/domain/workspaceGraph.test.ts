import { expect, it } from 'vitest';
import { workspaceGraphPositions } from './workspaceGraph';
it('centers the selection between callers and dependencies, without duplicate reciprocal nodes', () => {
  const map = workspaceGraphPositions('selected', ['a', 'b', 'selected'], ['b', 'c', 'c']);
  expect(map.size).toBe(4);
  expect(map.get('a')!.x).toBeLessThan(map.get('selected')!.x);
  expect(map.get('b')!.x).toBeGreaterThan(map.get('selected')!.x);
  expect(map.get('c')!.y).not.toBe(map.get('b')!.y);
  expect(map.get('b')!.y + map.get('c')!.y).toBe(0);
});
it('handles isolated nodes and incoming-only selections', () => {
  expect(workspaceGraphPositions('only', [], []).size).toBe(1);
  const map = workspaceGraphPositions('selected', ['a', 'b'], []);
  expect(map.get('a')!.y).toBe(-map.get('b')!.y);
});
