import { createHash } from "node:crypto";
import { z } from "zod";
import { snapshot, reference, getCheckpoint } from "./checkpoints.js";
import { readNeighborhood } from "./ideNeighborhood.js";
import { parseRepository } from "./github.js";

const id = z
  .string()
  .min(1)
  .max(150)
  .regex(/^[\w-]+$/);
const refIds = z
  .array(z.string().min(1).max(200))
  .max(16)
  .refine((a) => new Set(a).size === a.length);
// Preserve normal editing whitespace; reject terminal/binary control characters.
const authoredText = (max) =>
  z
    .string()
    .max(max)
    .refine((s) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(s));
const checkpointNotes = z
  .object({
    discovery: authoredText(2000),
    unresolved: authoredText(2000),
    nextStep: authoredText(2000),
  })
  .strict();
export const handoffInput = z
  .object({
    snapshotId: id,
    componentId: id.max(200).optional(),
    sourceReferenceIds: refIds,
    question: authoredText(1500).refine((s) => s.trim().length > 0),
    attemptedSteps: authoredText(2000),
    additionalContext: authoredText(2000),
    origin: z
      .object({
        type: z.enum(["editor", "mentor", "map", "pr", "checkpoint"]),
        checkpointId: z.uuid().optional(),
        comparisonId: z.uuid().optional(),
        comparisonSide: z.enum(["before", "after"]).optional(),
      })
      .strict(),
  })
  .strict();
export const handoffSelection = z
  .object({
    referenceIds: refIds,
    relationshipIds: refIds.max(5),
    excerptReferenceIds: refIds.max(4),
    includeDocumentation: z.boolean(),
    includeCheckpointNotes: z.boolean(),
  })
  .strict();
export const previewRequest = z
  .object({ input: handoffInput, selection: handoffSelection.optional() })
  .strict();
export const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const canonical = (value) => parseRepository(value).url.toLowerCase();
const bytes = (value) =>
  Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));
export function bounded(value, max = 64000) {
  if (bytes(value) > max) fail(413, "Handoff exceeds size limit");
  return value;
}
const sensitive = (file) =>
  /(?:^|\/)(?:\.env(?:\..*)?|\.ssh|\.aws|\.npmrc|\.netrc|credentials?(?:\..*)?|secrets?(?:\..*)?|id_rsa|id_ed25519)(?:\/|$)|\.(?:pem|key|p12|pfx)$/i.test(
    file,
  );
const suspicious = (text) =>
  /(?:-----BEGIN [\w ]*PRIVATE KEY|\b(?:password|secret|api[_-]?key|token)\s*[:=]|\b(?:ghp_|github_pat_|AKIA)[A-Za-z0-9_]{12,})/i.test(
    text,
  );
const escape = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+.!|~-]/g, "\\$&");
const fence = (text) => {
  const n = Math.max(
    3,
    ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1),
  );
  return `${"`".repeat(n)}text\n${text}\n${"`".repeat(n)}`;
};
export function markdown(context) {
  const c = context,
    out = [
      "# Reviewed local context handoff",
      "",
      "Prepared locally; no delivery or authenticated senior response is implied.",
      "",
      "## Stored repository identity",
      escape(c.repositoryIdentity),
      `Commit: ${escape(c.indexedCommit)}`,
      `Snapshot: ${escape(c.snapshotId)}`,
      `Origin: ${escape(JSON.stringify(c.origin))}`,
    ];
  if (c.component)
    out.push(
      `Component: ${escape(c.component.name)} (${escape(c.component.id)}; ${escape(c.component.role)})`,
    );
  for (const [title, text] of [
    ["Question (user authored)", c.question],
    ["Attempts (user authored)", c.attemptedSteps],
    ["Additional context (user authored)", c.additionalContext],
  ])
    out.push("", `## ${title}`, escape(text));
  out.push("", "## Source references (stored immutable evidence)");
  for (const r of c.references)
    out.push(
      `- ${escape(r.id)}: [${escape(`${r.file}:${r.startLine}-${r.endLine}`)}](${r.url.replace(/\(/g, "%28").replace(/\)/g, "%29")})`,
    );
  out.push("", "## Stored components");
  for (const item of c.components)
    out.push(
      `- ${escape(item.id)}: ${escape(item.name)}; role ${escape(item.role)}; reference ${escape(item.referenceId)}`,
    );
  out.push("", "## Direct stored relationships");
  for (const e of c.relationships)
    out.push(
      `- ${escape(e.source)} → ${escape(e.target)}: ${escape(e.type)}; reference ${escape(e.referenceId)}${e.inferred ? " (inferred)" : ""}${e.certainty ? `; certainty ${escape(e.certainty)}` : ""}`,
    );
  for (const d of c.documentation)
    out.push(
      "",
      "## Existing documentation (inferred)",
      escape(d.explanation),
      `References: ${d.referenceIds.map(escape).join(", ")}`,
    );
  for (const e of c.excerpts)
    out.push(
      "",
      `## Approved stored excerpt: ${escape(e.referenceId)} (${e.startLine}-${e.endLine})`,
      fence(e.text),
    );
  if (c.checkpointNotes)
    for (const [name, text] of Object.entries(c.checkpointNotes))
      out.push("", `## Checkpoint ${name} (user authored)`, escape(text));
  out.push(
    "",
    "## Limitations",
    ...c.limitations.map((s) => `- ${escape(s)}`),
    "",
    "## Review warnings",
    ...c.warnings.map((s) => `- ${escape(s)}`),
  );
  return bounded(out.join("\n") + "\n");
}
function validateOrigin(db, input, snap) {
  const o = input.origin;
  if (
    (o.type !== "checkpoint" && o.checkpointId) ||
    (o.type !== "pr" && (o.comparisonId || o.comparisonSide))
  )
    fail(400, "Invalid origin association");
  if (o.type === "checkpoint") {
    if (!o.checkpointId)
      fail(400, "Checkpoint origin requires saved checkpoint");
    const { checkpoint } = getCheckpoint(db, o.checkpointId, input.snapshotId);
    if (
      checkpoint.snapshotId !== input.snapshotId ||
      checkpoint.indexedCommit !== snap.indexedCommit ||
      input.sourceReferenceIds.some(
        (id) => !checkpoint.sourceReferenceIds.includes(id),
      )
    )
      fail(
        400,
        "Checkpoint evidence does not match original snapshot and approval",
      );
    return checkpoint;
  }
  if (o.type === "pr") {
    if (!o.comparisonId || !o.comparisonSide)
      fail(400, "PR origin requires comparison and side");
    const exists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pr_comparisons'",
      )
      .get();
    const row =
      exists &&
      db.prepare("SELECT * FROM pr_comparisons WHERE id=?").get(o.comparisonId);
    if (!row) fail(404, "Comparison not found");
    try {
      const c = JSON.parse(row.data),
        p = c.pr,
        before = snapshot(db, c.beforeSnapshotId),
        after = snapshot(db, c.afterSnapshotId),
        url = new URL(p.url);
      if (
        c.id !== o.comparisonId ||
        row.base_snapshot_id !== c.beforeSnapshotId ||
        row.head_snapshot_id !== c.afterSnapshotId ||
        canonical(p.baseRepository) !== before.repositoryIdentity ||
        canonical(p.headRepository) !== after.repositoryIdentity ||
        p.baseCommit !== before.indexedCommit ||
        p.headCommit !== after.indexedCommit ||
        url.origin !== "https://github.com" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/[^/]+\/[^/]+\/pull\/[1-9]\d*$/.test(url.pathname) ||
        canonical(
          `https://github.com${url.pathname.split("/").slice(0, 3).join("/")}`,
        ) !== before.repositoryIdentity ||
        (o.comparisonSide === "before"
          ? c.beforeSnapshotId
          : c.afterSnapshotId) !== input.snapshotId
      )
        fail(400, "Comparison side identity does not match");
    } catch {
      fail(400, "Comparison side identity does not match");
    }
  }
}
export function buildHandoffPreview(db, request) {
  bounded(request, 24 * 1024);
  const p = previewRequest.parse(request),
    input = p.input,
    s = snapshot(db, input.snapshotId),
    checkpoint = validateOrigin(db, input, s);
  const warnings = [],
    limitations = [
      ...s.limitations,
      "Local single-user preparation only; no production authentication or delivery.",
      "Stored relationships and inferred documentation do not prove behavior, intent, or test execution.",
    ];
  const refs = new Map();
  const add = (id) => {
    if (!refs.has(id) && refs.size >= 16) return false;
    const r = reference(db, s, id);
    if (!r || sensitive(r.file)) return false;
    refs.set(id, r);
    return true;
  };
  for (const id of input.sourceReferenceIds)
    if (!add(id))
      fail(400, "Source reference unavailable, sensitive, or outside snapshot");
  let components = [],
    relationships = [],
    documentation = [],
    selected;
  if (input.componentId) {
    const n = readNeighborhood(db, input.snapshotId, input.componentId, {
      limit: 5,
      direction: "both",
    });
    // The selected declaration gets the first candidate slot. Every submitted
    // reference was validated above; retain only bounded extras after it.
    const requestedReferences = [...refs.values()];
    refs.clear();
    if (!add(n.component.referenceId))
      fail(400, "Component source evidence unavailable or sensitive");
    for (const r of requestedReferences) if (refs.size < 16) refs.set(r.id, r);
    if (requestedReferences.some((r) => !refs.has(r.id)))
      limitations.push(
        "Some supplied source references were omitted to keep sixteen candidates including the selected declaration.",
      );
    selected = n.component;
    for (const r of n.references) if (refs.size < 16) add(r.id);
    components = n.components
      .filter((c) => refs.has(c.referenceId))
      .slice(0, 11)
      .map(({ id, name, role, referenceId }) => ({
        id,
        name,
        role,
        referenceId,
      }));
    relationships = [
      ...new Map([...n.incoming, ...n.outgoing].map((e) => [e.id, e])).values(),
    ]
      .filter(
        (e) =>
          refs.has(e.referenceId) &&
          components.some((c) => c.id === e.source) &&
          components.some((c) => c.id === e.target),
      )
      .slice(0, 5)
      .map(
        ({ id, source, target, type, referenceId, certainty, inferred }) => ({
          id,
          source,
          target,
          type,
          referenceId,
          ...(certainty ? { certainty } : {}),
          ...(typeof inferred === "boolean" ? { inferred } : {}),
        }),
      );
    documentation = n.documentation
      .filter((d) => d.referenceIds.every((id) => refs.has(id)))
      .slice(0, 1);
    limitations.push(...n.limitations);
    if (n.truncated)
      limitations.push("Direct relationship candidates were bounded to five.");
  }
  if (checkpoint) {
    for (const [id] of refs)
      if (!checkpoint.sourceReferenceIds.includes(id)) refs.delete(id);
    components = components.filter((c) => refs.has(c.referenceId));
    relationships = relationships.filter(
      (e) =>
        refs.has(e.referenceId) &&
        components.some((c) => c.id === e.source) &&
        components.some((c) => c.id === e.target),
    );
    documentation = documentation.filter((d) =>
      d.referenceIds.every((id) => refs.has(id)),
    );
    if (selected && !refs.has(selected.referenceId))
      fail(400, "Component was not approved in checkpoint");
  }
  const candidates = {
    references: [...refs.values()],
    components,
    relationships,
    documentation,
    checkpointNotesAvailable: !!checkpoint,
  };
  const selection = p.selection ?? {
    referenceIds: [...refs.keys()].slice(0, 8),
    relationshipIds: relationships
      .filter((e) =>
        [
          e.referenceId,
          components.find((c) => c.id === e.source)?.referenceId,
          components.find((c) => c.id === e.target)?.referenceId,
        ].every((id) => [...refs.keys()].slice(0, 8).includes(id)),
      )
      .map((e) => e.id),
    excerptReferenceIds: [],
    includeDocumentation: false,
    includeCheckpointNotes: false,
  };
  if (
    selection.referenceIds.some((id) => !refs.has(id)) ||
    selection.relationshipIds.some(
      (id) => !relationships.some((e) => e.id === id),
    ) ||
    selection.excerptReferenceIds.some(
      (id) => !selection.referenceIds.includes(id),
    ) ||
    (selection.includeCheckpointNotes && !checkpoint)
  )
    fail(400, "Selection is outside available candidates");
  const chosen = new Set(selection.referenceIds),
    chosenComponents = components.filter((c) => chosen.has(c.referenceId)),
    chosenEdges = relationships.filter(
      (e) =>
        selection.relationshipIds.includes(e.id) &&
        chosen.has(e.referenceId) &&
        chosenComponents.some((c) => c.id === e.source) &&
        chosenComponents.some((c) => c.id === e.target),
    );
  if (chosenEdges.length !== selection.relationshipIds.length)
    fail(
      400,
      "Selected relationships require selected source and endpoint evidence",
    );
  const excerpts = [];
  for (const id of selection.excerptReferenceIds) {
    const r = refs.get(id),
      row = db
        .prepare(
          "SELECT content FROM source_files WHERE snapshot_id=? AND path=? AND length(content)<=300000",
        )
        .get(input.snapshotId, r.file);
    if (!row || bytes(row.content) > 300000) {
      limitations.push(`Stored excerpt unavailable for ${id}.`);
      continue;
    }
    const lines = row.content.split("\n");
    if (r.endLine > lines.length) {
      limitations.push(`Stored excerpt range unavailable for ${id}.`);
      continue;
    }
    const endLine = Math.min(r.endLine, r.startLine + 19),
      text = lines.slice(r.startLine - 1, endLine).join("\n");
    if (text.length > 3000) {
      limitations.push(`Stored excerpt exceeds character limit for ${id}.`);
      continue;
    }
    excerpts.push({ referenceId: id, text, startLine: r.startLine, endLine });
    if (endLine < r.endLine)
      limitations.push(`Excerpt for ${id} limited to twenty lines.`);
  }
  const docs = selection.includeDocumentation
    ? documentation.filter(
        (d) =>
          chosenComponents.some((c) => c.id === d.componentId) &&
          d.referenceIds.every((id) => chosen.has(id)),
      )
    : [];
  if (selection.includeDocumentation && !docs.length)
    limitations.push("Selected source-grounded documentation is unavailable.");
  if (!chosen.size) limitations.push("No source evidence selected.");
  const context = {
    schemaVersion: 1,
    snapshotId: s.snapshotId,
    repositoryIdentity: s.repositoryIdentity,
    indexedCommit: s.indexedCommit,
    ...(selected && chosen.has(selected.referenceId)
      ? {
          component: {
            id: selected.id,
            name: selected.name,
            role: selected.role,
            referenceId: selected.referenceId,
          },
        }
      : {}),
    question: input.question,
    attemptedSteps: input.attemptedSteps,
    additionalContext: input.additionalContext,
    origin: input.origin,
    references: [...refs.values()].filter((r) => chosen.has(r.id)),
    components: chosenComponents,
    relationships: chosenEdges,
    documentation: docs,
    excerpts,
    ...(selection.includeCheckpointNotes
      ? { checkpointNotes: checkpointNotes.parse(checkpoint.notes) }
      : {}),
    limitations: [...new Set(limitations)],
    warnings,
  };
  if (suspicious(JSON.stringify(context)))
    warnings.push(
      "Potential sensitive strings detected. Review and exclude content before saving or exporting; this check cannot detect every secret.",
    );
  context.limitations = context.limitations
    .slice(0, 30)
    .map((s) => s.slice(0, 1000));
  bounded(context);
  const text = markdown(context),
    digest = createHash("sha256")
      .update(JSON.stringify({ input, selection, context, markdown: text }))
      .digest("hex");
  return bounded(
    { input, selection, candidates, context, markdown: text, digest },
    256 * 1024,
  );
}
