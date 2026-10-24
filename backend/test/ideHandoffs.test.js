import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
process.env.DATABASE_PATH = ":memory:";
const { db, saveSnapshot } = await import("../src/storage.js");
const { analyze } = await import("../src/analyzer.js");
const graph = analyze({
  repository: "https://github.com/owner/repo",
  commit: "a".repeat(40),
  files: {
    "main.ts":
      "export function value(){return 1}\nexport function caller(){return value()}\n",
  },
});
saveSnapshot(graph, { snapshotId: graph.snapshotId }, "", {
  "main.ts":
    "export function value(){return 1}\nexport function caller(){return value()}\n",
});
let server, base;
test.before(async () => {
  const { default: express } = await import("express");
  const { z } = await import("zod");
  const { ideRoutes } = await import("../src/ideRoutes.js");
  const app = express();
  app.use(express.json({ limit: "24kb" }));
  app.use("/api/ide", ideRoutes);
  app.use((e, q, r, n) =>
    r
      .status(e instanceof z.ZodError ? 400 : e.status || 500)
      .json({ error: "Request failed" }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/ide/handoffs`;
});
test.after(() => {
  server.closeAllConnections();
  server.close();
  db.close();
});
const input = () => ({
  snapshotId: graph.snapshotId,
  componentId: graph.components[0].id,
  sourceReferenceIds: [graph.components[0].referenceId],
  question: "  Why?\n",
  attemptedSteps: "traced",
  additionalContext: "",
  origin: { type: "editor" },
});
const send = (path = "", method = "GET", body, headers = {}) =>
  fetch(base + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const preview = async (i = input(), selection) => {
  const r = await send("/preview", "POST", {
    input: i,
    ...(selection ? { selection } : {}),
  });
  assert.equal(r.status, 200);
  return r.json();
};
const create = async (p) => {
  const r = await send("", "POST", {
    requestId: randomUUID(),
    input: p.input,
    selection: p.selection,
    digest: p.digest,
  });
  assert.equal(r.status, 201);
  return r.json();
};
test("handoffs default disabled independently of checkpoints and reject unsafe requests", async () => {
  delete process.env.CODEBASE_MENTOR_LOCAL_HANDOFFS;
  process.env.CODEBASE_MENTOR_LOCAL_CHECKPOINTS = "1";
  const capability = await send("/capabilities");
  assert.equal(capability.status, 200);
  assert.equal((await capability.json()).enabled, false);
  assert.equal(
    (await send("/preview", "POST", { input: input() })).status,
    403,
  );
  process.env.CODEBASE_MENTOR_LOCAL_HANDOFFS = "1";
  for (const headers of [
    { Origin: "https://attacker.example" },
    { Forwarded: "for=127.0.0.1" },
    { "X-Forwarded-Host": "localhost" },
    { "sec-fetch-site": "cross-site" },
  ])
    assert.equal(
      (await send("", "GET", undefined, headers)).status,
      403,
      JSON.stringify(headers),
    );
});
test("preview builds deterministic bounded source evidence without excerpts and saves exact approved Markdown", async () => {
  const p = await (await send("/preview", "POST", { input: input() })).json();
  assert.equal(p.context.repositoryIdentity, "https://github.com/owner/repo");
  assert.equal(p.context.question, input().question);
  assert.equal(p.context.excerpts.length, 0);
  assert.equal(p.selection.includeDocumentation, false);
  assert.equal(p.digest.length, 64);
  assert.deepEqual(
    p,
    await (await send("/preview", "POST", { input: input() })).json(),
  );
  const body = {
    requestId: randomUUID(),
    input: p.input,
    selection: p.selection,
    digest: p.digest,
  };
  const r = await send("", "POST", body);
  assert.equal(r.status, 201);
  const s = await r.json();
  assert.equal(s.markdown, p.markdown);
  assert.deepEqual(s.context, p.context);
  const again = await send("", "POST", body);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).id, s.id);
  assert.equal(
    (await send("", "POST", { ...body, digest: "0".repeat(64) })).status,
    409,
  );
  const q = `?snapshotId=${graph.snapshotId}`;
  assert.deepEqual(await (await send(`/${s.id}/export${q}`)).json(), {
    id: s.id,
    markdown: p.markdown,
    digest: p.digest,
  });
  assert.equal((await (await send(q)).json()).items[0].id, s.id);
  assert.equal((await send(`/${s.id}${q}`, "DELETE")).status, 200);
  assert.equal((await send(`/${s.id}${q}`)).status, 404);
});

test("safe gate rejects rebinding and every saved data operation while disabled", async () => {
  const status = await new Promise((resolve, reject) => {
    const q = request(base, { headers: { Host: "attacker.example" } }, (r) => {
      r.resume();
      resolve(r.statusCode);
    });
    q.on("error", reject);
    q.end();
  });
  assert.equal(status, 403);
  const s = await create(await preview());
  delete process.env.CODEBASE_MENTOR_LOCAL_HANDOFFS;
  for (const [path, method] of [
    [`?snapshotId=${graph.snapshotId}`, "GET"],
    [`/${s.id}?snapshotId=${graph.snapshotId}`, "GET"],
    [`/${s.id}/export?snapshotId=${graph.snapshotId}`, "GET"],
    [`/${s.id}?snapshotId=${graph.snapshotId}`, "DELETE"],
  ])
    assert.equal((await send(path, method)).status, 403);
  process.env.CODEBASE_MENTOR_LOCAL_HANDOFFS = "1";
});

test("strict input bounds, unavailable snapshots/components and forged references fail closed", async () => {
  for (const changes of [
    { question: " " },
    { question: "x".repeat(1501) },
    { attemptedSteps: "x".repeat(2001) },
    { additionalContext: "x".repeat(2001) },
    { sourceReferenceIds: Array.from({ length: 17 }, (_, i) => String(i)) },
    { sourceReferenceIds: ["foreign-only"] },
    { repositoryIdentity: "forged" },
    { snapshotId: "../secret" },
    { origin: { type: "editor", checkpointId: randomUUID() } },
    { origin: { type: "pr" } },
  ])
    assert.equal(
      (await send("/preview", "POST", { input: { ...input(), ...changes } }))
        .status,
      400,
    );
  for (const changes of [{ snapshotId: "missing" }, { componentId: "missing" }])
    assert.equal(
      (await send("/preview", "POST", { input: { ...input(), ...changes } }))
        .status,
      404,
    );
  assert.equal(
    (await send("/preview", "POST", { input: input(), forged: true })).status,
    400,
  );
});

test("redaction removes all evidence and excerpt inclusion is explicit, bounded, and safe Markdown", async () => {
  const p = await preview();
  const empty = {
    referenceIds: [],
    relationshipIds: [],
    excerptReferenceIds: [],
    includeDocumentation: false,
    includeCheckpointNotes: false,
  };
  const redacted = await preview(input(), empty);
  assert.equal(redacted.context.references.length, 0);
  assert.equal(redacted.context.components.length, 0);
  assert.equal(redacted.context.relationships.length, 0);
  assert.equal(redacted.context.component, undefined);
  const id = p.selection.referenceIds[0];
  db.prepare(
    "UPDATE source_files SET content=? WHERE snapshot_id=? AND path=?",
  ).run(
    "``` password=sourceexample\n<script>alert(1)</script>\npassword=example\n",
    graph.snapshotId,
    p.candidates.references.find((r) => r.id === id).file,
  );
  const explicit = await preview(
    {
      ...input(),
      question: "<script>[x](javascript:evil)</script>",
    },
    { ...p.selection, excerptReferenceIds: [id] },
  );
  assert.equal(explicit.context.excerpts.length, 1);
  assert(
    explicit.context.excerpts[0].endLine -
      explicit.context.excerpts[0].startLine <
      20,
  );
  assert(explicit.context.warnings.length);
  assert(!explicit.markdown.includes("<script>[x]"));
  assert(explicit.markdown.includes("````text"));
  const s = await create(explicit);
  assert.equal(s.markdown, explicit.markdown);
  assert.equal(
    (
      await send("/preview", "POST", {
        input: input(),
        selection: { ...empty, excerptReferenceIds: [id] },
      })
    ).status,
    400,
  );
});

test("unavailable stored excerpts are honest and selected edges require endpoint reference coverage", async () => {
  const p = await preview();
  for (const edge of p.candidates.relationships) {
    const component = p.candidates.components.find((c) => c.id === edge.target);
    const bad = {
      ...p.selection,
      referenceIds: p.selection.referenceIds.filter(
        (id) => id !== component.referenceId,
      ),
      relationshipIds: [edge.id],
    };
    assert.equal(
      (await send("/preview", "POST", { input: input(), selection: bad }))
        .status,
      400,
    );
  }
  db.prepare("DELETE FROM source_files WHERE snapshot_id=?").run(
    graph.snapshotId,
  );
  const missing = await preview(input(), {
    ...p.selection,
    excerptReferenceIds: [p.selection.referenceIds[0]],
  });
  assert.equal(missing.context.excerpts.length, 0);
  assert(missing.context.limitations.some((s) => s.includes("unavailable")));
});

test("unsafe persisted immutable citation coordinates and sensitive paths never become candidates", async () => {
  const ref = graph.references.find(
    (r) => r.id === input().sourceReferenceIds[0],
  );
  try {
    for (const changes of [
      { file: "../secret" },
      {
        file: ".env",
        url: `https://github.com/owner/repo/blob/${graph.commit}/.env#L${ref.startLine}-L${ref.endLine}`,
      },
      { url: "https://attacker.example/a" },
      { url: ref.url.replace("#", "?download=1#") },
      { snapshotId: "other" },
    ]) {
      db.prepare(
        "UPDATE source_references SET data=? WHERE snapshot_id=? AND id=?",
      ).run(JSON.stringify({ ...ref, ...changes }), graph.snapshotId, ref.id);
      assert.equal(
        (await send("/preview", "POST", { input: input() })).status,
        400,
      );
    }
  } finally {
    db.prepare(
      "UPDATE source_references SET data=? WHERE snapshot_id=? AND id=?",
    ).run(JSON.stringify(ref), graph.snapshotId, ref.id);
  }
});

test("preview drift fails save and concurrent request retries persist one immutable row", async () => {
  const p = await preview();
  const changed = { ...p.input, question: "changed" };
  assert.equal(
    (
      await send("", "POST", {
        requestId: randomUUID(),
        input: changed,
        selection: p.selection,
        digest: p.digest,
      })
    ).status,
    409,
  );
  const body = {
    requestId: randomUUID(),
    input: p.input,
    selection: p.selection,
    digest: p.digest,
  };
  const responses = await Promise.all(
    Array.from({ length: 6 }, () => send("", "POST", body)),
  );
  assert.equal(responses.filter((r) => r.status === 201).length, 1);
  const ids = await Promise.all(
    responses.map(async (r) => (await r.json()).id),
  );
  assert.equal(new Set(ids).size, 1);
  assert.equal(
    db
      .prepare("SELECT count(*) AS n FROM context_handoffs WHERE request_id=?")
      .get(body.requestId).n,
    1,
  );
});

test("checkpoint origin uses only saved approved references and notes require explicit opt in", async () => {
  const { createCheckpoint } = await import("../src/checkpoints.js");
  const checkpoint = createCheckpoint(db, {
    requestId: randomUUID(),
    snapshotId: graph.snapshotId,
    taskTitle: "investigate",
    notes: { discovery: "private discovery", unresolved: "?", nextStep: "" },
    localContext: { gitStatus: "unknown" },
    sourceReferenceIds: input().sourceReferenceIds,
  }).detail.checkpoint;
  const i = {
    ...input(),
    origin: { type: "checkpoint", checkpointId: checkpoint.id },
  };
  const p = await preview(i);
  assert.equal(p.context.checkpointNotes, undefined);
  assert(
    p.candidates.references.every((r) =>
      checkpoint.sourceReferenceIds.includes(r.id),
    ),
  );
  const included = await preview(i, {
    ...p.selection,
    includeCheckpointNotes: true,
  });
  assert.deepEqual(included.context.checkpointNotes, checkpoint.notes);
  assert(included.markdown.includes("private discovery"));
  assert.equal(
    (
      await send("/preview", "POST", {
        input: {
          ...i,
          origin: { type: "checkpoint", checkpointId: randomUUID() },
        },
      })
    ).status,
    404,
  );
});

test("PR origin validates exact stored comparison side and fork repository identity", async () => {
  const fork = analyze({
    repository: "https://github.com/fork/repo",
    commit: "b".repeat(40),
    files: { "main.ts": "export function value(){return 2}" },
  });
  saveSnapshot(fork, { snapshotId: fork.snapshotId }, "");
  db.exec(
    "CREATE TABLE IF NOT EXISTS pr_comparisons(id TEXT PRIMARY KEY,base_snapshot_id TEXT NOT NULL,head_snapshot_id TEXT NOT NULL,data TEXT NOT NULL)",
  );
  const id = randomUUID(),
    c = {
      id,
      beforeSnapshotId: graph.snapshotId,
      afterSnapshotId: fork.snapshotId,
      pr: {
        url: "https://github.com/owner/repo/pull/7",
        baseRepository: graph.repository,
        headRepository: fork.repository,
        baseCommit: graph.commit,
        headCommit: fork.commit,
      },
    };
  db.prepare("INSERT INTO pr_comparisons VALUES (?,?,?,?)").run(
    id,
    graph.snapshotId,
    fork.snapshotId,
    JSON.stringify(c),
  );
  await preview({
    ...input(),
    origin: { type: "pr", comparisonId: id, comparisonSide: "before" },
  });
  const after = {
    snapshotId: fork.snapshotId,
    componentId: fork.components[0].id,
    sourceReferenceIds: [fork.components[0].referenceId],
    question: "fork?",
    attemptedSteps: "",
    additionalContext: "",
    origin: { type: "pr", comparisonId: id, comparisonSide: "after" },
  };
  assert.equal(
    (await preview(after)).context.repositoryIdentity,
    "https://github.com/fork/repo",
  );
  assert.equal(
    (
      await send("/preview", "POST", {
        input: {
          ...after,
          origin: { ...after.origin, comparisonSide: "before" },
        },
      })
    ).status,
    400,
  );
  const saved = await create(await preview());
  for (const [path, method] of [
    [`/${saved.id}`, "GET"],
    [`/${saved.id}/export`, "GET"],
    [`/${saved.id}`, "DELETE"],
  ])
    assert.equal(
      (await send(`${path}?snapshotId=${fork.snapshotId}`, method)).status,
      409,
    );
  db.prepare("UPDATE pr_comparisons SET data=? WHERE id=?").run(
    JSON.stringify({ ...c, pr: { ...c.pr, headCommit: graph.commit } }),
    id,
  );
  assert.equal((await send("/preview", "POST", { input: after })).status, 400);
});

test("SQLite rollback preserves saved handoffs after failed write", async () => {
  const p = await preview();
  db.exec(
    "CREATE TRIGGER fail_handoff BEFORE INSERT ON context_handoffs BEGIN SELECT RAISE(ABORT,'test failure'); END",
  );
  assert.equal(
    (
      await send("", "POST", {
        requestId: randomUUID(),
        input: p.input,
        selection: p.selection,
        digest: p.digest,
      })
    ).status,
    500,
  );
  db.exec("DROP TRIGGER fail_handoff");
  await create(p);
});

test("file SQLite handoff persists exact content in a separate process after restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "mentor-handoff-")),
    database = join(directory, "handoff.sqlite");
  const script = `import {db,saveSnapshot} from './src/storage.js';import {migrateHandoffs,createHandoff,getHandoff} from './src/handoffs.js';import {buildHandoffPreview} from './src/ideHandoffContext.js';migrateHandoffs(db);if(process.env.STAGE==='save'){saveSnapshot({snapshotId:'persist',repository:'https://github.com/a/b',commit:'a'.repeat(40),components:[],relationships:[],references:[],report:{limitations:[]}}, {}, '');const p=buildHandoffPreview(db,{input:{snapshotId:'persist',sourceReferenceIds:[],question:' exact persisted question ',attemptedSteps:'',additionalContext:'',origin:{type:'editor'}}});console.log(JSON.stringify(createHandoff(db,{requestId:'00000000-0000-4000-8000-000000000001',input:p.input,selection:p.selection,digest:p.digest}).handoff));}else console.log(JSON.stringify(getHandoff(db,process.env.HANDOFF_ID,'persist')));db.close();`;
  try {
    const run = (env) =>
      spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, DATABASE_PATH: database, ...env },
        encoding: "utf8",
      });
    const a = run({ STAGE: "save" });
    assert.equal(a.status, 0, a.stderr);
    const saved = JSON.parse(a.stdout),
      b = run({ STAGE: "read", HANDOFF_ID: saved.id });
    assert.equal(b.status, 0, b.stderr);
    assert.deepEqual(JSON.parse(b.stdout), saved);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("inferred documentation requires opt in and selected source coverage", async () => {
  const component = graph.components[0];
  const data = {
    snapshotId: graph.snapshotId,
    ai: {
      explanations: [
        {
          componentId: component.id,
          explanation: "Stored inferred explanation <script>untrusted</script>",
          inferred: true,
          referenceIds: [component.referenceId],
        },
      ],
    },
  };
  db.prepare("UPDATE documentation SET data=? WHERE snapshot_id=?").run(
    JSON.stringify(data),
    graph.snapshotId,
  );
  const p = await preview();
  assert.equal(p.candidates.documentation.length, 1);
  assert.equal(p.context.documentation.length, 0);
  const included = await preview(input(), {
    ...p.selection,
    includeDocumentation: true,
  });
  assert.equal(included.context.documentation.length, 1);
  assert(included.markdown.includes("inferred"));
  assert(!included.markdown.includes("<script>untrusted"));
  const missing = await preview(input(), {
    referenceIds: [],
    relationshipIds: [],
    excerptReferenceIds: [],
    includeDocumentation: true,
    includeCheckpointNotes: false,
  });
  assert.equal(missing.context.documentation.length, 0);
  db.prepare("UPDATE documentation SET data=? WHERE snapshot_id=?").run(
    JSON.stringify({ snapshotId: graph.snapshotId }),
    graph.snapshotId,
  );
});

test("stored evidence drift fails save, list pagination is bounded, and UTF8 request limits apply", async () => {
  const p = await preview(),
    component = graph.components[0];
  const stored = db
    .prepare("SELECT data FROM components WHERE snapshot_id=? AND id=?")
    .get(graph.snapshotId, component.id);
  try {
    db.prepare("UPDATE components SET data=? WHERE snapshot_id=? AND id=?").run(
      JSON.stringify({
        ...JSON.parse(stored.data),
        name: "changed stored name",
      }),
      graph.snapshotId,
      component.id,
    );
    assert.equal(
      (
        await send("", "POST", {
          requestId: randomUUID(),
          input: p.input,
          selection: p.selection,
          digest: p.digest,
        })
      ).status,
      409,
    );
  } finally {
    db.prepare("UPDATE components SET data=? WHERE snapshot_id=? AND id=?").run(
      stored.data,
      graph.snapshotId,
      component.id,
    );
  }
  await create(await preview());
  await create(await preview());
  const q = `?snapshotId=${graph.snapshotId}`;
  const a = await (await send(q + "&limit=1")).json(),
    b = await (await send(q + "&limit=1&offset=1")).json();
  assert.equal(a.items.length, 1);
  assert.equal(a.hasMore, true);
  assert.notEqual(a.items[0].id, b.items[0].id);
  assert(!("context" in a.items[0]));
  assert(!("attemptedSteps" in a.items[0]));
  for (const query of ["&limit=26", "&offset=-1", "&extra=1"])
    assert.equal((await send(q + query)).status, 400);
  assert.equal(
    (
      await send("/preview", "POST", {
        input: { ...input(), question: "x".repeat(25000) },
      })
    ).status,
    413,
  );
  const ref = graph.references.find(
    (r) => r.id === input().sourceReferenceIds[0],
  );
  const foreign = analyze({
    repository: graph.repository,
    commit: "d".repeat(40),
    files: { "other.ts": "export const other=1" },
  });
  saveSnapshot(foreign, { snapshotId: foreign.snapshotId }, "");
  db.prepare("INSERT INTO source_references VALUES (?,?,?)").run(
    "original-only",
    graph.snapshotId,
    JSON.stringify({ ...ref, id: "original-only" }),
  );
  assert.equal(
    (
      await send("/preview", "POST", {
        input: {
          ...input(),
          snapshotId: foreign.snapshotId,
          sourceReferenceIds: ["original-only"],
        },
      })
    ).status,
    400,
  );
});

test("sixteen supplied references retain selected declaration within the candidate bound", async () => {
  const original = graph.references[0];
  const ids = Array.from({ length: 16 }, (_, i) => `bounded-ref-${i}`);
  for (const id of ids)
    db.prepare("INSERT INTO source_references VALUES (?,?,?)").run(
      id,
      graph.snapshotId,
      JSON.stringify({ ...original, id }),
    );
  try {
    const i = { ...input(), sourceReferenceIds: ids },
      p = await preview(i);
    assert.equal(p.candidates.references.length, 16);
    assert.equal(
      p.candidates.references[0].id,
      graph.components[0].referenceId,
    );
    assert(p.selection.referenceIds.includes(graph.components[0].referenceId));
    assert.equal(p.context.component.id, graph.components[0].id);
    assert.equal(new Set(p.candidates.references.map((r) => r.id)).size, 16);
    const all = await preview(i, {
      ...p.selection,
      referenceIds: p.candidates.references.map((r) => r.id),
      relationshipIds: [],
    });
    await create(all);
  } finally {
    for (const id of ids)
      db.prepare(
        "DELETE FROM source_references WHERE snapshot_id=? AND id=?",
      ).run(graph.snapshotId, id);
  }
});

test("authored control characters fail closed while tabs and line endings remain exact", async () => {
  for (const field of ["question", "attemptedSteps", "additionalContext"])
    for (const character of ["\0", "\u001b", "\u007f", "\u0085"])
      assert.equal(
        (
          await send("/preview", "POST", {
            input: { ...input(), [field]: `before${character}after` },
          })
        ).status,
        400,
        `${field} ${character.charCodeAt(0)}`,
      );
  const text = " exact\ttext\r\nline\n";
  const p = await preview({
    ...input(),
    question: text,
    attemptedSteps: text,
    additionalContext: text,
  });
  for (const field of ["question", "attemptedSteps", "additionalContext"])
    assert.equal(p.context[field], text);
  const { createCheckpoint } = await import("../src/checkpoints.js");
  const c = createCheckpoint(db, {
    requestId: randomUUID(),
    snapshotId: graph.snapshotId,
    taskTitle: "control notes",
    notes: { discovery: "saved note", unresolved: "", nextStep: "" },
    localContext: { gitStatus: "unknown" },
    sourceReferenceIds: input().sourceReferenceIds,
  }).detail.checkpoint;
  // Simulate a legacy record from before checkpoint text validation hardened.
  db.prepare('UPDATE task_checkpoints SET notes_json=? WHERE id=?').run(
    JSON.stringify({ ...c.notes, discovery: 'saved\0note' }), c.id,
  );
  const i = { ...input(), origin: { type: "checkpoint", checkpointId: c.id } },
    without = await preview(i);
  assert.equal(without.context.checkpointNotes, undefined);
  assert.equal(
    (
      await send("/preview", "POST", {
        input: i,
        selection: { ...without.selection, includeCheckpointNotes: true },
      })
    ).status,
    400,
  );
});

test("historical saved package survives missing snapshot and deletion preserves checkpoint and current snapshot", async () => {
  const p = await preview(),
    saved = await create(p),
    current = {
      ...graph,
      snapshotId: "current",
      commit: "c".repeat(40),
      components: [],
      relationships: [],
      references: [],
    };
  saveSnapshot(current, { snapshotId: "current" }, "");
  const count = db
    .prepare("SELECT count(*) AS n FROM task_checkpoints")
    .get().n;
  db.prepare("DELETE FROM snapshots WHERE id=?").run(graph.snapshotId);
  const q = "?snapshotId=current";
  assert.deepEqual(await (await send(`/${saved.id}${q}`)).json(), saved);
  assert.deepEqual(await (await send(`/${saved.id}/export${q}`)).json(), {
    id: saved.id,
    markdown: p.markdown,
    digest: p.digest,
  });
  assert.equal((await send(`/${saved.id}${q}`, "DELETE")).status, 200);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM task_checkpoints").get().n,
    count,
  );
  assert(db.prepare("SELECT id FROM snapshots WHERE id='current'").get());
});
