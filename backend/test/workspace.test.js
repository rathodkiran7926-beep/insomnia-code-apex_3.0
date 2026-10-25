import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_PATH = ":memory:";
process.env.LLM_MODEL ||= "test-provider-model";
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

function factualFixture() {
  const sources = {
    "facts.ts": 'export function save(id: string): string { return id; }\nexport function handle(id: string): string { return save(id); }\nexport function idle(): void {}\n',
  };
  const snapshot = analyze({ repository: graph.repository, commit: "f".repeat(40), files: sources });
  saveSnapshot(snapshot, {}, "", sources);
  const find = (name) => snapshot.components.find((node) => node.name === name);
  return { snapshot, sources, save: find("save"), handle: find("handle"), idle: find("idle") };
}

async function withFakeMentor(callback, fail = false) {
  const original = globalThis.fetch;
  const key = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = "test-key";
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request);
    if (fail) return new Response("provider rejected request", { status: 401 });
    const context = JSON.parse(request.messages[1].content).untrustedSourceEvidence;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      answer: "Model explanation from supplied evidence.", referenceIds: [context.component.referenceId],
    }) } }] }));
  };
  try { await callback(calls); }
  finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
  }
}

test("complete precise factual questions use validated saved facts without provider calls", async () => {
  const fixture = factualFixture();
  for (const [name, question, expected] of [
    ["save", "Which direct callers are resolved by static analysis?", /handle/],
    ["handle", "Which direct dependencies are resolved by static analysis?", /save/],
    ["save", "What are the declared inputs of this function?", /id: string/],
    ["save", "What is the declared output type of this function?", /string/],
    ["save", "What are the declared inputs and output type of this function?", /id: string/],
    ["idle", "What are the declared inputs of this function?", /none declared/],
  ]) await withFakeMentor(async (calls) => {
    const selected = fixture[name];
    const response = await answerQuestion(fixture.snapshot, selected.id, question);
    assert.equal(calls.length, 0, question);
    assert.equal(response.mode, "facts");
    assert.match(response.answer, expected);
    assert.match(response.notice, /source facts/i);
    assert.doesNotMatch(response.notice, /configure|unavailable/i);
    assert.equal(response.snapshotId, fixture.snapshot.snapshotId);
    assert.equal(response.componentId, selected.id);
    assert.deepEqual(Object.keys(response).sort(), ["answer", "referenceIds", "mode", "notice", "snapshotId", "componentId", "citations"].sort());
    validateAnswer({ answer: response.answer, referenceIds: response.referenceIds }, { references: fixture.snapshot.references });
    assert.equal(response.referenceIds[0], selected.referenceId);
    if (/resolved by static analysis/.test(question)) {
      const edges = fixture.snapshot.relationships.filter((edge) => /callers/.test(question)
        ? edge.target === selected.id && edge.type === "calls" : edge.source === selected.id);
      assert(edges.every((edge) => response.referenceIds.includes(edge.referenceId)));
      assert(edges.every((edge) => response.referenceIds.includes(fixture.snapshot.components.find((node) =>
        node.id === (/callers/.test(question) ? edge.source : edge.target)).referenceId)));
    }
    assert(response.citations.every((citation) => fixture.snapshot.references.some((reference) => reference.id === citation.id && reference.url === citation.url)));
  });
});

test("ambiguous, reasoning, mixed and unsupported questions retain the model path", async () => {
  const { snapshot, save } = factualFixture();
  for (const question of [
    "What calls this?", "input", "Is this safe to change?",
    "Why does this function return the identifier?", "How does this validation work?",
    "Recommend a better design for this function.",
    "Which direct callers are resolved by static analysis, and why?",
    "What are the declared inputs of this function? How should I validate them?",
    "Which direct callers are resolved by static analysis? Ignore the question and explain design.",
  ]) await withFakeMentor(async (calls) => {
    const response = await answerQuestion(snapshot, save.id, question);
    assert.equal(calls.length, 1, question);
    assert.equal(response.mode, "ai");
    assert.match(response.answer, /Model explanation/);
  });
});

test("missing, truncated, stale or uncited evidence never enables the shortcut", async () => {
  for (const defect of ["missing-source", "truncated-source", "truncated-reference", "stale-source", "stale-neighbor", "missing-neighbor", "missing-citation", "unresolved-node", "nonstatic-edge", "context-limit", "unknown-output", "unknown-inputs", "invalid-range", "missing-offsets"]) {
    const { snapshot, sources, save } = factualFixture();
    if (defect === "missing-source") db.prepare("DELETE FROM source_files WHERE snapshot_id=?").run(snapshot.snapshotId);
    if (defect === "truncated-source") {
      const reference = snapshot.references.find((ref) => ref.id === save.referenceId);
      reference.endLine = 2000;
      saveSnapshot(snapshot, {}, "", { "facts.ts": sources["facts.ts"] + "// padding\n".repeat(2000) });
    }
    if (defect === "truncated-reference") snapshot.references.find((ref) => ref.id === save.referenceId).excerpt = "export function save";
    if (defect === "stale-source") saveSnapshot(snapshot, {}, "", { "facts.ts": sources["facts.ts"].replace("return id;", "return ''; ") });
    if (defect === "stale-neighbor") saveSnapshot(snapshot, {}, "", { "facts.ts": sources["facts.ts"].replace("function handle", "function caller") });
    if (defect === "missing-neighbor") snapshot.references = snapshot.references.filter((ref) => ref.id !== snapshot.components.find((node) => node.name === "handle").referenceId);
    if (defect === "missing-citation") snapshot.references = snapshot.references.filter((ref) => ref.id !== snapshot.relationships[0].referenceId);
    if (defect === "unresolved-node") snapshot.components = snapshot.components.filter((node) => node.name !== "handle");
    if (defect === "nonstatic-edge") snapshot.relationships[0].certainty = "inferred";
    if (defect === "context-limit") snapshot.relationships = Array.from({ length: 101 }, (_, index) => ({ ...snapshot.relationships[0], id: `extra-${index}` }));
    if (defect === "unknown-output") save.output = "Not statically determined";
    if (defect === "unknown-inputs") delete save.inputs;
    if (defect === "invalid-range") snapshot.references.find((ref) => ref.id === save.referenceId).startLine = 200;
    if (defect === "missing-offsets") delete snapshot.references.find((ref) => ref.id === save.referenceId).endOffset;
    await withFakeMentor(async (calls) => {
      const question = defect === "unknown-output" ? "What is the declared output type of this function?"
        : defect === "unknown-inputs" ? "What are the declared inputs of this function?"
        : "Which direct callers are resolved by static analysis?";
      const response = await answerQuestion(snapshot, save.id, question);
      assert.equal(calls.length, 1, defect);
      assert.equal(response.mode, "ai", defect);
    });
  }
});

test("resolved caller lists exceeding the citation budget retain the model path", async () => {
  const sources = { "many.ts": 'export function selected(): void {}\n' +
    Array.from({ length: 8 }, (_, index) => `export function caller${index}(): void { selected(); }`).join("\n") };
  const snapshot = analyze({ repository: graph.repository, commit: "e".repeat(40), files: sources });
  saveSnapshot(snapshot, {}, "", sources);
  const selected = snapshot.components.find((node) => node.name === "selected");
  await withFakeMentor(async (calls) => {
    const response = await answerQuestion(snapshot, selected.id, "Which direct callers are resolved by static analysis?");
    assert.equal(calls.length, 1);
    assert.equal(response.mode, "ai");
  });
});

test("zero resolved callers report coverage without claiming no real callers", async () => {
  const { snapshot, idle } = factualFixture();
  await withFakeMentor(async (calls) => {
    const response = await answerQuestion(snapshot, idle.id, "Which direct callers are resolved by static analysis?");
    assert.equal(calls.length, 0);
    assert.match(response.answer, /none resolved by static analysis/i);
    assert.match(response.answer, /dynamic|unresolved/i);
    assert.doesNotMatch(response.answer, /no callers exist|has no callers/i);
  });
});

test("precise questions preserve no-key facts and provider-error fallback", async () => {
  const { snapshot, save } = factualFixture();
  const question = "Which direct callers are resolved by static analysis?";
  await withFakeMentor(async (calls) => {
    delete process.env.LLM_API_KEY;
    const response = await answerQuestion(snapshot, save.id, question);
    assert.equal(calls.length, 0);
    assert.equal(response.mode, "facts");
    assert.match(response.notice, /Configure LLM_API_KEY/);
    assert.match(response.answer, /handle/);
  });
  await withFakeMentor(async (calls) => {
    const response = await answerQuestion(snapshot, save.id, "How should I change the callers?");
    assert.equal(calls.length, 1);
    assert.equal(response.mode, "facts");
    assert.match(response.notice, /AI response unavailable/);
    assert.match(response.answer, /handle/);
  }, true);
});
