import { describe, expect, it } from 'vitest';
import { backendArchitecture, requestArchitecture } from './backendArchitecture';
import type { ArchitectureSnapshot } from './backendArchitecture';
const components = [
  ['app', 'application'],
  ['router', 'router'],
  ['users', 'route'],
  ['orders', 'route'],
  ['handleUsers', 'handler'],
  ['handleOrders', 'handler'],
  ['loadUsers', 'service'],
  ['loadOrders', 'service'],
  ['helper', 'function'],
  ['query', 'database_operation'],
  ['pool', 'database_client'],
  ['frontend', 'function'],
].map(([id, role]) => ({
  id,
  role,
  name: id === 'frontend' ? 'loadUsers' : id,
  referenceId: `ref-${id}`,
  inferred: role === 'service',
}));
const relationships = [
  ['app', 'router', 'mounts_router'],
  ['router', 'users', 'registers_route'],
  ['router', 'orders', 'registers_route'],
  ['app', 'users', 'registers_route'],
  ['users', 'handleUsers', 'handles_route'],
  ['orders', 'handleOrders', 'handles_route'],
  ['handleUsers', 'loadUsers', 'calls'],
  ['handleOrders', 'loadOrders', 'calls'],
  ['loadUsers', 'helper', 'calls'],
  ['helper', 'loadUsers', 'calls'],
  ['loadUsers', 'query', 'calls'],
  ['query', 'pool', 'queries_database'],
].map(([source, target, type], i) => ({
  id: `e${i}`,
  source,
  target,
  type,
  referenceId: `ref-${source}`,
}));
const snapshot: ArchitectureSnapshot = {
  components,
  relationships,
  references: components.map((c) => ({ id: c.referenceId, file: `src/${c.id}.ts` })),
};
describe('backend system architecture', () => {
  it('groups all confirmed backend parts and reachable helpers without pulling in same-named frontend functions', () => {
    const model = backendArchitecture(snapshot);
    expect(model.components.map((c) => c.id)).not.toContain('frontend');
    expect(model.layers.find((l) => l.id === 'services')!.components.map((c) => c.id)).toEqual(
      expect.arrayContaining(['loadUsers', 'loadOrders', 'helper']),
    );
    expect(model.layers.find((l) => l.id === 'database')!.components).toHaveLength(2);
    expect(model.unconnectedCount).toBe(1);
  });
  it('backs every summarized connection with real relationship IDs and never fills missing middleware', () => {
    const model = backendArchitecture(snapshot);
    expect(model.layers.find((l) => l.id === 'middleware')!.components).toHaveLength(0);
    expect(
      model.aggregated.some((e) => e.source === 'middleware' || e.target === 'middleware'),
    ).toBe(false);
    for (const edge of model.aggregated)
      for (const id of edge.relationshipIds)
        expect(snapshot.relationships.some((r) => r.id === id)).toBe(true);
  });
  it('isolates a chosen route, follows real calls, preserves mounts and terminates cycles', () => {
    const request = requestArchitecture(snapshot, 'users');
    expect(request.components.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        'app',
        'router',
        'users',
        'handleUsers',
        'loadUsers',
        'helper',
        'query',
        'pool',
      ]),
    );
    expect(
      request.components.some((c) =>
        ['orders', 'handleOrders', 'loadOrders', 'frontend'].includes(c.id),
      ),
    ).toBe(false);
    expect(
      request.relationships.every(
        (e) =>
          request.components.some((c) => c.id === e.source) &&
          request.components.some((c) => c.id === e.target),
      ),
    ).toBe(true);
    expect(requestArchitecture(snapshot, 'frontend').components).toHaveLength(0);
  });
  it('reports the full connected count when a request diagram is capped', () => {
    const extras = Array.from({ length: 45 }, (_, i) => ({
      id: `extra${i}`,
      name: `extra${i}`,
      role: 'function',
      referenceId: 'ref-helper',
      inferred: false,
    }));
    const extraEdges = extras.map((c, i) => ({
      id: `extraEdge${i}`,
      source: 'loadUsers',
      target: c.id,
      type: 'calls',
      referenceId: 'ref-helper',
    }));
    const result = requestArchitecture(
      {
        ...snapshot,
        components: [...components, ...extras],
        relationships: [...relationships, ...extraEdges],
      },
      'users',
    );
    expect(result.total).toBeGreaterThan(40);
    expect(result.components).toHaveLength(40);
  });
});
