import { randomUUID } from "node:crypto";
import { traceIncomingImpact } from "./impactPreview.js";

export function compareEvidence(pr, before, after) {
  const changed = new Set(
    pr.files.flatMap((f) => [f.path, f.previousPath].filter(Boolean)),
  );
  const renames = new Map(
    pr.files.filter((f) => f.previousPath).map((f) => [f.previousPath, f.path]),
  );
  function index(input, old) {
    const refs = new Map(input.graph.references.map((r) => [r.id, r]));
    const entries = input.graph.components.map((c) => {
      const ref = refs.get(c.referenceId);
      const path = old ? renames.get(ref.file) || ref.file : ref.file;
      const key = JSON.stringify([
        path,
        c.role,
        c.role === "module" ? path : c.name,
      ]);
      const text = input.files[ref.file];
      const source = (
        Number.isInteger(ref.startOffset)
          ? text?.slice(ref.startOffset, ref.endOffset)
          : text
              ?.split("\n")
              .slice(ref.startLine - 1, ref.endLine)
              .join("\n")
      )?.replaceAll("\r", "");
      return { key, component: c, reference: ref, source };
    });
    const groups = new Map();
    for (const e of entries)
      groups.set(e.key, [...(groups.get(e.key) || []), e]);
    return { entries, groups };
  }
  const left = index(before, true),
    right = index(after, false),
    components = [];
  const dto = (e) =>
    e
      ? {
          id: e.component.id,
          name: e.component.name,
          role: e.component.role,
          reference: e.reference,
        }
      : null;
  for (const key of new Set([...left.groups.keys(), ...right.groups.keys()])) {
    const a = left.groups.get(key) || [],
      b = right.groups.get(key) || [];
    if (a.length > 1 || b.length > 1) {
      for (const e of a.filter((e) => changed.has(e.reference.file)))
        components.push({
          status: "removed",
          before: dto(e),
          after: null,
          ambiguous: true,
        });
      for (const e of b.filter((e) => changed.has(e.reference.file)))
        components.push({
          status: "added",
          before: null,
          after: dto(e),
          ambiguous: true,
        });
    } else {
      const x = a[0],
        y = b[0];
      if (!changed.has(x?.reference.file) && !changed.has(y?.reference.file))
        continue;
      if (x && y && x.source === y.source) continue;
      components.push({
        status: !x ? "added" : !y ? "removed" : "modified",
        before: dto(x),
        after: dto(y),
        ambiguous: false,
      });
    }
  }
  function graphDelta(input, indexed) {
    const keys = new Map(indexed.entries.map((e) => [e.component.id, e.key]));
    return new Map(
      input.graph.relationships.map((e) => [
        JSON.stringify([
          keys.get(e.source),
          keys.get(e.target),
          e.type,
          e.mountPath || "",
        ]),
        {
          ...e,
          reference: input.graph.references.find((r) => r.id === e.referenceId),
        },
      ]),
    );
  }
  const oldEdges = graphDelta(before, left),
    newEdges = graphDelta(after, right);
  const edges = {
    added: [...newEdges]
      .filter(([key]) => !oldEdges.has(key))
      .map(([, e]) => e),
    removed: [...oldEdges]
      .filter(([key]) => !newEdges.has(key))
      .map(([, e]) => e),
  };
  function impact(input, side) {
    const seeds = new Set(
      components.flatMap((c) => (c[side] ? [c[side].id] : [])),
    );
    return traceIncomingImpact(input.graph, [...seeds], {
      scenario: "behavior-change",
      depth: 3,
      limit: 150,
    }).affected.map((affected) => ({
      id: affected.id,
      name: affected.name,
      role: affected.role,
      reference: affected.reference,
      depth: affected.minDepth,
      via: affected.relationshipTypes[0],
    }));
  }
  const setup = {
    environment: pr.files.flatMap((f) =>
      f.envNames.map((e) => ({ ...e, path: f.path })),
    ),
    dependencies: [],
    scripts: [],
    migrations: pr.files
      .filter((f) =>
        /(^|\/)(migrations?|prisma\/migrations)(\/|$)|\.sql$/i.test(f.path),
      )
      .map((f) => ({ path: f.path, status: f.status })),
    guides: { before: [], after: [] },
  };
  const manifests = new Set(
    [...Object.keys(before.files), ...Object.keys(after.files)].filter((p) =>
      /(^|\/)package\.json$/.test(p),
    ),
  );
  const manifestWarnings = [];
  for (const path of manifests) {
    let a, b;
    try {
      a = manifest(before.files[path]);
      b = manifest(after.files[path]);
    } catch {
      manifestWarnings.push(`Could not parse ${path}`);
      continue;
    }
    for (const section of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
      "scripts",
    ])
      for (const name of new Set([
        ...Object.keys(a[section] || {}),
        ...Object.keys(b[section] || {}),
      ])) {
        const old = a[section]?.[name] ?? null,
          next = b[section]?.[name] ?? null;
        if (old !== next)
          setup[section === "scripts" ? "scripts" : "dependencies"].push({
            path,
            section,
            name,
            before: old,
            after: next,
          });
      }
    for (const [side, value] of [
      ["before", a],
      ["after", b],
    ])
      if (value.name || value.scripts || value.packageManager)
        setup.guides[side].push({
          path,
          packageManager: value.packageManager || null,
          engines: value.engines || {},
          scripts: value.scripts || {},
        });
  }
  const warnings = [
    "Static source comparison, not a runtime trace or proof of a regression. Setup has not been executed.",
    "Component matching uses renamed file path, role and name. Anonymous functions or duplicate names may appear as added/removed; renames of symbols are not inferred.",
    "Possible impact follows incoming static connections up to three hops, capped at 150 components per version. It is not proof of a failure.",
    "Environment findings are variable names from template patch lines only; modified assignments can appear as both added and removed. Values are hidden. Requiredness is unknown.",
    ...manifestWarnings,
    ...(pr.limited
      ? [
          "GitHub returned a limited changed-file list; this comparison is incomplete.",
        ]
      : []),
    ...before.graph.report.exclusions.map(
      (e) => `Before: ${e.path}: ${e.reason}`,
    ),
    ...after.graph.report.exclusions.map(
      (e) => `After: ${e.path}: ${e.reason}`,
    ),
  ];
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    pr,
    beforeSnapshotId: before.graph.snapshotId,
    afterSnapshotId: after.graph.snapshotId,
    components,
    edges,
    impact: { before: impact(before, "before"), after: impact(after, "after") },
    setup,
    warnings,
  };
}
function manifest(text) {
  const raw = JSON.parse(text || "{}");
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid manifest");
  const result = {};
  for (const section of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
    "scripts",
    "engines",
  ]) {
    result[section] = Object.fromEntries(
      Object.entries(
        raw[section] && typeof raw[section] === "object" ? raw[section] : {},
      ).filter(([, value]) => typeof value === "string"),
    );
  }
  if (typeof raw.name === "string") result.name = raw.name;
  if (typeof raw.packageManager === "string")
    result.packageManager = raw.packageManager;
  return result;
}
