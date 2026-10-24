import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_PATH = ":memory:";
const { db, saveSnapshot } = await import("../src/storage.js");
const { readSource, questionContext, validateAnswer, answerQuestion } =
  await import("../src/workspace.js");
const { analyze } = await import("../src/analyzer.js");
const files = {
  "service.ts":
    'export function save(id: string) { if (!id) throw new Error("Missing id"); return id; }\n',
  "handler.ts":
    'import {save} from "./service"; export function handle(req, res) { res.json(save(req.id)); }',
};
const graph = analyze({
  repository: "https://github.com/example/project",
  commit: "a".repeat(40),
  files,
});
saveSnapshot(graph, {}, "", files);
const component = graph.components.find(
  (c) => c.name === "save" && c.role !== "module",
);

test("complete files retain exact content and immutable snapshot identity", async () => {
  const source = await readSource(graph, component.referenceId);
  assert.equal(source.excerpt, files["service.ts"]);
  assert.equal(source.complete, true);
  assert.equal(source.snapshotId, graph.snapshotId);
  assert.equal(source.startLine, 1);
  assert.equal(source.endLine, 2);
  await assert.rejects(readSource(graph, "unknown"), /not found/);
  assert.throws(() => questionContext(graph, "unknown"), /not found/);
});
test("mentor citation validation rejects fabricated or unrelated references", () => {
  const context = questionContext(graph, component.id);
  assert.equal(
    validateAnswer(
      { answer: "Reads the parameter.", referenceIds: [component.referenceId] },
      context,
    ).answer,
    "Reads the parameter.",
  );
  assert.throws(
    () =>
      validateAnswer({ answer: "Fake", referenceIds: ["made-up"] }, context),
    /citation/,
  );
  assert.throws(() =>
    validateAnswer({ answer: "Fake", referenceIds: [] }, context),
  );
});
test("offline mentor returns actual caller facts and no fabricated design intent", async () => {
  const key = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  try {
    const response = await answerQuestion(
      graph,
      component.id,
      "What calls this?",
    );
    assert.equal(response.mode, "facts");
    assert.match(response.answer, /handle/);
    assert.equal(response.componentId, component.id);
    assert(response.citations.every((c) => c.snapshotId === graph.snapshotId));
    assert.match(
      (
        await answerQuestion(
          graph,
          component.id,
          "Why was this designed like this?",
        )
      ).answer,
      /cannot establish the author/,
    );
  } finally {
    if (key !== undefined) process.env.LLM_API_KEY = key;
  }
});
test("legacy source fetch is pinned to a stored path and commit, cached, and bounded", async () => {
  db.prepare("DELETE FROM source_files WHERE snapshot_id=?").run(
    graph.snapshotId,
  );
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.match(
      String(url),
      new RegExp(`/contents/service.ts\\?ref=${graph.commit}$`),
    );
    return new Response(
      JSON.stringify({
        type: "file",
        path: "service.ts",
        size: files["service.ts"].length,
        encoding: "base64",
        content: Buffer.from(files["service.ts"]).toString("base64"),
      }),
    );
  };
  try {
    assert.equal(
      (await readSource(graph, component.referenceId)).excerpt,
      files["service.ts"],
    );
    await readSource(graph, component.referenceId);
    assert.equal(calls, 1);
    db.prepare("DELETE FROM source_files WHERE snapshot_id=?").run(
      graph.snapshotId,
    );
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          type: "symlink",
          path: "service.ts",
          encoding: "base64",
          content: "",
          size: 0,
        }),
      );
    await assert.rejects(
      readSource(graph, component.referenceId),
      /unavailable/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("invalid AI citations fall back to static facts", async () => {
  const original = globalThis.fetch;
  const key = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = "test-key";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                answer: "Unsupported explanation",
                referenceIds: ["invented"],
              }),
            },
          },
        ],
      }),
    );
  try {
    const answer = await answerQuestion(
      graph,
      component.id,
      "What does this do?",
    );
    assert.equal(answer.mode, "facts");
    assert.match(answer.notice, /unavailable/);
    assert(!answer.answer.includes("Unsupported explanation"));
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
  }
});

test("valid AI answers keep selected component and exact source citation", async () => {
  const original = globalThis.fetch;
  const key = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = "test-key";
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.match(request.messages[0].content, /untrusted data/);
    const context = JSON.parse(
      request.messages[1].content,
    ).untrustedSourceEvidence;
    assert.equal(context.component.id, component.id);
    assert.match(context.selectedSource.excerpt, /throw new Error/);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                answer:
                  "The function rejects an empty identifier before returning it.",
                referenceIds: [component.referenceId],
              }),
            },
          },
        ],
      }),
    );
  };
  try {
    const answer = await answerQuestion(
      graph,
      component.id,
      "Explain this validation",
    );
    assert.equal(answer.mode, "ai");
    assert.equal(
      answer.citations[0].url,
      graph.references.find((r) => r.id === component.referenceId).url,
    );
    assert.equal(answer.snapshotId, graph.snapshotId);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
  }
});

test("high-degree facts stay bounded and cite the selected component first", async () => {
  const key = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  const neighbors = Array.from({ length: 250 }, (_, i) => ({
    id: `neighbor-${i}`, name: `caller-${i}-${'x'.repeat(100)}`,
    role: 'function', referenceId: `ref-${i}`,
  }));
  const selected = { id: 'selected', name: 'selected', role: 'function', referenceId: 'selected-ref' };
  const large = { ...graph, components: [...neighbors, selected],
    relationships: neighbors.map(n => ({ id: `edge-${n.id}`, source: n.id, target: selected.id, type: 'calls', referenceId: n.referenceId })),
    references: [...neighbors, selected].map((n, i) => ({ ...graph.references[0], id: n.referenceId, startLine: i + 1, endLine: i + 1, url: `${graph.repository}/blob/${graph.commit}/service.ts#L${i + 1}-L${i + 1}` })),
  };
  try {
    const response = await answerQuestion(large, selected.id, 'What calls this?');
    assert(response.answer.length <= 16000, `answer length ${response.answer.length}`);
    assert.match(response.notice, /limited|truncat/i);
    assert.equal(response.referenceIds[0], selected.referenceId);
    assert.equal(response.citations[0].id, selected.referenceId);
  } finally {
    if (key !== undefined) process.env.LLM_API_KEY = key;
  }
});
