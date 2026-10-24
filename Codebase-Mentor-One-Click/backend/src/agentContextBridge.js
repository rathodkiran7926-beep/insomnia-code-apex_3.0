import { createHash } from "node:crypto";
import { db } from "./storage.js";

const cache = new Map();
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isInteger(value) ? value : min));
const estimateTokens = (value) => Math.ceil(Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8") / 3);
const safeOptions = (options = {}) => ({
  maxTokens: clamp(options.maxTokens ?? 2400, 500, 16000),
  targetTokens: Math.min(clamp(options.targetTokens ?? 1800, 200, 12000), clamp(options.maxTokens ?? 2400, 500, 16000)),
  maxNodes: clamp(options.maxNodes ?? 18, 1, 50),
  maxEdges: clamp(options.maxEdges ?? 24, 1, 80),
  maxFiles: clamp(options.maxFiles ?? 8, 1, 20),
  depth: clamp(options.depth ?? 2, 0, 3),
});

export function createGraphAdapter(database = db) {
  return {
    snapshot(snapshotId) {
      const row = database.prepare("SELECT id,repository_id,commit_sha FROM snapshots WHERE id=?").get(snapshotId);
      if (!row) throw Object.assign(new Error("Snapshot not found"), { status: 404 });
      // Identity columns are canonical; graph_json is deliberately not deserialized for context requests.
      return { id: row.id, repository: row.repository_id, commit: row.commit_sha };
    },
    records(table, snapshotId, limit) {
      if (!["components", "relationships", "source_references"].includes(table)) throw new Error("Unsupported graph record type");
      return database.prepare(`SELECT data FROM ${table} WHERE snapshot_id=? LIMIT ?`).all(snapshotId, limit).map((row) => JSON.parse(row.data));
    },
    searchComponents(snapshotId, query, terms, limit) {
      const clauses = ["LOWER(json_extract(data,'$.name'))=?"];
      const bindings = [snapshotId, query];
      for (const term of terms) { clauses.push("LOWER(data) LIKE ? ESCAPE '\\'"); bindings.push(`%${term.replace(/[\\%_]/g, "\\$&")}%`); }
      bindings.push(limit);
      return database.prepare(`SELECT data FROM components WHERE snapshot_id=? AND (${clauses.join(" OR ")}) LIMIT ?`).all(...bindings).map((row) => JSON.parse(row.data));
    },
    searchFileComponents(snapshotId, query, limit) {
      const sql = "SELECT c.data FROM components c JOIN source_references r ON r.snapshot_id=c.snapshot_id AND r.id=json_extract(c.data,'$.referenceId') WHERE c.snapshot_id=? AND LOWER(json_extract(r.data,'$.file'))=? LIMIT ?";
      return database.prepare(sql).all(snapshotId, query, limit).map((row) => JSON.parse(row.data));
    },
    references(snapshotId, ids) {
      if (!ids.length) return [];
      const marks = ids.map(() => "?").join(",");
      return database.prepare(`SELECT data FROM source_references WHERE snapshot_id=? AND id IN (${marks})`).all(snapshotId, ...ids).map((row) => JSON.parse(row.data));
    },
    nodes(snapshotId, ids) {
      if (!ids.length) return [];
      const marks = ids.map(() => "?").join(",");
      return database.prepare("SELECT data FROM components WHERE snapshot_id=? AND id IN (" + marks + ")").all(snapshotId, ...ids).map((row) => JSON.parse(row.data));
    },
    edges(snapshotId, nodeIds, limit) {
      if (!nodeIds.length) return [];
      const clauses = nodeIds.flatMap(() => ["json_extract(data,'$.source')=?", "json_extract(data,'$.target')=?"]);
      const bindings = [snapshotId, ...nodeIds.flatMap((id) => [id, id]), limit];
      return database.prepare(`SELECT data FROM relationships WHERE snapshot_id=? AND (${clauses.join(" OR ")}) LIMIT ?`).all(...bindings).map((row) => JSON.parse(row.data));
    },
    source(snapshotId, file) {
      return database.prepare("SELECT content FROM source_files WHERE snapshot_id=? AND path=?").get(snapshotId, file)?.content;
    },
  };
}

const adapter = createGraphAdapter();
const normalizeQuery = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();
const termsFor = (query) => [...new Set((query.match(/[\p{L}\p{N}_./-]{2,}/gu) || []).map((x) => x.toLowerCase()))].slice(0, 32);

function validateReferences(refs, snapshotId) {
  return refs.filter((ref) => ref.snapshotId === snapshotId && typeof ref.file === "string" && !ref.file.split("/").some((part) => part === ".." || part === "." || !part) && Number.isInteger(ref.startLine) && Number.isInteger(ref.endLine) && ref.startLine > 0 && ref.endLine >= ref.startLine);
}

function buildRetrieval(snapshotId, query, options, mode = "task") {
  const started = performance.now();
  const snap = adapter.snapshot(snapshotId);
  const opts = safeOptions(options);
  const normalized = normalizeQuery(query);
  const terms = termsFor(query);
  const key = createHash("sha256").update(JSON.stringify([snap.repository, snap.id, snap.commit, normalized, opts, mode])).digest("hex");
  const cached = cache.get(key);
  if (cached) return { ...structuredClone(cached), cache: { hit: true }, latencyMs: Math.round(performance.now() - started) };

  // Existing SQLite records are scoped to one snapshot. Bound each read so a request never deserializes the whole graph.
  const candidateMap = new Map(adapter.searchComponents(snap.id, normalized, terms, 500).map((node) => [node.id, node]));
  for (const node of adapter.searchFileComponents(snap.id, normalized, 500)) candidateMap.set(node.id, node);
  const candidates = [...candidateMap.values()];
  const refsById = new Map(validateReferences(adapter.references(snap.id, candidates.map((n) => n.referenceId).filter(Boolean)), snap.id).map((r) => [r.id, r]));
  const scored = candidates.map((node) => {
    const ref = refsById.get(node.referenceId);
    const name = (node.name || "").toLowerCase();
    const file = (ref?.file || "").toLowerCase();
    const exact = name === normalized || file === normalized;
    const contains = normalized.length > 1 && (name.includes(normalized) || file.includes(normalized));
    const hits = terms.filter((term) => name.includes(term) || file.includes(term) || (node.role || "").includes(term) || (node.evidence || []).some((e) => e.toLowerCase().includes(term)));
    const score = (exact ? 100 : 0) + (contains ? 35 : 0) + hits.length * 8 + (ref ? 2 : 0);
    return { node, ref, score, exact };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
  const seeds = scored.slice(0, opts.maxNodes);
  const selected = new Map(seeds.map((item) => [item.node.id, item]));
  const selectedEdges = [];
  const seenEdges = new Set();
  let frontier = new Set(selected.keys());
  for (let depth = 0; depth < opts.depth && frontier.size && selectedEdges.length < opts.maxEdges; depth++) {
    const next = new Set();
    const edges = adapter.edges(snap.id, [...frontier], Math.min(500, opts.maxEdges * 8));
    const endpoints = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
    const unseen = adapter.nodes(snap.id, [...endpoints].filter((id) => !selected.has(id)));
    const unseenRefs = validateReferences(adapter.references(snap.id, unseen.map((node) => node.referenceId).filter(Boolean)), snap.id);
    const unseenRefMap = new Map(unseenRefs.map((ref) => [ref.id, ref]));
    for (const ref of unseenRefs) refsById.set(ref.id, ref);
    for (const node of unseen) scored.push({ node, ref: unseenRefMap.get(node.referenceId), score: 0, exact: false });
    for (const edge of edges) {
      if (selectedEdges.length >= opts.maxEdges) break;
      if (seenEdges.has(edge.id)) continue;
      seenEdges.add(edge.id);
      const otherId = frontier.has(edge.source) ? edge.target : edge.source;
      const item = scored.find((x) => x.node.id === otherId);
      if (item && !selected.has(otherId) && selected.size < opts.maxNodes) {
        selected.set(otherId, { ...item, score: Math.max(item.score, 1), indirect: true });
        next.add(otherId);
      }
      selectedEdges.push(edge);
    }
    frontier = next;
  }
  for (const ref of validateReferences(adapter.references(snap.id, selectedEdges.map((edge) => edge.referenceId).filter(Boolean)), snap.id)) refsById.set(ref.id, ref);
  const ranked = [...selected.values()].sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
  const fileRefs = new Map();
  for (const item of ranked) if (item.ref && fileRefs.size < opts.maxFiles) fileRefs.set(item.ref.id, item.ref);
  for (const edge of selectedEdges) {
    const ref = refsById.get(edge.referenceId);
    if (ref && fileRefs.size < opts.maxFiles) fileRefs.set(ref.id, ref);
  }
  const evidence = [];
  const ranges = [];
  for (const ref of [...fileRefs.values()].sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine || a.endLine - b.endLine)) {
    const previous = ranges.at(-1);
    if (previous && previous.file === ref.file && ref.startLine <= previous.endLine) {
      previous.endLine = Math.max(previous.endLine, ref.endLine);
      previous.references.push(ref);
    } else ranges.push({ file: ref.file, startLine: ref.startLine, endLine: ref.endLine, references: [ref] });
  }
  for (const range of ranges) {
    const { file, startLine, endLine, references } = range;
    const source = adapter.source(snap.id, file);
    const lines = typeof source === "string" ? source.split(/\r?\n/) : null;
    const excerpt = lines ? lines.slice(startLine - 1, Math.min(endLine, startLine + 39)).join("\n") : references[0].excerpt || "";
    evidence.push({ referenceId: references[0].id, referenceIds: references.map((ref) => ref.id), file, startLine, endLine: Math.min(endLine, startLine + 39), excerpt: excerpt.slice(0, 2400), excerptStatus: lines ? "stored_snapshot_source" : references[0].excerpt ? "analyzer_excerpt" : "missing" });
  }
  const nodes = ranked.map(({ node, score, exact, indirect }) => ({ id: node.id, name: node.name, role: node.role, referenceId: refsById.has(node.referenceId) ? node.referenceId : null, match: exact ? "exact" : indirect ? "dependency" : "lexical", score, ...(node.evidence?.length ? { facts: [...new Set(node.evidence)].slice(0, 2) } : {}) }));
  const relevantIds = new Set(nodes.map((n) => n.id));
  const graphEdges = selectedEdges.filter((e) => relevantIds.has(e.source) && relevantIds.has(e.target)).map((e) => ({ id: e.id, source: e.source, target: e.target, type: e.type, referenceId: refsById.has(e.referenceId) ? e.referenceId : null }));
  const evidenceStatus = nodes.some((node) => node.referenceId) ? "evidence_found" : "insufficient_evidence";
  const warnings = [];
  if (evidenceStatus === "insufficient_evidence") warnings.push("No validated source reference supports the selected graph records.");
  if (evidence.some((item) => item.excerptStatus === "missing")) warnings.push("Some source references have no stored excerpt.");
  if (evidence.some((item) => item.excerptStatus === "analyzer_excerpt")) warnings.push("Some evidence uses analyzer excerpts because complete analyzed file content was not stored.");
  warnings.push("Live working-tree changes cannot be checked by the existing project services.");
  const freshness = !evidence.length || nodes.some((node) => !node.referenceId) || evidence.some((item) => item.excerptStatus === "missing")
    ? "evidence_unverifiable"
    : evidence.every((item) => item.excerptStatus === "stored_snapshot_source")
      ? "snapshot_consistent_live_unverified"
      : "snapshot_pinned_live_unverified";
  const identity = { repository: snap.repository, snapshotId: snap.id, commit: snap.commit };
  const base = { schemaVersion: 1, identity, query, freshness, evidenceStatus, nodes, relationships: graphEdges, evidence, warnings, limits: { targetTokens: opts.targetTokens, maxTokens: opts.maxTokens } };
  const omitted = { nodes: 0, relationships: 0, evidence: 0 };
  // Drop optional evidence first, then indirect/lowest ranked graph material. Keep identity and freshness in every valid JSON response.
  while (estimateTokens(base) > opts.targetTokens && base.evidence.some((item) => item.excerpt)) {
    const item = [...base.evidence].reverse().find((entry) => entry.excerpt);
    item.excerpt = "";
    item.excerptStatus = "excerpt_omitted_budget";
    omitted.evidence++;
  }
  while (estimateTokens(base) > opts.targetTokens && base.relationships.length) { base.relationships.pop(); omitted.relationships++; }
  while (estimateTokens(base) > opts.targetTokens && base.nodes.length > 1) { base.nodes.pop(); omitted.nodes++; }
  const referencedIds = new Set([...base.nodes.map((node) => node.referenceId), ...base.relationships.map((edge) => edge.referenceId)].filter(Boolean));
  const retainedEvidence = base.evidence.filter((item) => item.referenceIds.some((id) => referencedIds.has(id)));
  omitted.evidence += base.evidence.length - retainedEvidence.length;
  base.evidence = retainedEvidence;
  let truncated = Object.values(omitted).some(Boolean) || estimateTokens(base) > opts.maxTokens;
  const makePrompt = () => [
    `${identity.repository} @ ${identity.snapshotId}/${identity.commit}; ${base.evidenceStatus}; ${freshness}`,
    ...base.nodes.map((n) => `${n.name} (${n.role}, ${n.match})${n.referenceId ? ` [${n.referenceId}]` : ""}`),
    ...base.relationships.map((e) => `${e.source} -${e.type}-> ${e.target}${e.referenceId ? ` [${e.referenceId}]` : ""}`),
    ...base.evidence.map((e) => `${e.file}:${e.startLine}-${e.endLine} [${e.referenceId}]${e.excerpt ? `\n${e.excerpt}` : ""}`),
    ...base.warnings,
    ...(truncated ? [`Omitted ${omitted.nodes} nodes, ${omitted.relationships} relationships, ${omitted.evidence} excerpts.`] : []),
  ].join("\n");
  let promptSlice = makePrompt();
  const combinedEstimate = () => estimateTokens({ ...base, promptSlice, tokenEstimate: 0, truncated, omitted, latencyMs: 0, cache: { hit: false } });
  while (combinedEstimate() > opts.maxTokens && base.evidence.some((item) => item.excerpt)) {
    const item = [...base.evidence].reverse().find((entry) => entry.excerpt);
    item.excerpt = "";
    item.excerptStatus = "excerpt_omitted_budget";
    omitted.evidence++;
    truncated = true;
    promptSlice = makePrompt();
  }
  while (combinedEstimate() > opts.maxTokens && base.relationships.length) { base.relationships.pop(); omitted.relationships++; truncated = true; promptSlice = makePrompt(); }
  while (combinedEstimate() > opts.maxTokens && base.nodes.length > 1) { base.nodes.pop(); omitted.nodes++; truncated = true; promptSlice = makePrompt(); }
  for (const node of [...base.nodes].reverse()) {
    while (combinedEstimate() > opts.maxTokens && node.facts?.length) { node.facts.pop(); truncated = true; }
    if (combinedEstimate() <= opts.maxTokens) break;
    if (Object.hasOwn(node, "score")) { delete node.score; truncated = true; }
  }
  if (combinedEstimate() > opts.maxTokens && base.query.length > 80) { base.query = base.query.slice(0, 80); truncated = true; }
  if (combinedEstimate() > opts.maxTokens) { base.query = ""; truncated = true; }
  promptSlice = makePrompt();
  const jsonSnapshot = { ...base, tokenEstimate: estimateTokens(base), truncated, omitted };
  const result = { ...jsonSnapshot, promptSlice, tokenEstimate: combinedEstimate(), truncated: truncated || combinedEstimate() > opts.maxTokens, latencyMs: Math.round(performance.now() - started), cache: { hit: false } };
  cache.set(key, structuredClone(result));
  if (cache.size > 128) cache.delete(cache.keys().next().value);
  return result;
}

export function getTaskContext(snapshotId, task, options) {
  if (typeof task !== "string" || !task.trim() || task.length > 2000) throw Object.assign(new Error("Task must be 1 to 2000 characters"), { status: 400 });
  return buildRetrieval(snapshotId, task, options);
}

export function inspectSymbol(snapshotId, symbol, options = {}) {
  if (typeof symbol !== "string" || !symbol.trim() || symbol.length > 300) throw Object.assign(new Error("Symbol must be 1 to 300 characters"), { status: 400 });
  return buildRetrieval(snapshotId, symbol, { ...options, depth: Math.min(1, options.depth ?? 1) }, "symbol");
}

export function exploreDependencies(snapshotId, symbol, options = {}) {
  if (typeof symbol !== "string" || !symbol.trim() || symbol.length > 300) throw Object.assign(new Error("Symbol must be 1 to 300 characters"), { status: 400 });
  return buildRetrieval(snapshotId, symbol, { ...options, depth: Math.min(3, options.depth ?? 2) }, "dependencies");
}

export function checkContextDrift(snapshotId, referenceIds = []) {
  if (!Array.isArray(referenceIds) || referenceIds.length > 100 || referenceIds.some((id) => typeof id !== "string" || id.length > 200)) throw Object.assign(new Error("referenceIds must contain at most 100 identifiers"), { status: 400 });
  const snap = adapter.snapshot(snapshotId);
  const raw = referenceIds.length ? adapter.references(snap.id, referenceIds) : [];
  const rawIds = new Set(raw.map((ref) => ref.id));
  const missingReferenceIds = referenceIds.filter((id) => !rawIds.has(id));
  const invalidCoordinateIds = [];
  const unavailableSourceIds = [];
  for (const ref of raw) {
    if (!validateReferences([ref], snap.id).length) { invalidCoordinateIds.push(ref.id); continue; }
    const source = adapter.source(snap.id, ref.file);
    if (typeof source !== "string") { unavailableSourceIds.push(ref.id); continue; }
    const lineCount = source.split(/\r?\n/).length;
    if (ref.endLine > lineCount) invalidCoordinateIds.push(ref.id);
  }
  const status = !referenceIds.length
    ? "not_checked"
    : missingReferenceIds.length || invalidCoordinateIds.length
      ? "stale_or_invalid_evidence"
      : unavailableSourceIds.length
        ? "unverifiable"
        : "snapshot_consistent_live_unverified";
  return {
    identity: { repository: snap.repository, snapshotId: snap.id, commit: snap.commit },
    status,
    checkedReferences: raw.length,
    missingReferenceIds,
    invalidCoordinateIds,
    unavailableSourceIds,
    message: "References and line ranges are checked against the stored analyzed snapshot. No service compares the snapshot with a live working tree.",
  };
}

export function clearAgentContextCache() { cache.clear(); }
