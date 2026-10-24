import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.DATABASE_PATH = ":memory:";
const { db } = await import("../src/handoffStorage.js");
const { saveSnapshot } = await import("../src/storage.js");
const { analyze } = await import("../src/analyzer.js");
test("existing authenticated handoff approvals migrate once without changing source or inventing approval timestamps", async () => {
  const owner = randomUUID(),
    reviewer = randomUUID(),
    workspace = randomUUID(),
    timestamp = "2026-10-23T10:00:00.000Z";
  for (const [id, name] of [
    [owner, "Historical maintainer"],
    [reviewer, "Historical reviewer"],
  ])
    db.prepare("INSERT INTO collaboration_users VALUES (?,?,?,?,?)").run(
      id,
      `${id}@test.example`,
      name,
      "unused-migration-fixture-hash",
      timestamp,
    );
  db.prepare("INSERT INTO collaboration_workspaces VALUES (?,?,?)").run(
    workspace,
    "Migration fixture",
    timestamp,
  );
  db.prepare("INSERT INTO collaboration_members VALUES (?,?,?)").run(
    workspace,
    owner,
    "maintainer",
  );
  db.prepare("INSERT INTO collaboration_members VALUES (?,?,?)").run(
    workspace,
    reviewer,
    "reviewer",
  );
  const files = { "src/design.ts": "export function policy(){ return 409; }" };
  const graph = analyze({
    repository: "https://github.com/example/legacy-memory",
    commit: "a".repeat(40),
    files,
  });
  saveSnapshot(graph, { snapshotId: graph.snapshotId }, "", files);
  const component = graph.components.find((c) => c.name === "policy"),
    ref = graph.references.find((r) => r.id === component.referenceId);
  db.prepare("INSERT INTO collaboration_repositories VALUES (?,?)").run(
    workspace,
    graph.repository,
  );
  function legacy(snapshotId) {
    const id = randomUUID(),
      resolution = randomUUID();
    db.prepare(
      "INSERT INTO handoff_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      workspace,
      graph.repository,
      owner,
      reviewer,
      "Historical decision",
      "Why return a conflict?",
      "",
      "",
      "",
      "RESOLVED",
      timestamp,
      timestamp,
      timestamp,
    );
    db.prepare(
      "INSERT INTO handoff_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      id,
      snapshotId,
      component.id,
      ref.id,
      ref.file,
      component.name,
      1,
      1,
      files[ref.file],
      graph.commit,
      "main",
      ref.url,
      "{}",
      null,
      timestamp,
    );
    db.prepare(
      "INSERT INTO handoff_resolutions VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      resolution,
      id,
      reviewer,
      owner,
      "Keep the conflict.",
      "Account creation has a create-only contract.",
      1,
      owner,
      timestamp,
      timestamp,
    );
    return { id, resolution };
  }
  const existing = legacy(graph.snapshotId);
  const { getMemory, memoryHistory } =
    await import("../src/engineeringMemory.js");
  const row = db
    .prepare("SELECT id FROM engineering_memory WHERE origin_resolution_id=?")
    .get(existing.resolution);
  const record = getMemory(owner, row.id);
  assert.equal(record.status, "approved");
  assert.equal(record.approvedBy, "Historical maintainer");
  assert.equal(record.approvedAt, null);
  assert.equal(
    record.content.rationale,
    "Account creation has a create-only contract.",
  );
  assert.equal(record.evidence[0].commit, graph.commit);
  assert.equal(
    memoryHistory(owner, row.id).events[0].actor,
    "Historical maintainer",
  );
  const partial = legacy("missing-old-analysis");
  await import("../src/engineeringMemory.js?verify-idempotent-migration");
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM engineering_memory WHERE origin_resolution_id=?",
      )
      .get(existing.resolution).n,
    1,
  );
  const partialRecord = getMemory(
    owner,
    db
      .prepare("SELECT id FROM engineering_memory WHERE origin_resolution_id=?")
      .get(partial.resolution).id,
  );
  assert.equal(partialRecord.evidence[0].complete, false);
  assert.equal(
    partialRecord.evidence[0].provenance,
    "immutable_handoff_selection",
  );
  assert.equal(
    db
      .prepare("SELECT source_code FROM handoff_snapshots WHERE session_id=?")
      .get(existing.id).source_code,
    files[ref.file],
  );
});
