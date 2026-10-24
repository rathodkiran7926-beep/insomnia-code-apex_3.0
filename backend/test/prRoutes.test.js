import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";

process.env.DATABASE_PATH = ":memory:";
const { db, saveSnapshot } = await import("../src/storage.js");
const { analyze } = await import("../src/analyzer.js");
const { prRoutes } = await import("../src/prRoutes.js");

// Mount the production router, retaining the server's public error contract.
const app = express();
app.use(express.json());
app.use("/api/pr", prRoutes);
app.use((error, _req, res, _next) => res.status(
  error instanceof z.ZodError || /Enter a public/.test(error.message)
    ? 400 : error.status || 500,
).json({ error: error instanceof z.ZodError ? "Invalid request data" : error.message }));
let server;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
});
after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
});

function request(path, body) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port: server.address().port,
      path: `/api/pr${path}`, method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
    }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("PR test HTTP request timed out")));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test("PR discovery rejects missing snapshots and strict invalid query combinations before network access", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Validation reached provider unexpectedly"); };
  try {
    assert.equal((await request("/pulls?snapshotId=missing")).status, 404);
    for (const query of [
      "", "?snapshotId=", "?repository=https%3A%2F%2Fgithub.com%2Fexample%2Fproject&snapshotId=x",
      "?snapshotId=x&state=merged", "?snapshotId=x&page=0", "?snapshotId=x&page=101",
      "?snapshotId=x&page=1.5", "?snapshotId=x&unknown=1", "?snapshotId=x&snapshotId=y",
      "?repository=https%3A%2F%2Fevil.example%2Fx%2Fy",
    ]) {
      const response = await request(`/pulls${query}`);
      assert.equal(response.status, 400, query);
      assert.equal(typeof response.body.error, "string");
    }
  } finally { globalThis.fetch = original; }
});

test("PR discovery resolves a stored snapshot repository and preserves closed filters, page, and fork refs", async () => {
  const files = { "main.ts": "export function value(){return 1}" };
  const graph = analyze({ files, repository: "https://github.com/example/project", commit: "c".repeat(40), exclusions: [] });
  saveSnapshot(graph, {}, "", files);
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input);
    assert.equal(url.origin, "https://api.github.com");
    if (url.pathname === "/repos/example/project") return new Response('{"private":false}');
    assert.equal(url.pathname, "/repos/example/project/pulls");
    assert.equal(url.searchParams.get("state"), "closed");
    assert.equal(url.searchParams.get("page"), "2");
    return new Response(JSON.stringify([{ number: 7, title: "Merged contribution", html_url: "https://untrusted.example/", state: "closed", draft: false, merged_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", head: { ref: "fork-feature" }, base: { ref: "main" }, user: { login: "contributor" } }]));
  };
  try {
    const response = await request(`/pulls?snapshotId=${graph.snapshotId}&state=closed&page=2`);
    assert.equal(response.status, 200);
    assert.equal(response.body.repository, "https://github.com/example/project");
    assert.equal(response.body.state, "closed");
    assert.equal(response.body.page, 2);
    assert.equal(response.body.hasMore, false);
    assert.equal(response.body.pullRequests[0].url, "https://github.com/example/project/pull/7");
    assert.equal(response.body.pullRequests[0].head, "fork-feature");
    assert.equal(response.body.pullRequests[0].merged, true);
    assert.equal(response.body.pullRequests[0].author, "contributor");
    assert(Number.isFinite(Date.parse(response.body.fetchedAt)));
  } finally { globalThis.fetch = original; }
});

test("PR analysis rejects invalid POST bodies without creating queued jobs", async () => {
  const count = db.prepare("SELECT COUNT(*) AS n FROM pr_jobs").get().n;
  for (const body of [{}, null, [], { url: 7 }, { url: "" },
    { url: "http://github.com/example/project/pull/1" },
    { url: "https://github.com/example/project/pull/0" },
    { url: "https://github.com/example/project/pull/1", extra: true },
    { url: "https://github.com/example/project/pull/1/files" },
  ]) assert.equal((await request("/analyses", body)).status, 400, JSON.stringify(body));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pr_jobs").get().n, count);
});

test("PR discovery accepts a repository URL and returns an empty default all-state page", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input);
    assert.equal(url.origin, "https://api.github.com");
    if (url.pathname === "/repos/example/project") return new Response('{"private":false}');
    assert.equal(url.pathname, "/repos/example/project/pulls");
    assert.equal(url.searchParams.get("state"), "all");
    assert.equal(url.searchParams.get("page"), "1");
    return new Response("[]");
  };
  try {
    const response = await request("/pulls?repository=https%3A%2F%2Fgithub.com%2Fexample%2Fproject");
    assert.equal(response.status, 200);
    assert.equal(response.body.repository, "https://github.com/example/project");
    assert.equal(response.body.state, "all");
    assert.equal(response.body.page, 1);
    assert.equal(response.body.hasMore, false);
    assert.deepEqual(response.body.pullRequests, []);
  } finally { globalThis.fetch = original; }
});

test("unknown PR jobs and comparisons return 404", async () => {
  assert.equal((await request("/analyses/no-such-job")).status, 404);
  assert.equal((await request("/comparisons/no-such-comparison")).status, 404);
});

async function terminalJob(id) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const response = await request(`/analyses/${id}`);
    assert.equal(response.status, 200);
    if (response.body.status !== "running") return response.body;
    await setTimeout(25);
  }
  assert.fail(`PR worker job ${id} did not finish`);
}

test("real PR workers enforce capacity, persist fork comparison sides, expose snake_case IDs, and release failures", { timeout: 25000 }, async () => {
  const fixture = new URL("./helpers/prWorkerFetch.js", import.meta.url).href;
  // Workers inherit startup flags, not runtime mutations of process.execArgv.
  // Re-run just this scenario with the preload present at process startup.
  if (!process.execArgv.includes(fixture)) {
    try {
      const result = await promisify(execFile)(process.execPath, ["--import", fixture, "--test",
        "--test-name-pattern=real PR workers", fileURLToPath(import.meta.url)], {
          timeout: 22000, env: { ...process.env, NODE_TEST_CONTEXT: undefined },
        });
      assert.match(result.stdout, /(?:pass 1|# pass 1)/, result.stdout);
    } catch (error) {
      assert.fail(`Real-worker subprocess failed:\n${error.stdout || ""}\n${error.stderr || error.message}`);
    }
    return;
  }
  const gate = join(tmpdir(), `mentor-pr-test-${randomUUID()}.gate`);
  process.env.CODEBASE_MENTOR_PR_TEST_GATE = gate;
  const pending = [];
  try {
    const started = await request("/analyses", { url: "https://github.com/example/project/pull/1" });
    assert.equal(started.status, 202);
    pending.push(started.body.id);
    assert.equal(typeof started.body.id, "string");
    const running = await request(`/analyses/${started.body.id}`);
    assert.equal(running.status, 200);
    assert.equal(running.body.status, "running");
    assert.equal(running.body.comparison_id, null);
    assert.equal("comparisonId" in running.body, false);
    assert.equal(running.body.url, "https://github.com/example/project/pull/1");
    const failedStart = await request("/analyses", { url: "https://github.com/example/project/pull/2" });
    assert.equal(failedStart.status, 202);
    pending.push(failedStart.body.id);
    const jobCount = db.prepare("SELECT COUNT(*) AS n FROM pr_jobs").get().n;
    assert.equal((await request("/analyses", { url: "https://github.com/example/project/pull/3" })).status, 429);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pr_jobs").get().n, jobCount);
    await writeFile(gate, "release");

    const [complete, failed] = await Promise.all([terminalJob(started.body.id), terminalJob(failedStart.body.id)]);
    assert.equal(complete.status, "complete", complete.message);
    assert.equal(complete.progress, 100);
    assert.equal(typeof complete.comparison_id, "string");
    assert.equal("comparisonId" in complete, false);
    assert.equal(failed.status, "failed");
    assert.match(failed.message, /403/);
    assert.equal(failed.comparison_id, null);
    assert.equal(failed.progress, 0);

    const response = await request(`/comparisons/${complete.comparison_id}`);
    assert.equal(response.status, 200);
    const result = response.body;
    assert.equal(result.id, complete.comparison_id);
    assert.equal(result.pr.baseCommit, "c".repeat(40));
    assert.equal(result.pr.targetCommit, "a".repeat(40));
    assert.equal(result.pr.headCommit, "b".repeat(40));
    assert.equal(result.pr.baseRepository, "https://github.com/example/project");
    assert.equal(result.pr.headRepository, "https://github.com/contributor/project");
    assert.notEqual(result.beforeSnapshotId, result.afterSnapshotId);
    for (const [snapshotId, commit, repository] of [
      [result.beforeSnapshotId, "c".repeat(40), "https://github.com/example/project"],
      [result.afterSnapshotId, "b".repeat(40), "https://github.com/contributor/project"],
    ]) {
      const snapshot = db.prepare("SELECT * FROM snapshots WHERE id=?").get(snapshotId);
      assert.equal(snapshot.commit_sha, commit);
      assert.equal(snapshot.repository_id, repository);
      assert.equal(JSON.parse(snapshot.graph_json).snapshotId, snapshotId);
      assert(db.prepare("SELECT content FROM source_files WHERE snapshot_id=? AND path='main.ts'").get(snapshotId));
    }
    const changed = result.components.find(component => component.after?.name === "value");
    assert.equal(changed.status, "modified");
    assert(changed.before.reference.url.includes(`/blob/${"c".repeat(40)}/main.ts`));
    assert(changed.after.reference.url.includes(`contributor/project/blob/${"b".repeat(40)}/main.ts`));
    const stored = db.prepare("SELECT * FROM pr_comparisons WHERE id=?").get(result.id);
    assert.equal(stored.base_snapshot_id, result.beforeSnapshotId);
    assert.equal(stored.head_snapshot_id, result.afterSnapshotId);
    assert.deepEqual(JSON.parse(stored.data), result);

    // Hold both retry workers too, so neither can hide a leaked capacity slot.
    await unlink(gate);
    const retry = await request("/analyses", { url: "https://github.com/example/project/pull/3" });
    assert.equal(retry.status, 202);
    pending.push(retry.body.id);
    const secondRetry = await request("/analyses", { url: "https://github.com/example/project/pull/1" });
    assert.equal(secondRetry.status, 202);
    pending.push(secondRetry.body.id);
    await writeFile(gate, "release");
    const recovered = await Promise.all([terminalJob(retry.body.id), terminalJob(secondRetry.body.id)]);
    assert.deepEqual(recovered.map(job => job.status), ["complete", "complete"]);
  } finally {
    // Release outstanding workers even if a capacity/status assertion fails.
    await writeFile(gate, "release");
    await Promise.all(pending.map(terminalJob));
    await unlink(gate);
    delete process.env.CODEBASE_MENTOR_PR_TEST_GATE;
  }
});
