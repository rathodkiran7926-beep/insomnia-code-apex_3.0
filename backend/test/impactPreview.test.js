import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  analyzeImpactPreview,
  traceIncomingImpact,
} from "../src/impactPreview.js";
import { impactPreviewRoutes } from "../src/impactPreviewRoutes.js";

const snapshotId = "snapshot-1";
const references = Array.from({ length: 8 }, (_, index) => ({
  id: `r${index}`,
  snapshotId,
  file: index === 7 ? "tests/target.test.ts" : `src/c${index}.ts`,
  startLine: index + 1,
  endLine: index + 2,
  url: `https://example.test/blob/commit/src/c${index}.ts#L${index + 1}`,
  excerpt:
    index === 7 ? "describe('target', () => {})" : `source reference ${index}`,
}));
const components = Array.from({ length: 8 }, (_, index) => ({
  id: `c${index}`,
  name: [
    "target",
    "directOne",
    "directTwo",
    "indirectOne",
    "indirectTwo",
    "importer",
    "container",
    "testTarget",
  ][index],
  role: index === 0 ? "function" : index === 5 ? "module" : "function",
  referenceId: `r${index}`,
}));
const edge = (id, source, target, type) => ({
  id,
  source,
  target,
  type,
  referenceId: `r${Number(id.slice(1)) % 6}`,
});
const graph = {
  snapshotId,
  repository: "https://github.com/example/repo",
  commit: "a".repeat(40),
  components,
  references,
  relationships: [
    edge("e0", "c1", "c0", "calls"),
    edge("e1", "c2", "c0", "calls"),
    edge("e2", "c3", "c1", "calls"),
    edge("e3", "c4", "c3", "calls"),
    edge("e4", "c1", "c3", "calls"),
    edge("e5", "c5", "c0", "imports"),
    edge("e6", "c6", "c0", "contains"),
  ],
  report: { unresolved: [] },
};

test("incoming call traversal reports direct and indirect dependents with original edge direction", () => {
  const result = analyzeImpactPreview(graph, "c0", "behavior-change", 2, 30);
  assert.deepEqual(
    result.affected.map(({ id, minDepth }) => [id, minDepth]),
    [
      ["c1", 1],
      ["c2", 1],
      ["c3", 2],
    ],
  );
  const indirect = result.affected.find((component) => component.id === "c3");
  assert.deepEqual(
    indirect.evidencePaths[0].map(({ id, source, target }) => [
      id,
      source,
      target,
    ]),
    [
      ["e2", "c3", "c1"],
      ["e0", "c1", "c0"],
    ],
  );
  assert.equal(indirect.evidencePaths[0][0].reference.id, "r2");
  assert.equal(result.snapshotId, snapshotId);
  assert.equal(result.commitSha, graph.commit);
  assert.equal(result.truncated, true);
});

test("cycles are bounded and non-call relationships are only included for remove or rename", () => {
  const behavior = traceIncomingImpact(graph, ["c0"], {
    scenario: "behavior-change",
    depth: 5,
    limit: 30,
  });
  assert.equal(
    behavior.affected.some((component) => component.id === "c5"),
    false,
  );
  assert.equal(
    behavior.affected.some((component) => component.id === "c6"),
    false,
  );

  const removal = analyzeImpactPreview(graph, "c0", "remove-or-rename", 2, 30);
  assert(removal.affected.some((component) => component.id === "c5"));
  assert(!removal.affected.some((component) => component.id === "c6"));
  assert(removal.unsupportedRelationshipTypes.includes("contains"));
  assert(removal.supportedTests.some((reference) => reference.id === "r7"));
  assert(behavior.affected.length < 8);
});

test("result limits truncate unique components and preserve shortest paths", () => {
  const limited = analyzeImpactPreview(graph, "c0", "behavior-change", 4, 1);
  assert.equal(limited.affected.length, 1);
  assert.equal(limited.affected[0].minDepth, 1);
  assert.equal(limited.truncated, true);
  assert.equal(limited.affected[0].evidencePaths[0][0].id, "e0");
});

test("multiple changed seeds are not returned again as potential dependents", () => {
  const result = traceIncomingImpact(graph, ["c0", "c1"], {
    scenario: "behavior-change",
    depth: 2,
    limit: 30,
  });
  assert.equal(
    result.affected.some((component) => component.id === "c1"),
    false,
  );
  assert.equal(
    result.affected.some((component) => component.id === "c3"),
    true,
  );
});

test("snapshot component membership and reference ownership are enforced", () => {
  assert.throws(
    () =>
      analyzeImpactPreview(graph, "not-in-snapshot", "behavior-change", 2, 30),
    { status: 404 },
  );
  const invalid = {
    ...graph,
    references: graph.references.map((reference) =>
      reference.id === "r0"
        ? { ...reference, snapshotId: "other-snapshot" }
        : reference,
    ),
  };
  assert.throws(
    () => analyzeImpactPreview(invalid, "c0", "behavior-change", 2, 30),
    {
      status: 404,
    },
  );
});

test("read-only route validates parameters and returns only its loaded snapshot", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/snapshots",
    impactPreviewRoutes({
      loadSnapshot(id) {
        if (id !== snapshotId)
          throw Object.assign(new Error("Snapshot not found"), { status: 404 });
        return graph;
      },
      async readSource(sourceGraph, referenceId) {
        assert.equal(sourceGraph.snapshotId, snapshotId);
        assert.equal(referenceId, "r0");
        return {
          snapshotId,
          file: "src/c0.ts",
          complete: true,
          excerpt: "function target() {\n  return true;\n}\n",
        };
      },
    }),
  );
  app.use((error, _request, response, _next) =>
    response.status(error.status || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  const previousApiKey = process.env.LLM_API_KEY;
  const previousBaseUrl = process.env.LLM_BASE_URL;
  const originalFetch = globalThis.fetch;
  delete process.env.LLM_API_KEY;
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/snapshots`;
    const response = await fetch(
      `${base}/${snapshotId}/components/c0/impact-preview?scenario=behavior-change`,
    );
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.snapshotId, snapshotId);
    assert.equal(value.limit, 30);
    assert.equal(value.depth, 2);
    assert.equal(
      value.affected.every((item) =>
        item.evidencePaths.every((path) =>
          path.every((step) => step.reference?.snapshotId === snapshotId),
        ),
      ),
      true,
    );

    const invalid = await fetch(
      `${base}/${snapshotId}/components/c0/impact-preview?depth=99`,
    );
    assert.equal(invalid.status, 400);
    const foreign = await fetch(`${base}/foreign/components/c0/impact-preview`);
    assert.equal(foreign.status, 404);
    const explanationQuery = new URLSearchParams({
      scenario: "behavior-change",
      affectedComponentId: "c1",
      evidencePathEdgeIds: "e0",
    });
    const explanationResponse = await fetch(
      `${base}/${snapshotId}/components/c0/impact-explanations?${explanationQuery}`,
    );
    assert.equal(explanationResponse.status, 200);
    const explanation = await explanationResponse.json();
    assert.equal(explanation.mode, "source-facts");
    assert.match(explanation.sentences[1], /directOne calls target/);
    assert.equal(explanation.referenceIds.includes("r0"), true);

    const analysisResponse = await fetch(
      `${base}/${snapshotId}/components/c0/impact-analysis`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario: "behavior-change",
          proposedCode: "function target() {\n  return false;\n}",
        }),
      },
    );
    assert.equal(analysisResponse.status, 200);
    const analysis = await analysisResponse.json();
    assert.equal(analysis.snapshotId, snapshotId);
    assert.equal(analysis.analysis.mode, "source-facts");
    assert.equal(
      analysis.analysis.summary.includes("not configured"),
      true,
    );

    let sentComparison;
    let providerReference = "r0";
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "http://llm.test/v1";
    globalThis.fetch = async (_url, options) => {
      sentComparison = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "The return value changes.",
                  behaviorChanges: ["The function now returns false."],
                  dependencyImpacts: ["Callers may observe the changed result."],
                  reviewChecks: ["Check callers that rely on a truthy result."],
                  referenceIds: [providerReference],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const aiAnalysisResponse = await originalFetch(
      `${base}/${snapshotId}/components/c0/impact-analysis`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario: "behavior-change",
          proposedCode: "function target() {\n  return false;\n}",
        }),
      },
    );
    assert.equal(aiAnalysisResponse.status, 200);
    const aiAnalysis = await aiAnalysisResponse.json();
    assert.equal(aiAnalysis.analysis.mode, "ai");
    const submitted = JSON.parse(sentComparison.messages[1].content);
    assert.equal(submitted.beforeCode, "function target() {\n  return true;");
    assert.equal(submitted.proposedCode, "function target() {\n  return false;\n}");
    assert.deepEqual(aiAnalysis.analysis.referenceIds, ["r0"]);

    const question = "What happens if the caller receives an empty result?";
    for (const proposedCode of [submitted.beforeCode, ""]) {
      const scenarioResponse = await originalFetch(
        `${base}/${snapshotId}/components/c0/impact-analysis`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposedCode, question }),
        },
      );
      assert.equal(scenarioResponse.status, 200);
      assert.equal((await scenarioResponse.json()).analysis.mode, "ai");
      const scenario = JSON.parse(sentComparison.messages[1].content);
      assert.equal(scenario.question, question);
      assert.equal(scenario.proposedCode, scenario.beforeCode);
      assert.match(sentComparison.messages[0].content, /hypothetical/i);
      assert.match(sentComparison.messages[0].content, /unchanged/i);
    }
    for (const question of ["x".repeat(2001), { injected: true }]) {
      const invalidQuestion = await originalFetch(
        `${base}/${snapshotId}/components/c0/impact-analysis`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposedCode: submitted.beforeCode, question }),
        },
      );
      assert.equal(invalidQuestion.status, 400);
    }

    providerReference = "foreign-reference";
    const staleCitationResponse = await originalFetch(
      `${base}/${snapshotId}/components/c0/impact-analysis`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedCode: submitted.beforeCode, question }),
      },
    );
    assert.equal(staleCitationResponse.status, 502);
    delete process.env.LLM_API_KEY;
    const offlineScenarioResponse = await originalFetch(
      `${base}/${snapshotId}/components/c0/impact-analysis`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedCode: submitted.beforeCode, question }),
      },
    );
    assert.equal(offlineScenarioResponse.status, 200);
    assert.equal((await offlineScenarioResponse.json()).analysis.mode, "source-facts");

    const invalidAnalysis = await originalFetch(
      `${base}/${snapshotId}/components/c0/impact-analysis`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario: "behavior-change",
          proposedCode: "",
        }),
      },
    );
    assert.equal(invalidAnalysis.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousApiKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousApiKey;
    if (previousBaseUrl === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = previousBaseUrl;
    server.close();
  }
});
