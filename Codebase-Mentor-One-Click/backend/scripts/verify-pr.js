// Read-only live GitHub verification. Uses an isolated local DB; never executes analyzed code.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(root + "/data", { recursive: true });
const server = spawn(
  process.execPath,
  ["--env-file-if-exists=.env", "src/server.js"],
  {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: "3006",
      DATABASE_PATH: root + "/data/pr-verification.sqlite",
    },
    stdio: "ignore",
  },
);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, body) => {
  const response = await fetch(
    "http://127.0.0.1:3006/api" + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const value = await response.json();
  if (!response.ok) throw new Error(value.error);
  return value;
};
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      await api("/health");
      ready = true;
      break;
    } catch {
      await pause(100);
    }
  }
  assert(ready, "Verification server must start");
  await assert.rejects(
    api("/pr/analyses", { url: "https://example.com/x" }),
    /GitHub PR URL/,
  );
  const url =
    process.env.VERIFY_PR_URL ||
    "https://github.com/heroku/nodejs-getting-started/pull/419";
  const { id } = await api("/pr/analyses", { url });
  let job;
  for (let i = 0; i < 180; i++) {
    job = await api("/pr/analyses/" + id);
    if (job.status === "failed") throw new Error(job.message);
    if (job.status === "complete") break;
    await pause(1000);
  }
  assert.equal(job.status, "complete");
  assert.equal(
    job.url,
    url,
    "Job should retain the original URL for restart recovery",
  );
  const result = await api("/pr/comparisons/" + job.comparison_id);
  assert(result.pr.files.length > 0, "Real changed files required");
  assert.notEqual(result.pr.baseCommit, result.pr.headCommit);
  const before = await api("/snapshots/" + result.beforeSnapshotId),
    after = await api("/snapshots/" + result.afterSnapshotId);
  assert.equal(before.commit, result.pr.baseCommit);
  const discovered = await api(
    `/pr/pulls?snapshotId=${before.snapshotId}&state=closed&page=1`,
  );
  assert(
    discovered.pullRequests.some((p) => p.number === result.pr.number),
    "Analyzed repository should list the real verification PR",
  );
  assert.equal(after.commit, result.pr.headCommit);
  assert(
    result.setup.dependencies.length > 0,
    "Verification PR should change a package dependency",
  );
  const ref = after.references[0];
  const source = await api(
    `/snapshots/${after.snapshotId}/source?referenceId=${ref.id}`,
  );
  assert(source.complete && source.url.includes(after.commit));
  const session = await api("/discussions", {
    snapshotId: after.snapshotId,
    componentId: after.components[0].id,
  });
  assert.equal(session.snapshotId, after.snapshotId);
  const report = {
    jobId: id,
    comparisonId: result.id,
    pr: result.pr.url,
    before: before.commit,
    after: after.commit,
    files: result.pr.files.length,
    dependencyChanges: result.setup.dependencies.length,
    sourceVerified: true,
    discussionBound: true,
  };
  writeFileSync(
    root + "/data/pr-verification.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.kill();
}
