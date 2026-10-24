import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL("../", import.meta.url));
const child = spawn(process.execPath, ["src/server.js"], {
  cwd,
  env: {
    ...process.env,
    PORT: "3002",
    DATABASE_PATH: cwd + "/data/http-verification.sqlite",
  },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
});
child.stderr.on("data", (chunk) => {
  output += chunk;
});
const base = "http://127.0.0.1:3002";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  for (let i = 0; !output.includes("Codebase Mentor API:") && i < 100; i++) {
    if (child.exitCode !== null) throw new Error(output);
    await pause(50);
  }
  assert(output.includes("Codebase Mentor API:"), "HTTP server did not start");
  const post = (body) =>
    fetch(`${base}/api/analyses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await post({ url: "http://localhost/private" })).status, 400);
  const response = await post({
    url: "https://github.com/heroku/node-js-getting-started",
  });
  assert.equal(response.status, 202);
  const { id } = await response.json();
  let job;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    job = await (await fetch(`${base}/api/analyses/${id}`)).json();
    if (job.status !== "running") break;
    await pause(300);
  }
  assert.equal(job.status, "complete", job.message);
  assert.equal(job.progress, 100);
  const graph = await (
    await fetch(`${base}/api/snapshots/${job.snapshot_id}`)
  ).json();
  assert.equal(graph.documentation.snapshotId, graph.snapshotId);
  assert(graph.report.supported);
  assert(graph.relationships.some((e) => e.type === "handles_route"));
  const exported = await fetch(
    `${base}/api/snapshots/${graph.snapshotId}/documentation?download=1`,
  );
  assert.match(exported.headers.get("content-disposition"), /attachment/);
  const md = await exported.text();
  assert(md.includes(graph.commit));
  assert(md.includes(graph.snapshotId));
  assert(md.includes("```mermaid"));
  console.log(
    JSON.stringify(
      {
        status: job.status,
        commit: graph.commit,
        snapshotId: graph.snapshotId,
        routes: graph.components.filter((c) => c.role === "route").length,
        checks: [
          "HTTP 202 job",
          "background worker completion",
          "SQLite snapshot",
          "shared graph/documentation snapshot",
          "commit links",
          "Markdown attachment",
          "invalid URL rejected",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  child.kill();
  if (child.exitCode === null) await once(child, "exit");
}
