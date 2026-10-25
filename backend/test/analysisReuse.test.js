import test, { after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { gzipSync } from "node:zlib";
import tar from "tar-stream";

process.env.DATABASE_PATH = ":memory:";
process.env.PORT = "0";
const { db, saveSnapshot } = await import("../src/storage.js");
const analyzer = await import("../src/analyzer.js");
const github = await import("../src/github.js");
const { documentGraph, markdown } = await import("../src/documentation.js");
const threads = createRequire(import.meta.url)("node:worker_threads");
const OriginalWorker = threads.Worker;
const workers = [];
let failConstruction = false;
class FakeWorker extends EventEmitter {
  constructor(_url, options) {
    super();
    if (failConstruction) { failConstruction = false; throw new Error("Worker construction failed"); }
    this.data = structuredClone(options.workerData); workers.push(this);
  }
  async terminate() { this.terminated = true; return 0; }
}
threads.Worker = FakeWorker;
syncBuiltinESMExports();
const originalFetch = globalThis.fetch;
const originalTimeout = globalThis.setTimeout;
const timers = [];
globalThis.setTimeout = (callback, ms, ...args) => {
  const timer = originalTimeout(callback, ms, ...args);
  if (ms > 240000 && ms <= 300000) timers.push({ callback, timer });
  return timer;
};
const heads = new Map();
let remoteFailure = false;
let privateRepository = false;
const remoteCalls = [];
globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  if (url.hostname === "127.0.0.1") return originalFetch(input, options);
  remoteCalls.push(url.href);
  assert.equal(url.origin, "https://api.github.com", "tests must never contact a real provider");
  if (remoteFailure) return new Response('{"message":"remote unavailable"}', { status: 403 });
  const match = /^\/repos\/([^/]+\/[^/]+)(?:\/commits\/([^/]+))?$/.exec(url.pathname);
  assert(match, url.href);
  const commit = match[2];
  return new Response(JSON.stringify(commit
    ? { sha: /^[a-f0-9]{40}$/.test(commit) ? commit : heads.get(match[1]) || "a".repeat(40) }
    : { private: privateRepository, default_branch: "main", full_name: match[1] }));
};
const { server } = await import("../src/server.js");
if (server && !server.listening) await once(server, "listening");
after(async () => {
  for (const { timer } of timers) clearTimeout(timer);
  if (server) await new Promise((resolve) => server.close(resolve));
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalTimeout;
  threads.Worker = OriginalWorker;
  syncBuiltinESMExports();
  db.close();
});
async function request(route, body) {
  assert(server, "server exports its listener for scoped route testing");
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`, {
    method: body ? "POST" : "GET",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
const start = (repository, revision) => request("analyses", {
  url: `https://github.com/example/${repository}`, ...(revision ? { revision } : {}),
});
const job = (id) => request(`analyses/${id}`);
async function completed(worker, { incomplete = false, rich = false } = {}) {
  const resolved = worker.data.resolved || {
    repository: worker.data.url, commit: heads.get(worker.data.url.replace("https://github.com/", "")) || "a".repeat(40),
    branch: "main", revision: "main",
  };
  const files = { "main.ts": "export function value(): number { return 1; }\n", "tsconfig.json": "{}" };
  const graph = analyzer.analyze({ ...resolved, files, exclusions: [] });
  const docs = await documentGraph(graph, { generateAI: false });
  if (rich) docs.ai = { status: "available", message: "Validated commentary", explanations: [{
    componentId: graph.components[1].id, explanation: "Returns a numeric value.",
    referenceIds: [graph.components[1].referenceId], inferred: true,
  }] };
  const payload = { type: "complete", graph, docs, files, markdown: markdown(graph, docs),
    setupMetadata: { paths: [], limited: false },
    analysis: { analyzerVersion: analyzer.ANALYZER_VERSION || "1", extractionPolicy: github.EXTRACTION_POLICY_VERSION || "1", complete: !incomplete },
  };
  worker.emit("message", payload);
  return payload;
}

test("same verified commit reuses a complete snapshot with existing 202 and polling schema", async () => {
  const initial = workers.length;
  const cold = await start("reuse");
  assert.equal(cold.status, 202);
  assert.deepEqual(Object.keys(cold.body), ["id"]);
  const worker = workers.at(-1);
  worker.emit("message", { type: "progress", progress: 60, message: "Parsing" });
  assert.equal((await job(cold.body.id)).body.progress, 60);
  const payload = await completed(worker, { rich: true });
  const calls = remoteCalls.length;
  const warm = await start("reuse");
  assert.equal(warm.status, 202);
  assert.equal(workers.length - initial, 1, "warm request must not start another worker");
  assert.equal(remoteCalls.length - calls, 2, "even cache hits must recheck public metadata and remote branch SHA");
  const polled = await job(warm.body.id);
  assert.equal(polled.status, 200);
  assert.equal(polled.body.status, "complete");
  assert.equal(polled.body.progress, 100);
  assert.equal(polled.body.snapshot_id, payload.graph.snapshotId);
  assert.deepEqual(Object.keys(polled.body).sort(), ["id", "status", "progress", "message", "snapshot_id", "created_at"].sort());
  assert.equal((await request(`snapshots/${polled.body.snapshot_id}`)).body.documentation.ai.status, "available");
  assert.equal((await job("unknown")).status, 404);
});

test("moving refs, repositories, legacy versions, policy versions and missing source cannot reuse", async () => {
  for (const defect of ["branch", "repository", "legacy", "analyzer", "policy", "manifest-files", "source", "documentation", "setup", "graph-table"]) {
    const repository = `invalidate-${defect}`;
    const cold = await start(repository);
    assert.equal(cold.status, 202);
    const payload = await completed(workers.at(-1));
    if (defect === "branch") heads.set(`example/${repository}`, "b".repeat(40));
    if (defect === "legacy") db.prepare("DELETE FROM analysis_snapshot_manifests WHERE snapshot_id=?").run(payload.graph.snapshotId);
    if (["analyzer", "policy", "manifest-files"].includes(defect)) {
      const row = db.prepare("SELECT data FROM analysis_snapshot_manifests WHERE snapshot_id=?").get(payload.graph.snapshotId);
      const manifest = JSON.parse(row.data);
      if (defect === "manifest-files") manifest.files.pop();
      else manifest[defect === "analyzer" ? "analyzerVersion" : "extractionPolicy"] = "old";
      db.prepare("UPDATE analysis_snapshot_manifests SET data=? WHERE snapshot_id=?").run(JSON.stringify(manifest), payload.graph.snapshotId);
    }
    if (defect === "source") db.prepare("DELETE FROM source_files WHERE snapshot_id=? AND path='main.ts'").run(payload.graph.snapshotId);
    if (defect === "documentation") db.prepare("DELETE FROM documentation WHERE snapshot_id=?").run(payload.graph.snapshotId);
    if (defect === "setup") db.prepare("DELETE FROM snapshot_setup_metadata WHERE snapshot_id=?").run(payload.graph.snapshotId);
    if (defect === "graph-table") db.prepare("DELETE FROM source_references WHERE snapshot_id=?").run(payload.graph.snapshotId);
    const count = workers.length;
    const next = await start(defect === "repository" ? `${repository}-other` : repository);
    assert.equal(next.status, 202, defect);
    assert.equal(workers.length - count, 1, `${defect} must start fresh analysis`);
    const regenerated = await completed(workers.at(-1));
    assert.equal((await job(next.body.id)).body.status, "complete");
    if (defect === "branch" || defect === "repository") assert.notEqual(regenerated.graph.snapshotId, payload.graph.snapshotId);
  }
});

test("concurrent verified identities coalesce and do not consume another worker slot", async () => {
  const count = workers.length;
  const [first, second] = await Promise.all([start("concurrent", "feature"), start("concurrent", "main")]);
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(first.body.id, second.body.id);
  assert.equal(workers.length - count, 1);
  const firstWorker = workers.at(-1);
  const other = await start("concurrent-other");
  assert.equal(other.status, 202);
  const otherWorker = workers.at(-1);
  assert.equal((await start("concurrent")).status, 202, "same identity can join even at capacity");
  assert.equal((await start("over-capacity")).status, 429);
  await completed(firstWorker);
  await completed(otherWorker);
});

test("remote failures, private repositories and invalid SHAs never return cached data", async () => {
  const cold = await start("freshness");
  assert.equal(cold.status, 202);
  await completed(workers.at(-1));
  const count = workers.length;
  for (const failure of ["remote", "private", "sha"]) {
    remoteFailure = failure === "remote";
    privateRepository = failure === "private";
    if (failure === "sha") heads.set("example/freshness", "not-a-sha");
    try {
      const response = await start("freshness");
      assert.equal(response.status, 202);
      assert.equal((await job(response.body.id)).body.status, "failed", failure);
      assert.equal((await job(response.body.id)).body.snapshot_id, null);
    } finally { remoteFailure = false; privateRepository = false; heads.delete("example/freshness"); }
  }
  assert.equal(workers.length, count);
});

test("incomplete, failed, exited and timed-out analyses release identity and capacity for retries", async () => {
  for (const failure of ["incomplete", "failed", "error", "exit", "timeout", "mismatch"]) {
    const repository = `retry-${failure}`;
    const response = await start(repository);
    assert.equal(response.status, 202);
    const worker = workers.at(-1);
    if (failure === "incomplete") await completed(worker, { incomplete: true });
    if (failure === "failed") worker.emit("message", { type: "failed", message: "simulated failure" });
    if (failure === "mismatch") {
      worker.data.resolved.commit = "b".repeat(40);
      await completed(worker);
    }
    if (failure === "error") worker.emit("error", new Error("simulated error"));
    if (failure === "exit") worker.emit("exit", 0);
    if (failure === "timeout") timers.at(-1).callback();
    assert.equal((await job(response.body.id)).body.status, failure === "incomplete" ? "complete" : "failed");
    const count = workers.length;
    const retry = await start(repository);
    assert.equal(retry.status, 202);
    assert.equal(workers.length - count, 1, failure);
    await completed(workers.at(-1));
    assert.equal((await job(retry.body.id)).body.status, "complete");
    // Late messages from a finished worker must not mutate the stored job.
    worker.emit("message", { type: "progress", progress: 2, message: "late" });
    assert.equal((await job(response.body.id)).body.status, failure === "incomplete" ? "complete" : "failed");
  }
  failConstruction = true;
  assert.equal((await start("retry-constructor")).status, 500);
  const retry = await start("retry-constructor");
  assert.equal(retry.status, 202);
  await completed(workers.at(-1));
  assert.equal((await job(retry.body.id)).body.status, "complete");
});

test("source-only and PR saves preserve validated documentation, source, metadata and guides", async () => {
  const response = await start("enrichment");
  assert.equal(response.status, 202);
  const payload = await completed(workers.at(-1), { rich: true });
  const snapshotId = payload.graph.snapshotId;
  db.prepare("INSERT INTO generated_guides VALUES (?,?,?)").run(snapshotId, "existing", '{"preserved":true}');
  const original = db.prepare("SELECT * FROM documentation WHERE snapshot_id=?").get(snapshotId);
  saveSnapshot(payload.graph, {}, "", {});
  assert.deepEqual(db.prepare("SELECT * FROM documentation WHERE snapshot_id=?").get(snapshotId), original);
  const prGraph = { ...payload.graph, branch: null, revision: payload.graph.commit };
  const docs = await documentGraph(prGraph, { generateAI: false });
  saveSnapshot(prGraph, docs, markdown(prGraph, docs), payload.files, payload.setupMetadata);
  assert.deepEqual(db.prepare("SELECT * FROM documentation WHERE snapshot_id=?").get(snapshotId), original);
  assert.equal(db.prepare("SELECT content FROM source_files WHERE snapshot_id=? AND path='main.ts'").get(snapshotId).content, payload.files["main.ts"]);
  assert.equal(db.prepare("SELECT data FROM generated_guides WHERE snapshot_id=?").get(snapshotId).data, '{"preserved":true}');
  const count = workers.length;
  assert.equal((await start("enrichment")).status, 202);
  assert.equal(workers.length, count);
  const refreshed = structuredClone(payload.docs);
  refreshed.ai.explanations[0].explanation = "Returns a declared numeric result from the selected function.";
  saveSnapshot(payload.graph, refreshed, markdown(payload.graph, refreshed), payload.files, payload.setupMetadata, payload.analysis);
  assert.deepEqual(JSON.parse(db.prepare("SELECT data FROM documentation WHERE snapshot_id=?").get(snapshotId).data), refreshed,
    "a fresh full analysis can replace commentary with a validated generated result");
  const incompatible = structuredClone(payload.graph);
  incompatible.references[1].excerpt = "a different declaration at the same reference ID";
  const stored = db.prepare("SELECT graph_json FROM snapshots WHERE id=?").get(snapshotId).graph_json;
  assert.throws(() => saveSnapshot(incompatible, {}, "", payload.files, payload.setupMetadata, payload.analysis), /migration/i);
  assert.equal(db.prepare("SELECT graph_json FROM snapshots WHERE id=?").get(snapshotId).graph_json, stored);
  const shifted = structuredClone(payload.graph);
  shifted.references[1].startOffset++;
  assert.throws(() => saveSnapshot(shifted, {}, "", payload.files, payload.setupMetadata, payload.analysis), /migration/i);
});

test("complete analysis retains captured files without graph references for durable reuse", async () => {
  const repository = "https://github.com/example/captured-files";
  const files = { "main.ts": "export const value = 1;", "extra.TS": "export const other = 2;" };
  const graph = analyzer.analyze({ repository, commit: "a".repeat(40), branch: "main", revision: "main", files, exclusions: [] });
  assert.equal(graph.references.some((ref) => ref.file === "extra.TS"), false);
  const docs = await documentGraph(graph, { generateAI: false });
  saveSnapshot(graph, docs, markdown(graph, docs), files, { paths: [], limited: false }, {
    analyzerVersion: analyzer.ANALYZER_VERSION, extractionPolicy: github.EXTRACTION_POLICY_VERSION, complete: true,
  });
  const count = workers.length;
  const response = await start("captured-files");
  assert.equal(response.status, 202);
  assert.equal(workers.length, count, "a complete captured source set must remain reusable");
  assert.equal((await job(response.body.id)).body.snapshot_id, graph.snapshotId);
  assert.equal(db.prepare("SELECT content FROM source_files WHERE snapshot_id=? AND path=?").get(graph.snapshotId, "extra.TS").content, files["extra.TS"]);
});

test("download uses the verified SHA without resolving a moving ref again, retaining auth and extraction limits", async () => {
  const fakeFetch = globalThis.fetch;
  const token = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-github-token";
  const sha = "d".repeat(40);
  const requests = [];
  let oversized = false;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    requests.push(url.href);
    assert.equal(options.redirect, "manual");
    if (url.origin === "https://api.github.com") {
      assert.equal(options.headers.Authorization, "Bearer test-github-token");
      if (url.pathname === "/repos/example/pinned") return new Response('{"private":false,"default_branch":"main"}');
      if (url.pathname === "/repos/example/pinned/commits/main") return new Response(JSON.stringify({ sha }));
      assert.equal(url.pathname, `/repos/example/pinned/git/trees/${sha}`);
      return new Response(JSON.stringify({ truncated: false, tree: [{ path: "main.ts", type: "blob", mode: "100644", size: oversized ? 300000 : 30 }] }));
    }
    assert.equal(url.href, `https://codeload.github.com/example/pinned/tar.gz/${sha}`);
    const pack = tar.pack();
    const chunks = [];
    const collected = (async () => { for await (const chunk of pack) chunks.push(chunk); })();
    pack.entry({ name: "fixture/main.ts", type: "file" }, "export const value = 1;");
    pack.finalize();
    await collected;
    return new Response(gzipSync(Buffer.concat(chunks)));
  };
  try {
    const pinned = await github.resolveRepository("https://github.com/example/pinned");
    const input = await github.downloadRepository(pinned.repository, undefined, () => {}, pinned);
    assert.equal(input.commit, sha);
    assert.equal(input.complete, true);
    assert.equal(input.files["main.ts"], "export const value = 1;");
    assert.equal(requests.filter((url) => url.includes("/commits/")).length, 1);
    oversized = true;
    const limited = await github.downloadRepository(pinned.repository, undefined, () => {}, pinned);
    assert.equal(limited.complete, false);
    assert.deepEqual(limited.files, {});
  } finally {
    globalThis.fetch = fakeFetch;
    if (token === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = token;
  }
});
