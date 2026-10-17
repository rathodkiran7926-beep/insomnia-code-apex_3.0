import { describe, it, expect } from 'vitest';
import { directedLayout } from './graphLayout';

describe('directed graph layout', () => {
  it('places actual dependencies after their callers and does not invent edges', () => {
    const ids = ['handler', 'route', 'service', 'app'];
    const edges = [
      { source: 'app', target: 'route' },
      { source: 'route', target: 'handler' },
      { source: 'handler', target: 'service' },
    ];
    const layout = directedLayout(ids, edges);
    expect(layout.positions.get('app')!.x).toBeLessThan(layout.positions.get('route')!.x);
    expect(layout.positions.get('route')!.x).toBeLessThan(layout.positions.get('handler')!.x);
    expect(layout.positions.get('handler')!.x).toBeLessThan(layout.positions.get('service')!.x);
    expect(edges).toHaveLength(3);
  });
  it('terminates cycles, handles self calls and keeps every card separated', () => {
    const ids = Array.from({ length: 42 }, (_, i) => `node${i}`);
    const edges = ids.map((id, i) => ({ source: id, target: ids[(i + 1) % ids.length] }));
    const result = directedLayout(ids, [...edges, { source: 'node0', target: 'node0' }]);
    expect(result.positions.size).toBe(42);
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = result.positions.get(ids[i])!,
          b = result.positions.get(ids[j])!;
        expect(Math.abs(a.x - b.x) >= 250 || Math.abs(a.y - b.y) >= 120).toBe(true);
      }
    expect(result.height).toBeLessThan(1100);
  });
  it('ignores unknown endpoints and is deterministic for disconnected nodes', () => {
    const layout = () => directedLayout(['a', 'b'], [{ source: 'missing', target: 'a' }]);
    expect(layout()).toEqual(layout());
    expect(layout().positions.size).toBe(2);
    expect(directedLayout([], []).positions.size).toBe(0);
  });
});
