import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_PATH = ":memory:";
const { db, saveSnapshot } = await import("../src/storage.js");
const { analyze } = await import("../src/analyzer.js");
const { generateGuide, guideContext, validateGuide } =
  await import("../src/generatedGuides.js");
const { generationUsage } = await import("../src/generationAccounting.js");
const files = {
  "backend/package.json": JSON.stringify({
    scripts: { dev: "node app.js" },
    dependencies: { express: "5" },
  }),
  "backend/app.ts":
    "import express from 'express'; import {router} from './routes'; export const app=express(); app.use('/api',router);",
  "backend/routes.ts":
    "import express from 'express'; export const router=express.Router(); router.post('/upload',(req,res)=>res.json({ok:true}));",
  "frontend/App.tsx":
    "export function App(){return <main>Upload a file</main>}",
};
const graph = analyze({
  repository: "https://github.com/example/upload",
  commit: "b".repeat(40),
  files,
});
saveSnapshot(graph, { ai: { explanations: [] } }, "", files);
const router = graph.components.find((c) => c.role === "router");
const value = (id) => ({
  sections: [
    "Responsibility",
    "Step-by-step behavior",
    "Inputs and output",
    "Validation and changes",
  ].map((title) => ({
    title,
    content:
      "The router registers an upload endpoint. Express receives the request and invokes its recorded handler.",
    referenceIds: [id],
  })),
});

test("component context includes the surrounding route registrations and real citations", async () => {
  const context = await guideContext(graph, {
    componentId: router.id,
    scope: "all",
  });
  assert.match(context.facts.containingFile.content, /post\('\/upload'/);
  assert(context.facts.relationships.some((e) => e.type === "registers_route"));
  assert(context.references.every((r) => r.snapshotId === graph.snapshotId));
});
test("project scope separates frontend source and captures real backend manifest commands", async () => {
  const front = await guideContext(graph, { scope: "frontend" });
  assert(front.references.every((r) => r.file.startsWith("frontend/")));
  assert(front.facts.components.every((c) => c.role !== "router"));
  const back = await guideContext(graph, { scope: "backend" });
  assert(
    back.references.some(
      (r) =>
        r.id === "manifest:backend/package.json" &&
        r.excerpt.includes("node app.js"),
    ),
  );
  assert(back.references.every((r) => r.file.startsWith("backend/")));
  assert(back.facts.sourceReferences.every((r) => !('url' in r) && !('snapshotId' in r)));
});
test("documentation rejects fabricated citations and model-generated source URLs", () => {
  assert.throws(
    () => validateGuide(value("unknown"), graph.references),
    /citation/,
  );
  const guide = value(router.referenceId);
  guide.sections[0].content = "Go to https://invented.example";
  assert.throws(() => validateGuide(guide, graph.references), /coordinates/);
});

test("large project evidence is sampled honestly and keeps full citations outside the prompt", async () => {
  const manyFiles = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [
    `src/group${i}/part.ts`,
    `export function part${i}(){return '${'sample '.repeat(150)}';}`,
  ]));
  const large = analyze({ repository: "https://github.com/example/large", commit: "c".repeat(40), files: manyFiles });
  const context = await guideContext(large, { scope: "all" });
  assert.equal(context.facts.contextLimited, true);
  assert(context.facts.counts.components > context.facts.components.length);
  assert(JSON.stringify(context.facts).length < 16000);
  assert(context.references.every((r) => r.url && r.snapshotId === large.snapshotId));
  assert(context.facts.sourceReferences.every((r) => !('url' in r) && !('snapshotId' in r)));
});
test("AI provider guides are generated once, citation-checked, and cached per component", async () => {
  const fetchOriginal = globalThis.fetch,
    key = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = "mock-key";
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.match(request.messages[0].content, /router explain registration/);
    const context = JSON.parse(
      request.messages[1].content,
    ).untrustedSourceEvidence;
    assert.equal(context.component.id, router.id);
    // JSON mode alone permits the echoed source-reference object observed in production.
    assert.equal(request.response_format.type, "json_schema");
    const schema = request.response_format.json_schema.schema;
    assert.deepEqual(schema.required, ["sections"]);
    assert.equal(schema.additionalProperties, false);
    const section = schema.properties.sections.items;
    assert.deepEqual(section.required, ["title", "content", "referenceIds"]);
    assert.deepEqual(
      section.properties.referenceIds.items.enum,
      context.sourceReferences.map((r) => r.id),
    );
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: JSON.stringify(value(router.referenceId)) } },
        ],
      }),
    );
  };
  try {
    const [a, b] = await Promise.all([
      generateGuide(graph, { componentId: router.id }),
      generateGuide(graph, { componentId: router.id }),
    ]);
    assert.equal(calls, 1);
    assert.equal(a.componentId, router.id);
    assert.equal(b.snapshotId, graph.snapshotId);
    assert.equal(
      a.citations[0].url,
      graph.references.find((r) => r.id === router.referenceId).url,
    );
    assert.equal(
      (await generateGuide(graph, { componentId: router.id })).cached,
      true,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = fetchOriginal;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
  }
});
test("missing keys and invalid responses fail explicitly and do not cache fake documentation", async () => {
  const key = process.env.LLM_API_KEY,
    fetchOriginal = globalThis.fetch;
  delete process.env.LLM_API_KEY;
  try {
    await assert.rejects(
      generateGuide(graph, { scope: "frontend" }),
      (e) => e.status === 503 && /LLM_API_KEY/.test(e.message),
    );
    process.env.LLM_API_KEY = "mock-key";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(value("fake")) } }],
        }),
      );
    await assert.rejects(
      generateGuide(graph, { scope: "frontend" }),
      (e) => e.status === 502,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM generated_guides WHERE cache_key='v1:project:frontend'",
        )
        .get().n,
      0,
    );
    await assert.rejects(
      generateGuide(graph, { componentId: "not-a-component" }),
      (e) => e.status === 404,
    );
  } finally {
    globalThis.fetch = fetchOriginal;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
  }
});

test("temporary AI provider overload is retried once before a project guide is saved", async () => {
  const key = process.env.LLM_API_KEY,
    original = globalThis.fetch;
  process.env.LLM_API_KEY = "mock-key";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? new Response("", { status: 503 })
      : new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: JSON.stringify(value(router.referenceId)) },
              },
            ],
          }),
        );
  };
  try {
    const result = await generateGuide(graph, { scope: "backend" });
    assert.equal(calls, 2);
    assert.equal(result.scope, "backend");
    assert.equal(result.componentId, null);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
  }
});

test("documentation allows longer generation without changing ordinary fetch timeouts", async () => {
  const originalTimeout = AbortSignal.timeout;
  const originalFetch = globalThis.fetch;
  const key = process.env.LLM_API_KEY;
  const timeouts = [];
  const component = graph.components.find((c) => c.name === "App");
  AbortSignal.timeout = (ms) => {
    timeouts.push(ms);
    return originalTimeout(ms);
  };
  process.env.LLM_API_KEY = "mock-key";
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(value(component.referenceId)) } }],
  }));
  try {
    const result = await generateGuide(graph, { componentId: component.id });
    assert(result.sections.length >= 4);
    const { boundedFetch } = await import("../src/github.js");
    await boundedFetch("https://example.test/facts");
    assert.deepEqual(timeouts, [120000, 30000]);
  } finally {
    AbortSignal.timeout = originalTimeout;
    globalThis.fetch = originalFetch;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
  }
});

test("overlapping scope visits already share generation and retain each scope's citations", async () => {
  const snapshot = analyze({ repository: graph.repository, commit: "d".repeat(40), files });
  saveSnapshot(snapshot, {}, "", files);
  const original = globalThis.fetch;
  const key = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = "mock-key";
  const releases = new Map();
  const calls = [];
  let started;
  const bothStarted = new Promise((resolve) => { started = resolve; });
  globalThis.fetch = async (_url, options) => {
    const context = JSON.parse(JSON.parse(options.body).messages[1].content).untrustedSourceEvidence;
    calls.push(context.scope);
    if (calls.length <= 2) await new Promise((resolve) => {
      releases.set(context.scope, resolve);
      if (releases.size === 2) started();
    });
    return new Response(JSON.stringify({ choices: [{ message: {
      content: JSON.stringify(value(context.sourceReferences[0].id)),
    } }] }));
  };
  try {
    const all = generateGuide(snapshot, { scope: "all" });
    const front = generateGuide(snapshot, { scope: "frontend" });
    const allAgain = generateGuide(snapshot, { scope: "all" });
    await bothStarted;
    assert.deepEqual(calls, ["all", "frontend"]);
    releases.get("frontend")();
    const frontGuide = await front;
    assert.equal(frontGuide.scope, "frontend");
    assert(frontGuide.citations.every((ref) => ref.file.startsWith("frontend/")));
    assert.equal((await generateGuide(snapshot, { scope: "frontend" })).cached, true);
    releases.get("all")();
    const [a, b] = await Promise.all([all, allAgain]);
    assert.deepEqual(a, b);
    assert.equal(a.scope, "all");
    const back = await generateGuide(snapshot, { scope: "backend" });
    assert(back.citations.every((ref) => ref.file.startsWith("backend/")));
    for (const scope of ["all", "frontend", "backend", "all"])
      assert.equal((await generateGuide(snapshot, { scope })).cached, true);
    assert.equal(calls.length, 3, "three cold scopes generate once each; overlapping/repeated visits add zero calls");
    const changed = analyze({ repository: graph.repository, commit: "e".repeat(40), files });
    saveSnapshot(changed, {}, "", files);
    const changedGuide = await generateGuide(changed, { scope: "all" });
    assert.equal(calls.length, 4, "a different snapshot must generate its own guide");
    assert(changedGuide.citations.every((ref) => ref.snapshotId === changed.snapshotId && ref.url.includes(changed.commit)));
    const selected = snapshot.components.find((node) => node.role === "router");
    assert.equal((await generateGuide(snapshot, { componentId: selected.id })).componentId, selected.id);
    assert.equal(calls.length, 5, "a new component must generate separately from its project scope");
  } finally {
    for (const release of releases.values()) release();
    globalThis.fetch = original;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
  }
});

test("guide errors and missing keys leave the same uncached selection retryable", async () => {
  const snapshot = analyze({ repository: graph.repository, commit: "f".repeat(40), files });
  saveSnapshot(snapshot, {}, "", files);
  const original = globalThis.fetch;
  const key = process.env.LLM_API_KEY;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    if (calls === 1) return new Response("Unauthorized", { status: 401 });
    const context = JSON.parse(JSON.parse(options.body).messages[1].content).untrustedSourceEvidence;
    return new Response(JSON.stringify({ choices: [{ message: {
      content: JSON.stringify(value(context.sourceReferences[0].id)),
    } }] }));
  };
  try {
    delete process.env.LLM_API_KEY;
    await assert.rejects(generateGuide(snapshot, { scope: "all" }), (error) => error.status === 503);
    assert.equal(calls, 0);
    process.env.LLM_API_KEY = "mock-key";
    await assert.rejects(generateGuide(snapshot, { scope: "all" }), (error) => error.status === 502);
    assert.equal(calls, 1);
    assert.equal((await generateGuide(snapshot, { scope: "all" })).scope, "all");
    assert.equal(calls, 2);
    assert.equal((await generateGuide(snapshot, { scope: "all" })).cached, true);
    assert.equal(calls, 2, "successful Retry must be reused without another provider call");
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
  }
});

test("guide accounting preserves existing cache keys, coalescing and model-independent artifacts", async () => {
  const snapshot = analyze({ repository: graph.repository, commit: "1".repeat(40), files });
  saveSnapshot(snapshot, {}, "", files);
  const original = globalThis.fetch, key = process.env.LLM_API_KEY, model = process.env.LLM_MODEL;
  process.env.LLM_API_KEY = "mock-key";
  const sequence = generationUsage().at(-1)?.sequence || 0;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const context = JSON.parse(JSON.parse(options.body).messages[1].content).untrustedSourceEvidence;
    return new Response(JSON.stringify({ choices: [{ message: {
      content: JSON.stringify(value(context.sourceReferences[0].id)),
    } }] }));
  };
  try {
    const [a, b] = await Promise.all([generateGuide(snapshot, { scope: "all" }), generateGuide(snapshot, { scope: "all" })]);
    assert.deepEqual(a, b);
    assert.equal(calls, 1);
    process.env.LLM_MODEL = "changed-model-must-not-invalidate-cache";
    const cached = await generateGuide(snapshot, { scope: "all" });
    assert.equal(cached.cached, true);
    assert.deepEqual(cached.sections, a.sections);
    assert.equal(calls, 1);
    const other = analyze({ repository: graph.repository, commit: "2".repeat(40), files });
    saveSnapshot(other, {}, "", files);
    assert.equal((await generateGuide(other, { scope: "all" })).snapshotId, other.snapshotId);
    assert.equal(calls, 2);
    const records = generationUsage().filter((row) => row.sequence > sequence && row.feature === "generated_guides");
    assert.equal(records.filter((row) => row.kind === "attempt").length, 2);
    assert(records.filter((row) => row.kind === "attempt").every((row) => row.tokens.total === "unknown"));
    assert.equal(records.filter((row) => row.kind === "cache" && row.status === "hit").length, 1);
    assert.equal(records.filter((row) => row.kind === "cache" && row.status === "coalesced").length, 1);
    assert(!JSON.stringify(records).includes(snapshot.snapshotId));
    assert(!JSON.stringify(records).includes("mock-key"));
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
    if (model === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = model;
  }
});

test("guide accounting measures each existing retry and rejects malformed output as before", async () => {
  const snapshot = analyze({ repository: graph.repository, commit: "3".repeat(40), files });
  saveSnapshot(snapshot, {}, "", files);
  const original = globalThis.fetch, key = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = "mock-key";
  const sequence = generationUsage().at(-1)?.sequence || 0;
  let calls = 0, malformed = false;
  globalThis.fetch = async (_url, options) => {
    calls++;
    if (calls === 1) return new Response("private provider failure details", { status: 503 });
    const context = JSON.parse(JSON.parse(options.body).messages[1].content).untrustedSourceEvidence;
    return new Response(JSON.stringify({ choices: [{ message: {
      content: malformed ? "malformed JSON" : JSON.stringify(value(context.sourceReferences[0].id)),
    } }], usage: { prompt_tokens: 23, completion_tokens: 4, total_tokens: 27 } }));
  };
  try {
    await generateGuide(snapshot, { scope: "all" });
    assert.equal(calls, 2);
    malformed = true;
    await assert.rejects(generateGuide(snapshot, { scope: "backend" }), (error) => error.status === 502);
    malformed = false;
    await generateGuide(snapshot, { scope: "backend" });
    await generateGuide(snapshot, { scope: "backend" });
    assert.equal(calls, 4);
    const records = generationUsage().filter((row) => row.sequence > sequence && row.feature === "generated_guides");
    const attempts = records.filter((row) => row.kind === "attempt");
    assert.equal(attempts.length, 4);
    assert.equal(attempts.filter((row) => row.status === "error").length, 1);
    assert.deepEqual(attempts[1].tokens, { input: 23, output: 4, total: 27 });
    assert.equal(records.filter((row) => row.kind === "generation_error" && row.errorCategory === "invalid_output").length, 1);
    assert(!JSON.stringify(records).includes("private provider failure details"));
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
  }
});

test("guide accounting distinguishes persistence failures without caching partial artifacts", async () => {
  const snapshot = analyze({ repository: graph.repository, commit: "4".repeat(40), files });
  saveSnapshot(snapshot, {}, "", files);
  const original = globalThis.fetch, key = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = "mock-key";
  const sequence = generationUsage().at(-1)?.sequence || 0;
  globalThis.fetch = async (_url, options) => {
    const context = JSON.parse(JSON.parse(options.body).messages[1].content).untrustedSourceEvidence;
    return new Response(JSON.stringify({ choices: [{ message: {
      content: JSON.stringify(value(context.sourceReferences[0].id)),
    } }] }));
  };
  db.exec("CREATE TEMP TRIGGER fail_guide_accounting BEFORE INSERT ON generated_guides BEGIN SELECT RAISE(ABORT,'private storage details'); END;");
  try {
    await assert.rejects(generateGuide(snapshot, { scope: "all" }), (error) => error.status === 502);
    const records = generationUsage().filter((row) => row.sequence > sequence && row.feature === "generated_guides");
    assert.equal(records.filter((row) => row.kind === "generation_error" && row.errorCategory === "storage").length, 1);
    assert(!JSON.stringify(records).includes("private storage details"));
    assert.equal(db.prepare("SELECT count(*) AS n FROM generated_guides WHERE snapshot_id=?").get(snapshot.snapshotId).n, 0);
  } finally {
    db.exec("DROP TRIGGER fail_guide_accounting");
    globalThis.fetch = original;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
  }
});
