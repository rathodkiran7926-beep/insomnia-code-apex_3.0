export type ArchitectureComponent = {
  id: string;
  name: string;
  role: string;
  inferred: boolean;
  referenceId: string;
  fullPaths?: string[];
};
export type ArchitectureRelationship = {
  id: string;
  source: string;
  target: string;
  type: string;
  referenceId: string;
};
export type ArchitectureSnapshot = {
  components: ArchitectureComponent[];
  relationships: ArchitectureRelationship[];
  references: { id: string; file: string }[];
};
export const architectureLayers = [
  {
    id: 'application',
    name: 'Application',
    description: 'Express application instances',
    roles: ['application'],
    color: '#e5e9ff',
  },
  {
    id: 'routing',
    name: 'Routers & routes',
    description: 'Registered HTTP entry points',
    roles: ['router', 'route'],
    color: '#e1f2ee',
  },
  {
    id: 'middleware',
    name: 'Middleware',
    description: 'Registered request middleware',
    roles: ['middleware'],
    color: '#fff2da',
  },
  {
    id: 'handlers',
    name: 'Request handlers',
    description: 'Functions registered for routes',
    roles: ['handler'],
    color: '#e7efff',
  },
  {
    id: 'services',
    name: 'Services & logic',
    description: 'Inferred services and connected helpers',
    roles: ['service', 'function', 'class'],
    color: '#f0e7fc',
  },
  {
    id: 'database',
    name: 'Database access',
    description: 'Supported clients and query calls',
    roles: ['database_client', 'database_operation'],
    color: '#fbe9df',
  },
] as const;
const types = new Set([
  'mounts_router',
  'registers_route',
  'handles_route',
  'uses_middleware',
  'calls',
  'queries_database',
]);
export const architectureRelationLabels: Record<string, string> = {
  mounts_router: 'mounts',
  registers_route: 'registers',
  handles_route: 'handled by',
  uses_middleware: 'uses middleware',
  calls: 'calls',
  queries_database: 'queries',
};
export function backendArchitecture(snapshot: ArchitectureSnapshot) {
  const byId = new Map(snapshot.components.map((c) => [c.id, c]));
  const seeds = snapshot.components.filter((c) =>
    [
      'application',
      'router',
      'route',
      'middleware',
      'handler',
      'service',
      'database_client',
      'database_operation',
    ].includes(c.role),
  );
  const ids = new Set(seeds.map((c) => c.id));
  const queue = [...ids];
  for (let i = 0; i < queue.length; i++) {
    for (const edge of snapshot.relationships.filter(
      (e) => e.source === queue[i] && types.has(e.type),
    )) {
      const target = byId.get(edge.target);
      if (target && target.role !== 'module' && !ids.has(target.id)) {
        ids.add(target.id);
        queue.push(target.id);
      }
    }
  }
  const components = snapshot.components.filter((c) => ids.has(c.id));
  const relationships = snapshot.relationships.filter(
    (e) => ids.has(e.source) && ids.has(e.target) && types.has(e.type),
  );
  const layers = architectureLayers.map((layer) => ({
    ...layer,
    components: components.filter((c) => (layer.roles as readonly string[]).includes(c.role)),
  }));
  const layerOf = new Map(layers.flatMap((l) => l.components.map((c) => [c.id, l.id] as const)));
  const aggregated = new Map<
    string,
    { id: string; source: string; target: string; types: string[]; relationshipIds: string[] }
  >();
  for (const edge of relationships) {
    const from = layerOf.get(edge.source),
      to = layerOf.get(edge.target);
    if (!from || !to || from === to) continue;
    const id = `${from}:${to}`;
    const previous = aggregated.get(id);
    if (previous) {
      previous.relationshipIds.push(edge.id);
      if (!previous.types.includes(edge.type)) previous.types.push(edge.type);
    } else
      aggregated.set(id, {
        id,
        source: from,
        target: to,
        types: [edge.type],
        relationshipIds: [edge.id],
      });
  }
  return {
    components,
    relationships,
    layers,
    aggregated: [...aggregated.values()],
    unconnectedCount: snapshot.components.filter((c) => c.role !== 'module' && !ids.has(c.id))
      .length,
  };
}
export function requestArchitecture(snapshot: ArchitectureSnapshot, routeId: string) {
  const backend = backendArchitecture(snapshot);
  if (!backend.components.some((c) => c.id === routeId && c.role === 'route'))
    return { components: [], relationships: [], total: 0 };
  const descendants = new Set([routeId]),
    queue = [routeId];
  for (let i = 0; i < queue.length; i++)
    for (const e of backend.relationships.filter(
      (e) =>
        e.source === queue[i] && ['handles_route', 'calls', 'queries_database'].includes(e.type),
    ))
      if (!descendants.has(e.target)) {
        descendants.add(e.target);
        queue.push(e.target);
      }
  const parents = [routeId];
  for (let i = 0; i < parents.length; i++)
    for (const e of backend.relationships.filter(
      (e) => e.target === parents[i] && ['registers_route', 'mounts_router'].includes(e.type),
    ))
      if (!descendants.has(e.source)) {
        descendants.add(e.source);
        parents.push(e.source);
      }
  const total = descendants.size;
  const components = backend.components
    .filter((c) => descendants.has(c.id))
    .sort((a, b) => (a.id === routeId ? -1 : b.id === routeId ? 1 : 0))
    .slice(0, 40);
  const shown = new Set(components.map((c) => c.id));
  return {
    components,
    relationships: backend.relationships.filter((e) => shown.has(e.source) && shown.has(e.target)),
    total,
  };
}
