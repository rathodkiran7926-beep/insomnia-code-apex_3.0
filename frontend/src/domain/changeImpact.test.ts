import { describe, expect, it } from 'vitest';
import { changeImpact } from './changeImpact';
import type { RepositorySnapshot } from './analysisTypes';

function fixture() {
  const components = [
    ['app', 'application'],
    ['router', 'router'],
    ['route', 'route'],
    ['otherRoute', 'route'],
    ['handler', 'handler'],
    ['otherHandler', 'handler'],
    ['service', 'service'],
    ['helper', 'function'],
    ['middleware', 'middleware'],
    ['isolated', 'function'],
    ['query', 'database_operation'],
    ['pool', 'database_client'],
  ].map(([id, role]) => ({
    id,
    name: id,
    role,
    referenceId: `ref-${id}`,
    evidence: [],
    inferred: false,
    validation: '',
  }));
  const relationships = [
    ['app', 'router', 'mounts_router'],
    ['router', 'route', 'registers_route'],
    ['router', 'otherRoute', 'registers_route'],
    ['router', 'middleware', 'uses_middleware'],
    ['route', 'handler', 'handles_route'],
    ['otherRoute', 'otherHandler', 'handles_route'],
    ['handler', 'service', 'calls'],
    ['service', 'helper', 'calls'],
    ['helper', 'service', 'calls'],
    ['service', 'query', 'calls'],
    ['query', 'pool', 'queries_database'],
  ].map(([source, target, type], i) => ({
    id: `e${i}`,
    source,
    target,
    type,
    referenceId: `ref-${source}`,
  }));
  return {
    snapshotId: 's1',
    components,
    relationships,
    references: components.map((c) => ({
      id: c.referenceId,
      snapshotId: 's1',
      file: `${c.id}.ts`,
      startLine: 1,
      endLine: 10,
      url: `https://example.com/${c.id}`,
      excerpt: '',
    })),
  } satisfies Pick<
    RepositorySnapshot,
    'snapshotId' | 'components' | 'relationships' | 'references'
  >;
}
describe('change impact traversal', () => {
  it('traces transitive callers to their route, without unrelated sibling routes or dependencies', () => {
    const result = changeImpact(fixture(), ['helper']);
    expect(result.entries.map((i) => i.component.id)).toEqual(['service', 'handler', 'route']);
    const route = result.entries.at(-1)!;
    expect(route.depth).toBe(3);
    expect(route.path.map((s) => s.to)).toEqual(['service', 'handler', 'route']);
    expect(route.path.every((s) => !!s.edge.referenceId)).toBe(true);
    expect(result.truncated).toBe(false);
  });
  it('handles cycles, duplicate seeds and converging paths with shortest distances', () => {
    const result = changeImpact(fixture(), ['helper', 'service', 'service']);
    expect(result.seeds).toEqual(['helper', 'service']);
    expect(result.entries.map((i) => [i.component.id, i.depth])).toEqual([
      ['handler', 1],
      ['route', 2],
    ]);
    expect(result.entries.at(-1)?.seed).toBe('service');
  });
  it('marks depth-limited results and preserves the selected source', () => {
    const result = changeImpact(fixture(), ['helper'], 1);
    expect(result.entries.map((i) => i.component.id)).toEqual(['service']);
    expect(result.truncated).toBe(true);
  });
  it('finds mounted routes for changed routers and potentially affected middleware registrations', () => {
    for (const seed of ['router', 'app', 'middleware']) {
      const result = changeImpact(fixture(), [seed]);
      expect(
        result.entries.filter((i) => i.component.role === 'route').map((i) => i.component.id),
      ).toEqual(['route', 'otherRoute']);
      expect(result.entries.some((i) => i.component.id === 'otherHandler')).toBe(false);
    }
  });
  it('traces database dependencies up to handlers and routes', () => {
    const result = changeImpact(fixture(), ['pool']);
    expect(result.entries.some((i) => i.component.id === 'route')).toBe(true);
    expect(result.entries.some((i) => i.component.id === 'otherRoute')).toBe(false);
  });
  it('rejects dangling edges and cross-snapshot evidence', () => {
    const graph = fixture();
    graph.references.find((r) => r.id === 'ref-handler')!.snapshotId = 'other';
    graph.relationships.push({
      id: 'bad',
      source: 'missing',
      target: 'service',
      type: 'calls',
      referenceId: 'ref-service',
    });
    expect(changeImpact(graph, ['service']).entries.map((i) => i.component.id)).toEqual(['helper']);
    expect(changeImpact(graph, ['handler', 'missing']).seeds).toEqual([]);
  });
  it('returns explicit empty results for isolated components and missing selections', () => {
    expect(changeImpact(fixture(), ['isolated']).entries).toEqual([]);
    expect(changeImpact(fixture(), []).seeds).toEqual([]);
  });
});
