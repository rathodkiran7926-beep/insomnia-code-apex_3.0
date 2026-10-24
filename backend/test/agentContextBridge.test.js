import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.DATABASE_PATH = ":memory:";
const { db } = await import("../src/storage.js");
const { checkContextDrift, clearAgentContextCache, createGraphAdapter, exploreDependencies, getTaskContext, inspectSymbol } = await import("../src/agentContextBridge.js");

function fixture(repository = "https://github.com/example/context-fixture") {
  const snapshotId = randomUUID();
  const commit = "a".repeat(40);
  const graph = { snapshotId, repository, commit, components: [], relationships: [], references: [] };
  db.prepare("INSERT INTO snapshots VALUES (?,?,?,?)").run(snapshotId, repository, commit, JSON.stringify(graph));
  const refs = [
    { id: "r-handler", snapshotId, file: "src/handler.js", startLine: 1, endLine: 3, excerpt: "export function handleRequest() {}", url: "" },
    { id: "r-overlap", snapshotId, file: "src/handler.js", startLine: 2, endLine: 4, excerpt: "return loadAccount();", url: "" },
    { id: "r-service", snapshotId, file: "src/service.js", startLine: 1, endLine: 3, excerpt: "export function loadAccount() {}", url: "" },
    { id: "r-unrelated", snapshotId, file: "src/paint.js", startLine: 1, endLine: 2, excerpt: "export function paintCanvas() {}", url: "" },
  ];
  const nodes = [
    { id: "c-handler", name: "handleRequest", role: "handler", referenceId: "r-handler", evidence: ["Handles account requests"] },
    { id: "c-service", name: "loadAccount", role: "service", referenceId: "r-service", evidence: ["Loads account records"] },
    { id: "c-paint", name: "paintCanvas", role: "function", referenceId: "r-unrelated", evidence: ["Draws a canvas"] },
  ];
  const edges = [{ id: "e-call", source: "c-handler", target: "c-service", type: "calls", referenceId: "r-overlap" }];
  const insert = (table, records) => { const statement = db.prepare(`INSERT INTO ${table} VALUES (?,?,?)`); for (const row of records) statement.run(row.id, snapshotId, JSON.stringify(row)); };
  insert("source_references", refs);
  insert("components", nodes);
  insert("relationships", edges);
  db.prepare("INSERT INTO source_files VALUES (?,?,?)").run(snapshotId, "src/handler.js", "export function handleRequest() {\n  return loadAccount();\n}\n");
  db.prepare("INSERT INTO source_files VALUES (?,?,?)").run(snapshotId, "src/service.js", "export function loadAccount() {\n  return [];\n}\n");
  return { snapshotId, repository, commit, refs, nodes, edges };
}

function cleanup(id) {
  for (const table of ["components", "relationships", "source_references", "source_files", "documentation", "snapshots"]) db.prepare(`DELETE FROM ${table} WHERE ${table === "snapshots" ? "id" : "snapshot_id"}=?`).run(id);
  clearAgentContextCache();
}

test("graph adapter returns validated identity and reads stored nodes", () => {
  const f = fixture();
  try {
    const adapter = createGraphAdapter();
    assert.equal(adapter.snapshot(f.snapshotId).repository, f.repository);
    assert.equal(adapter.records("components", f.snapshotId, 2).length, 2);
    assert.throws(() => adapter.records("repositories", f.snapshotId, 2), /Unsupported/);
  } finally { cleanup(f.snapshotId); }
});

test("retrieval ranks exact symbols, returns relevant evidence, and avoids unrelated files", () => {
  const f = fixture();
  try {
    const result = inspectSymbol(f.snapshotId, "handleRequest");
    assert.equal(result.nodes[0].id, "c-handler");
    assert.equal(result.nodes[0].match, "exact");
    assert.equal(result.evidence.some((item) => item.file === "src/paint.js"), false);
    assert.equal(result.identity.commit, f.commit);
  } finally { cleanup(f.snapshotId); }
});

test("dependency traversal is bounded, typed, and deduplicated", () => {
  const f = fixture();
  try {
    const result = exploreDependencies(f.snapshotId, "handleRequest", { depth: 3, maxNodes: 2, maxEdges: 1 });
    assert.equal(result.relationships.length, 1);
    assert.equal(result.relationships[0].type, "calls");
    assert.equal(result.nodes.length, 2);
    assert.equal(new Set(result.evidence.map((ref) => `${ref.file}:${ref.startLine}:${ref.endLine}`)).size, result.evidence.length);
    assert.equal(result.evidence.find((item) => item.file === "src/handler.js").referenceIds.length, 2);
  } finally { cleanup(f.snapshotId); }
});

test("budgets preserve valid JSON, report truncation, and cache by snapshot and options", () => {
  const f = fixture();
  try {
    const options = { targetTokens: 200, maxTokens: 500, maxNodes: 10, maxEdges: 10, maxFiles: 10 };
    const first = getTaskContext(f.snapshotId, "handleRequest account request service", options);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(first)));
    assert.ok(first.tokenEstimate > 0);
    assert.ok(first.tokenEstimate <= options.maxTokens);
    assert.equal(first.truncated, true);
    assert.equal(getTaskContext(f.snapshotId, "handleRequest account request service", options).cache.hit, true);
    assert.equal(getTaskContext(f.snapshotId, "handleRequest account request service", { ...options, maxNodes: 2 }).cache.hit, false);
  } finally { cleanup(f.snapshotId); }
});

test("repositories and snapshots stay isolated; drift status is explicit", () => {
  const f = fixture();
  const other = fixture("https://github.com/example/other-context-fixture");
  try {
    assert.equal(inspectSymbol(f.snapshotId, "paintCanvas").identity.snapshotId, f.snapshotId);
    const drift = checkContextDrift(f.snapshotId, ["r-handler", "missing"]);
    assert.equal(drift.status, "stale_or_invalid_evidence");
    assert.deepEqual(drift.missingReferenceIds, ["missing"]);
    assert.equal(checkContextDrift(f.snapshotId, ["r-handler"]).status, "snapshot_consistent_live_unverified");
    assert.equal(inspectSymbol(other.snapshotId, "handleRequest").identity.repository, other.repository);
  } finally { cleanup(f.snapshotId); cleanup(other.snapshotId); }
});
