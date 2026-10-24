import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import express from "express";
process.env.DATABASE_PATH = ":memory:";
const { db } = await import("../src/storage.js");
const { clearAgentContextCache } = await import("../src/agentContextBridge.js");
const { agentContextRouter } = await import("../src/agentContextRoutes.js");

function fixture() {
  const snapshotId = randomUUID();
  const repository = `https://github.com/example/api-fixture-${snapshotId}`;
  const commit = "d".repeat(40);
  const graph = { snapshotId, repository, commit, components: [], relationships: [], references: [] };
  db.prepare("INSERT INTO snapshots VALUES (?,?,?,?)").run(snapshotId, repository, commit, JSON.stringify(graph));
  const refs = [
    { id: "r-handler", snapshotId, file: "src/handler.js", startLine: 1, endLine: 3, excerpt: "export function handleRequest() {}", url: "" },
    { id: "r-overlap", snapshotId, file: "src/handler.js", startLine: 2, endLine: 4, excerpt: "return loadAccount();", url: "" },
    { id: "r-service", snapshotId, file: "src/service.js", startLine: 1, endLine: 3, excerpt: "export function loadAccount() {}", url: "" },
  ];
  const nodes = [
    { id: "c-handler", name: "handleRequest", role: "handler", referenceId: "r-handler", evidence: ["Handles account requests"] },
    { id: "c-service", name: "loadAccount", role: "service", referenceId: "r-service", evidence: ["Loads account records"] },
  ];
  const edges = [{ id: "e-call", source: "c-handler", target: "c-service", type: "calls", referenceId: "r-overlap" }];
  const insert = (table, records) => {
    const statement = db.prepare(`INSERT INTO ${table} VALUES (?,?,?)`);
    for (const row of records) statement.run(row.id, snapshotId, JSON.stringify(row));
  };
  insert("source_references", refs);
  insert("components", nodes);
  insert("relationships", edges);
  db.prepare("INSERT INTO source_files VALUES (?,?,?)").run(snapshotId, "src/handler.js", "export function handleRequest() {\n  return loadAccount();\n}\n");
  db.prepare("INSERT INTO source_files VALUES (?,?,?)").run(snapshotId, "src/service.js", "export function loadAccount() {\n  return [];\n}\n");
  return { snapshotId, repository, commit };
}

function cleanup(snapshotId) {
  for (const table of ["components", "relationships", "source_references", "source_files", "documentation", "snapshots"])
    db.prepare(`DELETE FROM ${table} WHERE ${table === "snapshots" ? "id" : "snapshot_id"}=?`).run(snapshotId);
  clearAgentContextCache();
}

async function withServer(run) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "24kb" }));
  app.use("/api/snapshots", agentContextRouter);
  app.use((error, _req, res, _next) => {
    const invalid = error?.name === "ZodError";
    res.status(invalid ? 400 : error.status || 500).json({
      error: invalid ? "Invalid request data" : error.message,
    });
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function post(base, path, body) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("agent context API returns source-backed results for all four tools", async () => {
  const f = fixture();
  try {
    await withServer(async (base) => {
      const contextResponse = await post(base, `/api/snapshots/${f.snapshotId}/agent-context`, {
        task: "trace handleRequest into loadAccount",
        targetTokens: 800,
        maxTokens: 1200,
      });
      assert.equal(contextResponse.status, 200);
      const context = await contextResponse.json();
      assert.equal(context.identity.snapshotId, f.snapshotId);
      assert.equal(context.identity.repository, f.repository);
      assert.equal(context.nodes[0].name, "handleRequest");
      assert.equal(context.evidence[0].file, "src/handler.js");
      assert.ok(context.tokenEstimate > 0);

      const inspectedResponse = await post(base, `/api/snapshots/${f.snapshotId}/agent-context/inspect-symbol`, {
        symbol: "handleRequest",
      });
      assert.equal(inspectedResponse.status, 200);
      const inspected = await inspectedResponse.json();
      assert.equal(inspected.nodes[0].match, "exact");

      const dependenciesResponse = await post(base, `/api/snapshots/${f.snapshotId}/agent-context/explore-dependencies`, {
        symbol: "handleRequest",
        depth: 2,
        maxNodes: 2,
        maxEdges: 1,
      });
      assert.equal(dependenciesResponse.status, 200);
      const dependencies = await dependenciesResponse.json();
      assert.equal(dependencies.relationships.length, 1);
      assert.equal(dependencies.relationships[0].type, "calls");

      const referenceIds = context.evidence.flatMap((item) => item.referenceIds || [item.referenceId]);
      const driftResponse = await post(base, `/api/snapshots/${f.snapshotId}/agent-context/check-drift`, { referenceIds });
      assert.equal(driftResponse.status, 200);
      const drift = await driftResponse.json();
      assert.equal(drift.status, "snapshot_consistent_live_unverified");
      assert.deepEqual(drift.missingReferenceIds, []);

      const staleResponse = await post(base, `/api/snapshots/${f.snapshotId}/agent-context/check-drift`, {
        referenceIds: ["missing-reference"],
      });
      assert.equal(staleResponse.status, 200);
      const stale = await staleResponse.json();
      assert.equal(stale.status, "stale_or_invalid_evidence");
      assert.deepEqual(stale.missingReferenceIds, ["missing-reference"]);
    });
  } finally {
    cleanup(f.snapshotId);
  }
});

test("agent context API validates snapshots, bodies, and bounded options", async () => {
  const f = fixture();
  try {
    await withServer(async (base) => {
      const missing = await post(base, "/api/snapshots/missing/agent-context", { task: "find entry point" });
      assert.equal(missing.status, 404);
      assert.equal((await missing.json()).error, "Snapshot not found");

      const emptyTask = await post(base, `/api/snapshots/${f.snapshotId}/agent-context`, { task: "   " });
      assert.equal(emptyTask.status, 400);
      assert.equal((await emptyTask.json()).error, "Invalid request data");

      const unknownOption = await post(base, `/api/snapshots/${f.snapshotId}/agent-context`, {
        task: "find entry point",
        databasePath: "elsewhere.sqlite",
      });
      assert.equal(unknownOption.status, 400);

      const invalidBudget = await post(base, `/api/snapshots/${f.snapshotId}/agent-context`, {
        task: "find entry point",
        maxTokens: 10,
      });
      assert.equal(invalidBudget.status, 400);

      const emptySymbol = await post(base, `/api/snapshots/${f.snapshotId}/agent-context/inspect-symbol`, { symbol: "" });
      assert.equal(emptySymbol.status, 400);

      const invalidDepth = await post(base, `/api/snapshots/${f.snapshotId}/agent-context/explore-dependencies`, {
        symbol: "handleRequest",
        depth: 9,
      });
      assert.equal(invalidDepth.status, 400);

      const tooManyReferences = await post(base, `/api/snapshots/${f.snapshotId}/agent-context/check-drift`, {
        referenceIds: Array.from({ length: 101 }, (_, index) => `ref-${index}`),
      });
      assert.equal(tooManyReferences.status, 400);
    });
  } finally {
    cleanup(f.snapshotId);
  }
});
