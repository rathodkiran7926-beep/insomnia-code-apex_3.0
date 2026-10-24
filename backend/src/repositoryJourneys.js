import { createHash } from "node:crypto";
import ts from "typescript";
import { db } from "./storage.js";

const cache = new Map();
export function repositoryGraph(snapshotId) {
  const row = db
    .prepare("SELECT graph_json FROM snapshots WHERE id=?")
    .get(snapshotId);
  if (!row)
    throw Object.assign(
      new Error(
        "Repository snapshot not found. Analyze your repository first.",
      ),
      { status: 404 },
    );
  return JSON.parse(row.graph_json);
}
function sourceFacts(graph, component, reference) {
  const content = db
    .prepare("SELECT content FROM source_files WHERE snapshot_id=? AND path=?")
    .get(graph.snapshotId, reference.file)?.content;
  const excerpt =
    content === undefined
      ? reference.excerpt || ""
      : Number.isInteger(reference.startOffset) &&
          Number.isInteger(reference.endOffset)
        ? content.slice(reference.startOffset, reference.endOffset)
        : content
            .split("\n")
            .slice(reference.startLine - 1, reference.endLine)
            .join("\n");
  const parsed = ts.createSourceFile(
    reference.file,
    excerpt,
    ts.ScriptTarget.Latest,
    true,
  );
  const conditions = [],
    returns = [];
  let parameters = null;
  function visit(node) {
    if (ts.isIfStatement(node) || ts.isConditionalExpression(node))
      conditions.push(
        node.expression?.getText(parsed) || node.condition?.getText(parsed),
      );
    if (ts.isReturnStatement(node))
      returns.push(node.expression?.getText(parsed) || "void");
    if (parameters === null && ts.isFunctionLike(node) && node.parameters)
      parameters = node.parameters.map((p) => p.getText(parsed));
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  const summary = `${component.name} is a ${component.role}${component.inferred ? " (role inferred by the source analyzer)" : ""} declared in ${reference.file}.`;
  return {
    excerpt,
    explanations: {
      beginner: `${summary} Follow the recorded source connection to the next component. This animation does not run the code.`,
      intermediate: `${summary} ${
        conditions.length
          ? "Conditions found in this declaration: " +
            conditions
              .slice(0, 3)
              .map((x) => x.slice(0, 180))
              .join("; ") +
            ". Their runtime outcomes are unknown."
          : "No conditional expression was extracted from this declaration."
      }`,
      advanced: `${summary} Component ${component.id}; source ${reference.id}; commit ${graph.commit}. Connections come from the saved static evidence graph. Call order, branches taken, dynamic dispatch and async scheduling are not observed.`,
    },
    condition: conditions.length
      ? `Source conditions (not evaluated): ${conditions
          .slice(0, 3)
          .map((x) => x.slice(0, 180))
          .join("; ")}`
      : "No condition extracted. Runtime branch outcome unknown.",
    inputs: parameters?.length
      ? `Declared parameters: ${parameters.join(", ").slice(0, 600)}. Runtime values: unknown.`
      : "Runtime inputs: unknown.",
    outputs: returns.length
      ? `Source return expressions: ${returns
          .slice(0, 3)
          .map((x) => x.slice(0, 180))
          .join("; ")}. Runtime result: unknown.`
      : "Runtime output: unknown.",
  };
}

export function repositoryJourneys(snapshotId, { page = 1, componentId } = {}) {
  if (!/^[a-f0-9]{24}$/.test(snapshotId))
    throw Object.assign(new Error("Invalid repository snapshot ID."), {
      status: 400,
    });
  const cacheKey = `${snapshotId}:${componentId || page}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const graph = repositoryGraph(snapshotId);
  const refs = new Map(graph.references.map((r) => [r.id, r]));
  const components = graph.components.filter(
    (c) =>
      refs.has(c.referenceId) &&
      !["module", "application", "router"].includes(c.role),
  );
  const byId = new Map(components.map((c) => [c.id, c]));
  const edges = graph.relationships.filter(
    (e) =>
      [
        "handles_route",
        "calls",
        "reads_from",
        "writes_to",
        "queries_database",
      ].includes(e.type) &&
      byId.has(e.source) &&
      byId.has(e.target) &&
      refs.has(e.referenceId),
  );
  const outgoing = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge);
  }
  const componentEvents = new Map();
  function eventFor(component) {
    if (componentEvents.has(component.id))
      return componentEvents.get(component.id);
    const reference = refs.get(component.referenceId),
      facts = sourceFacts(graph, component, reference);
    const event = {
      key: component.id,
      id: component.id,
      componentId: component.id,
      title: component.name,
      kind: component.role === "route" ? "http_request" : "function_call",
      sourceRefId: reference.id,
      snapshotId,
      source: {
        file: reference.file,
        startLine: reference.startLine,
        endLine: reference.endLine,
      },
      sourceExcerpt: facts.excerpt.slice(0, 16000),
      sourceUrl: reference.url,
      ...facts,
      observedFields: null,
      observationCoverage:
        "static source connection; execution and branch outcomes not captured",
      stateChange: "unknown",
      sideEffects: "Not execution-verified; inspect the highlighted source.",
      connections: (outgoing.get(component.id) || []).map((e) => ({
        target: e.target,
        type: e.type,
        referenceId: e.referenceId,
        source: refs.get(e.referenceId),
      })),
    };
    componentEvents.set(component.id, event);
    return event;
  }
  const roots = [...components].sort(
    (a, b) =>
      Number(b.role === "route") - Number(a.role === "route") ||
      a.name.localeCompare(b.name),
  );
  const journeys = (
    componentId
      ? roots.filter((root) => root.id === componentId)
      : roots.slice((page - 1) * 60, page * 60)
  ).map((root) => {
    const paths = [],
      included = new Set();
    let limited = false;
    function walk(id, path) {
      included.add(id);
      const nextPath = [...path, id],
        next = outgoing.get(id) || [];
      if (nextPath.length >= 10 || !next.length) {
        paths.push(nextPath);
        if (next.length) limited = true;
        return;
      }
      for (const edge of next) {
        if (paths.length >= 16 || included.size >= 64) {
          limited = true;
          break;
        }
        if (nextPath.includes(edge.target)) {
          limited = true;
          paths.push(nextPath);
          continue;
        }
        walk(edge.target, nextPath);
      }
    }
    walk(root.id, []);
    if (!paths.length) paths.push([root.id]);
    const uniquePaths = [
      ...new Map(paths.map((p) => [p.join("/"), p])).values(),
    ];
    const events = [...included].map((id) => eventFor(byId.get(id)));
    const sourceHash = createHash("sha256")
      .update(JSON.stringify({ commit: graph.commit, events }))
      .digest("hex");
    return {
      id: `repo-${snapshotId}-${root.id}`,
      origin: "repository",
      repository: graph.repository,
      commit: graph.commit,
      title:
        root.role === "route" ? `Follow ${root.name}` : `Explore ${root.name}`,
      description: `${refs.get(root.referenceId).file} · ${root.role} · ${uniquePaths.length} source connection path${uniquePaths.length === 1 ? "" : "s"}.`,
      topic: root.role === "route" ? "HTTP routes" : "Components",
      difficulty: "unrated",
      minutes: null,
      tags: [root.name, root.role, refs.get(root.referenceId).file],
      source: "",
      sourceHash,
      snapshotId,
      provenance: `${graph.repository.replace("https://github.com/", "")} · Commit ${graph.commit.slice(0, 12)} · Actual analyzed source`,
      visualization: "flow",
      events,
      related: [],
      scenarios: uniquePaths.map((path, index) => ({
        id: `path-${index + 1}`,
        label: `Connection ${index + 1}: ${byId.get(path.at(-1)).name}`,
        assumption:
          "Follow one resolved source connection chain. Alternate chains are not proven runtime branches or sequential sibling calls.",
        path,
        outcome:
          "End of this saved source connection chain. This is not a captured request outcome.",
      })),
      coverage: [
        "Actual repository components and resolved call/handler connections at the pinned commit. No sample implementation is substituted.",
        "Static connection chain, not a complete execution order. Registration order, data values, taken conditions and async scheduling are unknown.",
        "No approved runtime instrumentation exists for this repository. Observed replay is unavailable.",
        ...(limited
          ? [
              "Connection expansion was limited to 16 paths, 10 events per path and 64 components; cycles are not replayed.",
            ]
          : []),
        `${graph.report?.unresolved?.length || 0} unresolved relationships in this snapshot may leave gaps.`,
      ],
    };
  });
  if (cache.size >= 4) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, journeys);
  return journeys;
}
export function repositoryJourney(id) {
  const match = /^repo-([a-f0-9]{24})-(c\d+)$/.exec(id);
  return match
    ? repositoryJourneys(match[1], { componentId: match[2] }).find(
        (j) => j.id === id,
      )
    : undefined;
}
