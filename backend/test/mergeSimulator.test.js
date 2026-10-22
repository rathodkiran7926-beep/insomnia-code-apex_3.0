import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_PATH = ":memory:";
const { mergeText, simulateFile } = await import("../src/mergeSimulator.js");
const { db } = await import("../src/storage.js");
test("simulator applies PR changes to an unchanged target without changing inputs", async () => {
  const result = await mergeText("old\n", "old\n", "new\n");
  assert.equal(result.status, "clean");
  assert.equal(result.merged, "new\n");
});
test("Git combines independent target and PR edits", async () => {
  const base = "first\nsecond\nthird\nfourth\nfifth\nlast\n";
  const result = await mergeText(
    base,
    base.replace("first", "target first"),
    base.replace("last", "PR last"),
  );
  assert.equal(result.status, "clean");
  assert.match(result.merged, /target first/);
  assert.match(result.merged, /PR last/);
});
test("overlapping edits retain target, ancestor and PR conflict evidence", async () => {
  const result = await mergeText(
    'const mode = "old";\n',
    'const mode = "target";\n',
    'const mode = "PR";\n',
  );
  assert.equal(result.status, "conflict");
  assert.equal(result.conflicts, 1);
  for (const label of [
    "<<<<<<< Target branch",
    "||||||| Common ancestor",
    ">>>>>>> PR changes",
  ])
    assert(result.merged.includes(label));
});
test("add/add and modify/delete are explicit manual conflicts; clean deletions remain null", async () => {
  assert.equal((await mergeText(null, null, "new")).merged, "new");
  assert.equal((await mergeText("old", "old", null)).merged, null);
  assert.equal((await mergeText("old", "edited", null)).status, "conflict");
  assert.equal(
    (await mergeText(null, "target", "incoming")).status,
    "conflict",
  );
});
test("cancelled, binary, oversized, unrelated and sensitive simulation inputs are rejected", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    mergeText("a", "b", "c", controller.signal),
    (e) => e.status === 499,
  );
  await assert.rejects(mergeText("a\0", "a", "b"), /text files/);
  await assert.rejects(mergeText("a".repeat(256001), "a", "b"), /256 KB/);
  await assert.rejects(
    simulateFile({ pr: { files: [] } }, "not-in-pr.ts"),
    (e) => e.status === 404,
  );
  await assert.rejects(
    simulateFile({ pr: { files: [{ path: ".env", hidden: true }] } }, ".env"),
    (e) => e.status === 403,
  );
  await assert.rejects(
    simulateFile(
      { pr: { files: [{ path: "new.ts", previousPath: "old.ts" }] } },
      "new.ts",
    ),
    /renames/,
  );
});
test("simulation loads cached PR sources and fetches only the pinned target commit", async () => {
  db.prepare("INSERT INTO source_files VALUES (?,?,?)").run(
    "base",
    "file.ts",
    "first\nsecond\nthird\nfourth\nfifth\nlast\n",
  );
  db.prepare("INSERT INTO source_files VALUES (?,?,?)").run(
    "head",
    "file.ts",
    "first\nsecond\nthird\nfourth\nfifth\nPR last\n",
  );
  const comparison = {
    id: "compare",
    beforeSnapshotId: "base",
    afterSnapshotId: "head",
    pr: {
      baseRepository: "https://github.com/example/repo",
      headRepository: "https://github.com/fork/repo",
      baseCommit: "a".repeat(40),
      targetCommit: "b".repeat(40),
      headCommit: "c".repeat(40),
      files: [{ path: "file.ts", status: "modified" }],
    },
  };
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests++;
    assert(String(url).includes("ref=" + "b".repeat(40)));
    const text = "target first\nsecond\nthird\nfourth\nfifth\nlast\n";
    return new Response(
      JSON.stringify({
        type: "file",
        path: "file.ts",
        encoding: "base64",
        size: text.length,
        content: Buffer.from(text).toString("base64"),
      }),
    );
  };
  try {
    const result = await simulateFile(comparison, "file.ts");
    assert.equal(result.comparisonId, "compare");
    assert.equal(result.status, "clean");
    assert.equal(requests, 1);
    assert.match(result.merged, /target first/);
    assert.match(result.merged, /PR last/);
  } finally {
    globalThis.fetch = original;
  }
});
