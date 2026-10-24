import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_PATH = ":memory:";
const { db, saveSnapshot } = await import("../src/storage.js");
const { snapshotSetupPlan, comparisonSetupPlan } =
  await import("../src/setupPlans.js");
const { analyze } = await import("../src/analyzer.js");
function save(commit, variable) {
  const files = {
    "package.json": JSON.stringify({
      name: "project",
      scripts: { dev: "node index.js" },
    }),
    "index.js": `process.env.${variable};`,
  };
  const graph = analyze({
    repository: "https://github.com/example/project",
    commit: commit.repeat(40),
    files,
    exclusions: [],
  });
  saveSnapshot(graph, { snapshotId: graph.snapshotId }, "", files);
  return graph.snapshotId;
}
test("older snapshots gain pinned metadata once; source setup works without reanalysis", async () => {
  const id = save("a", "DATABASE_URL");
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests++;
    assert(String(url).includes("a".repeat(40)));
    return new Response(
      JSON.stringify({
        tree: [{ path: "package-lock.json", type: "blob", mode: "100644" }],
      }),
    );
  };
  try {
    const p = await snapshotSetupPlan(id);
    assert(p.projects[0].commands.some((c) => c.command === "npm ci"));
    assert.equal(
      (await snapshotSetupPlan(id)).environment[0].name,
      "DATABASE_URL",
    );
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("missing metadata still returns captured requirements and honest coverage warnings", async () => {
  const id = save("b", "API_KEY"),
    original = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 403 });
  try {
    const p = await snapshotSetupPlan(id);
    assert.equal(p.environment[0].name, "API_KEY");
    assert.equal(p.projects[0].manager, null);
    assert(p.warnings.some((w) => w.includes("could not be loaded")));
  } finally {
    globalThis.fetch = original;
  }
});
test("before/after requirements compare source usage even when templates were not changed", async () => {
  const before = save("c", "OLD_KEY"),
    after = save("d", "NEW_KEY");
  for (const id of [before, after])
    db.prepare("INSERT INTO snapshot_setup_metadata VALUES (?,?)").run(
      id,
      JSON.stringify({ paths: [], limited: false }),
    );
  const p = await comparisonSetupPlan({
    id: "comparison",
    beforeSnapshotId: before,
    afterSnapshotId: after,
  });
  assert.equal(p.comparisonId, "comparison");
  assert.equal(p.changes.addedEnvironment[0].name, "NEW_KEY");
  assert.equal(p.changes.removedEnvironment[0].name, "OLD_KEY");
});
