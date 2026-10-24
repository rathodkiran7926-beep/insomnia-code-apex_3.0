export const IMPACT_RELATIONSHIPS = Object.freeze({
  "behavior-change": Object.freeze(["calls"]),
  "remove-or-rename": Object.freeze(["calls", "imports"]),
});

export const IMPACT_DEFAULT_DEPTH = 2;
export const IMPACT_DEFAULT_LIMIT = 30;
export const IMPACT_MAX_DEPTH = 5;
export const IMPACT_MAX_LIMIT = 50;
const MAX_PATHS_PER_COMPONENT = 3;

function snapshotReference(graph, referenceId) {
  return graph.references.find(
    (reference) =>
      reference.id === referenceId && reference.snapshotId === graph.snapshotId,
  );
}

export function traceIncomingImpact(
  graph,
  seedIds,
  { scenario, depth, limit },
) {
  const allowed = IMPACT_RELATIONSHIPS[scenario];
  if (!allowed) throw new Error("Unsupported impact scenario");

  const seeds = new Set(seedIds);
  const components = new Map(
    graph.components.map((component) => [component.id, component]),
  );
  const knownComponents = new Set(
    graph.components
      .filter((component) => snapshotReference(graph, component.referenceId))
      .map((component) => component.id),
  );
  const incoming = new Map();
  for (const edge of graph.relationships) {
    if (!allowed.includes(edge.type)) continue;
    const edges = incoming.get(edge.target) || [];
    edges.push(edge);
    incoming.set(edge.target, edges);
  }
  const minimumDepth = new Map();
  const paths = new Map();
  let frontier = [...seeds].map((id) => ({
    id,
    path: [],
    visited: new Set([id]),
  }));
  let truncated = false;

  for (let level = 1; level <= depth && frontier.length; level++) {
    const next = [];
    for (const state of frontier) {
      for (const edge of incoming.get(state.id) || []) {
        if (
          state.visited.has(edge.source) ||
          seeds.has(edge.source) ||
          !knownComponents.has(edge.source)
        )
          continue;

        const candidateDepth = level;
        const knownDepth = minimumDepth.get(edge.source);
        if (knownDepth !== undefined && knownDepth < candidateDepth) continue;
        if (knownDepth === undefined && minimumDepth.size >= limit) {
          truncated = true;
          continue;
        }

        const path = [...state.path, edge];
        const existingPaths = paths.get(edge.source) || [];
        const isNewPath = !existingPaths.some(
          (existing) =>
            existing.length === path.length &&
            existing.every((item, index) => item.id === path[index].id),
        );
        if (isNewPath && existingPaths.length < MAX_PATHS_PER_COMPONENT) {
          minimumDepth.set(edge.source, candidateDepth);
          paths.set(edge.source, [...existingPaths, path]);
          const visited = new Set(state.visited);
          visited.add(edge.source);
          next.push({ id: edge.source, path, visited });
        } else if (isNewPath) {
          truncated = true;
        }
      }
    }
    frontier = next;
  }

  if (!truncated && depth > 0) {
    const boundary = [...minimumDepth]
      .filter(([, candidateDepth]) => candidateDepth === depth)
      .map(([id]) => id);
    if (
      boundary.some((id) =>
        (incoming.get(id) || []).some(
          (edge) =>
            knownComponents.has(edge.source) &&
            !seeds.has(edge.source) &&
            minimumDepth.get(edge.source) === undefined,
        ),
      )
    )
      truncated = true;
  }

  const affected = [...minimumDepth]
    .sort(
      ([leftId, leftDepth], [rightId, rightDepth]) =>
        leftDepth - rightDepth || leftId.localeCompare(rightId),
    )
    .map(([id, minDepth]) => {
      const component = components.get(id);
      const componentReference =
        component && snapshotReference(graph, component.referenceId);
      const evidencePaths = (paths.get(id) || []).map((path) =>
        [...path].reverse().map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: edge.type,
          referenceId: edge.referenceId,
          reference: snapshotReference(graph, edge.referenceId) || null,
        })),
      );
      return {
        id,
        name: component?.name || id,
        role: component?.role || "unknown",
        referenceId: component?.referenceId || null,
        reference: componentReference || null,
        minDepth,
        relationshipTypes: [
          ...new Set(
            evidencePaths.flatMap((path) => path.map((edge) => edge.type)),
          ),
        ],
        evidencePaths,
      };
    });

  return { affected, truncated };
}

export function analyzeImpactPreview(
  graph,
  componentId,
  scenario,
  depth,
  limit,
) {
  if (!IMPACT_RELATIONSHIPS[scenario])
    throw Object.assign(new Error("Unsupported impact scenario"), {
      status: 400,
    });
  const selected = graph.components.find(
    (component) =>
      component.id === componentId &&
      snapshotReference(graph, component.referenceId),
  );
  if (!selected)
    throw Object.assign(new Error("Component not found in this snapshot"), {
      status: 404,
    });

  const result = traceIncomingImpact(graph, [componentId], {
    scenario,
    depth,
    limit,
  });
  const affectedNames = new Set(
    [selected.name, ...result.affected.map((component) => component.name)].map(
      (name) => name.toLowerCase(),
    ),
  );
  const supportedTests = graph.references
    .filter((reference) => {
      if (reference.snapshotId !== graph.snapshotId) return false;
      if (
        !/(^|\/)(?:__tests__\/|tests?\/)|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(
          reference.file,
        )
      )
        return false;
      const excerpt = (reference.excerpt || "").toLowerCase();
      return [...affectedNames].some(
        (name) => name.length > 1 && excerpt.includes(name),
      );
    })
    .slice(0, 8);
  const selectedReference = snapshotReference(graph, selected.referenceId);
  const unsupportedRelationshipTypes = [
    ...new Set(
      graph.relationships
        .filter(
          (edge) =>
            (edge.source === componentId || edge.target === componentId) &&
            !IMPACT_RELATIONSHIPS[scenario].includes(edge.type),
        )
        .map((edge) => edge.type),
    ),
  ];

  return {
    snapshotId: graph.snapshotId,
    commitSha: graph.commit,
    selectedComponentId: componentId,
    scenario,
    depth,
    limit,
    affected: result.affected,
    supportedTests,
    unresolvedRelationshipCount: (graph.report?.unresolved || []).filter(
      (item) =>
        snapshotReference(graph, item.referenceId)?.file ===
        selectedReference?.file,
    ).length,
    truncated: result.truncated,
    unsupportedRelationshipTypes,
    limitations: [
      `Traversal follows incoming ${IMPACT_RELATIONSHIPS[scenario].join(" and ")} relationships only; edge direction in evidence remains source → target.`,
      "Dynamic dispatch, runtime behavior, unresolved symbols, and unindexed references may be missing.",
      "Tests are suggested only when indexed test references mention an affected component; this does not establish test coverage.",
      "No indexed dependents is not proof that a change is safe.",
    ],
  };
}
