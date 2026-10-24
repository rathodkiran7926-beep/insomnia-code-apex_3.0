import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_PATH = ":memory:";
process.env.LLM_MODEL ||= "test-provider-model";
const { db, saveSnapshot } = await import("../src/storage.js");
const { analyze } = await import("../src/analyzer.js");
const { generateGuide, guideContext, validateGuide } =
  await import("../src/generatedGuides.js");
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
test("LLM provider guides are generated once, citation-checked, and cached per component", async () => {
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
          "SELECT count(*) AS n FROM generated_guides WHERE cache_key LIKE 'v2:%:project:frontend'",
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

test("temporary LLM provider overload is retried once before a project guide is saved", async () => {
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
