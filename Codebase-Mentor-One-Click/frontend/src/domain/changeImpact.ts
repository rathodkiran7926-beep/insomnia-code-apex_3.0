import type { RepositorySnapshot } from './analysisTypes';

type Graph = Pick<RepositorySnapshot, 'components' | 'relationships' | 'references' | 'snapshotId'>;
type Edge = Graph['relationships'][number];
export type ImpactStep = { from: string; to: string; edge: Edge };
export type ImpactEntry = {
  component: Graph['components'][number];
  depth: number;
  seed: string;
  path: ImpactStep[];
};

// Reverse dependency traversal. Router/middleware changes also follow recorded
// registrations outward; normal route impact never fans out to sibling routes.
export function changeImpact(graph: Graph, seedIds: string[], maxDepth = 6) {
  const refs = new Set(
    graph.references.filter((r) => r.snapshotId === graph.snapshotId).map((r) => r.id),
  );
  const components = new Map(
    graph.components.filter((c) => refs.has(c.referenceId)).map((c) => [c.id, c]),
  );
  const seeds = [...new Set(seedIds)].filter((id) => components.has(id));
  const visited = new Map<string, ImpactEntry>(
    seeds.map((id) => [
      id,
      {
        component: components.get(id)!,
        depth: 0,
        seed: id,
        path: [],
      },
    ]),
  );
  const adjacent = new Map<string, { to: string; edge: Edge }[]>();
  function connect(from: string, to: string, edge: Edge) {
    const list = adjacent.get(from) || [];
    list.push({ to, edge });
    adjacent.set(from, list);
  }
  for (const edge of graph.relationships) {
    if (!components.has(edge.source) || !components.has(edge.target) || !refs.has(edge.referenceId))
      continue;
    if (
      ['calls', 'handles_route', 'queries_database', 'imports', 'uses_middleware'].includes(
        edge.type,
      )
    )
      connect(edge.target, edge.source, edge);
    if (['registers_route', 'mounts_router'].includes(edge.type))
      connect(edge.source, edge.target, edge);
  }
  const queue = [...visited.values()];
  const limit = Math.min(20, Math.max(1, Math.floor(maxDepth) || 6));
  let truncated = false;
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const next of adjacent.get(current.component.id) || []) {
      if (visited.has(next.to)) continue;
      if (current.depth >= limit) {
        truncated = true;
        continue;
      }
      const item = {
        component: components.get(next.to)!,
        depth: current.depth + 1,
        seed: current.seed,
        path: [...current.path, { from: current.component.id, to: next.to, edge: next.edge }],
      };
      visited.set(next.to, item);
      queue.push(item);
    }
  }
  const entries = [...visited.values()].filter((item) => item.depth > 0);
  return { seeds, entries, truncated };
}
