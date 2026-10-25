import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import ts from "typescript";
process.env.DATABASE_PATH = ":memory:";
delete process.env.LLM_API_KEY;
const { journeyCatalog, journeyById } =
  await import("../src/journeyCatalog.js");
const {
  explainedTrace,
  saveObservedRun,
  validateObservedRun,
  traceFor,
  answerEventQuestion,
} = await import("../src/journeyService.js");
const { runnerArguments } = await import("../src/journeyRunner.js");
const { journeyRoutes } = await import("../src/journeyRoutes.js");
const { collaborationRoutes } = await import("../src/collaborationAuth.js");
const { db } = await import("../src/journeyStorage.js");
const { analyze } = await import("../src/analyzer.js");
const { saveSnapshot } = await import("../src/storage.js");
beforeEach(() => {
  // Each regression starts cold, without touching source/history/progress tables.
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='journey_explanation_artifacts'").get())
    db.exec("DELETE FROM journey_explanation_artifacts");
});
const journey = journeyById("signup"),
  scenario = journey.scenarios[0];
function contractFixture(scenarioId = "success") {
  const fields = {
    receive: { method: "POST", path: "/signup" },
    validate: { valid: scenarioId === "success" },
    lookup: { operation: "SELECT", storage: "in-memory SQLite" },
    "duplicate-check": { exists: false },
    prepare: { accountState: "ready for insertion" },
    write: { operation: "INSERT", changes: 1 },
    response: { status: 201 },
    invalid: { status: 400, branch: "invalid" },
  };
  return {
    recipeHash: journey.sourceHash,
    scenario: scenarioId,
    status: scenarioId === "success" ? 201 : 400,
    events: journey.scenarios
      .find((s) => s.id === scenarioId)
      .path.map((key, i) => ({
        key,
        fields: fields[key],
        timestamp: new Date(1700000000000 + i).toISOString(),
      })),
  };
}
test("all reviewed lessons have parseable source, exact source ranges, valid branches and related IDs", () => {
  assert(journeyCatalog.length >= 8);
  for (const j of journeyCatalog) {
    const parsed = ts.createSourceFile(
      j.id === "react" ? "x.tsx" : "x.ts",
      j.source,
      ts.ScriptTarget.Latest,
      true,
      j.id === "react" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    assert.equal(
      parsed.parseDiagnostics.length,
      0,
      j.id + ": " + parsed.parseDiagnostics.map((d) => d.messageText).join(","),
    );
    for (const e of j.events) {
      assert(e.source.startLine <= e.source.endLine);
      assert(
        j.source
          .split("\n")
          [e.source.startLine - 2].includes(`@event ${e.key}`),
      );
      assert.equal(e.observedFields, null);
    }
    for (const s of j.scenarios)
      assert(s.path.every((key) => j.events.some((e) => e.key === key)));
    assert(j.related.every((id) => journeyById(id)));
    assert.notEqual(
      j.events[0].explanations.beginner,
      j.events[0].explanations.advanced,
    );
  }
});
test("explained paths contain no invented runtime values, timestamps or observed-mode claims", () => {
  const trace = explainedTrace("signup", "invalid");
  assert.equal(trace.mode, "explained_path");
  assert.equal(trace.events.length, 3);
  assert(
    trace.events.every(
      (e) => e.timestamp === null && e.observedFields === null,
    ),
  );
  assert.equal(traceFor(trace.id).snapshotId, trace.snapshotId);
  assert.throws(
    () => explainedTrace("signup", "missing"),
    /Scenario not found/,
  );
});
test("runner accepts only fixed recipes and enforces no network, no mounts, no secret env and resource limits", () => {
  const args = runnerArguments("signup-success", "mentor-journey-1234abcd");
  for (const value of [
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--memory=192m",
    "--cpus=0.5",
    "--pids-limit=48",
    "--pull=never",
  ])
    assert(args.includes(value));
  assert(
    !args.some(
      (v) => v.startsWith("--mount") || v === "-v" || v.startsWith("--env"),
    ),
  );
  assert.throws(
    () => runnerArguments("arbitrary-script", "mentor-journey-1234abcd"),
    /Unapproved/,
  );
});
test("observed trace ingestion rejects changed source, missing branches, invented fields and invalid ordering", () => {
  assert.equal(
    validateObservedRun(journey, scenario, contractFixture()).status,
    201,
  );
  const invalid = contractFixture();
  invalid.events[1].fields.valid = false;
  assert.throws(
    () => validateObservedRun(journey, scenario, invalid),
    /branch/,
  );
  const extra = contractFixture();
  extra.events[0].fields.email = "must not be retained";
  assert.throws(
    () => validateObservedRun(journey, scenario, extra),
    /runtime fields/,
  );
  const missing = contractFixture();
  missing.events.pop();
  assert.throws(
    () => validateObservedRun(journey, scenario, missing),
    /Incomplete/,
  );
  assert.throws(
    () =>
      validateObservedRun(journey, scenario, {
        ...contractFixture(),
        recipeHash: "wrong",
      }),
    /version/,
  );
});
const app = express();
app.use(express.json());
app.use("/api/collaboration", collaborationRoutes);
app.use("/api", journeyRoutes);
app.use((e, _req, res, _next) =>
  res
    .status(e.status || (e.name === "ZodError" ? 400 : 500))
    .json({ error: e.message }),
);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
after(() => new Promise((resolve) => server.close(resolve)));
const base = `http://127.0.0.1:${server.address().port}/api`;
async function api(
  path,
  body,
  cookie = "",
  method = body === undefined ? "GET" : "POST",
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: res.status,
    data: await res.json(),
    cookie: res.headers.get("set-cookie")?.split(";")[0],
  };
}
let owner, other, captured;
test("public lesson APIs return pinned source and no fake instrumentation for uploaded snapshots", async () => {
  assert.equal(
    (await api("/codejourneys?examples=true")).data.journeys.length,
    journeyCatalog.length,
  );
  assert.equal(
    (await api("/codejourneys")).data.journeys.length,
    0,
    "A missing repository must never substitute example data",
  );
  const src = (
    await api(
      `/journey-snapshots/${journey.snapshotId}/source?referenceId=signup%3Avalidate`,
    )
  ).data;
  assert.equal(src.excerpt, journey.source);
  assert.equal(src.snapshotId, journey.snapshotId);
  assert.equal(
    (await api("/snapshots/uninstrumented/scenarios")).data.scenarios.length,
    0,
  );
  assert.equal(
    (
      await api(
        `/journey-snapshots/${journey.snapshotId}/source?referenceId=made-up`,
      )
    ).status,
    404,
  );
});
test("captured contract fixture traces have owner-only access and stored event/source identity", async () => {
  // These are validator fixtures, not evidence that Docker executed during this test.
  owner = await api("/collaboration/register", {
    name: "Owner",
    email: "owner@journey.test",
    password: "test password 12345",
  });
  other = await api("/collaboration/register", {
    name: "Other",
    email: "other@journey.test",
    password: "test password 12345",
  });
  captured = saveObservedRun(
    journey,
    scenario,
    contractFixture(),
    owner.data.user.id,
  );
  assert.equal((await api(`/traces/${captured.id}`)).status, 401);
  assert.equal(
    (await api(`/traces/${captured.id}`, undefined, other.cookie)).status,
    404,
  );
  assert.equal(
    (await api(`/traces/${captured.id}`, undefined, owner.cookie)).data.mode,
    "observed_replay",
  );
  assert.equal(
    db
      .prepare("SELECT count(*) AS n FROM event_source_links WHERE trace_id=?")
      .get(captured.id).n,
    captured.events.length,
  );
  assert.equal(
    (
      await api(
        "/scenarios/signup-success/runs",
        { approved: false },
        owner.cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (await api("/scenarios/unapproved/runs", { approved: true }, owner.cookie))
      .status,
    400,
  );
});
test("guests can ask about explained learning paths without a team account", async () => {
  const trace = explainedTrace("signup", "success"), event = trace.events[1];
  const count = db.prepare("SELECT COUNT(*) AS count FROM journey_questions").get().count;
  const body = { eventId: event.id, snapshotId: trace.snapshotId, question: "What does this component do?", level: "beginner" };
  const response = await api(`/traces/${encodeURIComponent(trace.id)}/questions`, body);
  assert.equal(response.status, 200);
  assert.equal(response.data.sourceRefId, event.sourceRefId);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM journey_questions").get().count, count);
  assert.equal((await api(`/traces/${encodeURIComponent(trace.id)}/questions`, { ...body, eventId: "wrong" })).status, 404);
  assert.equal((await api("/traces/private-runtime-trace/questions", body)).status, 401);
});

test("questions stay pinned to their event and save trace/event/snapshot IDs without unrelated runtime values", async () => {
  const trace = explainedTrace("signup", "success"),
    event = trace.events[1];
  const response = await api(
    `/traces/${encodeURIComponent(trace.id)}/questions`,
    {
      eventId: event.id,
      snapshotId: trace.snapshotId,
      question: "Can validation stop the database write?",
      level: "beginner",
    },
    owner.cookie,
  );
  assert.equal(response.status, 200);
  assert.equal(response.data.eventId, event.id);
  assert.equal(response.data.traceId, trace.id);
  assert.match(response.data.answer, /unknown/);
  const saved = db
    .prepare("SELECT * FROM journey_questions WHERE event_id=?")
    .get(event.id);
  assert.equal(saved.snapshot_id, trace.snapshotId);
  assert.equal(
    (
      await api(
        `/traces/${captured.id}/questions`,
        {
          eventId: captured.events[0].id,
          snapshotId: captured.snapshotId,
          question: "Why?",
          level: "beginner",
        },
        other.cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await api(
        `/traces/${encodeURIComponent(trace.id)}/questions`,
        {
          eventId: "wrong",
          snapshotId: trace.snapshotId,
          question: "Why?",
          level: "beginner",
        },
        owner.cookie,
      )
    ).status,
    404,
  );
});
test("checkpoint completion requires the actual path and its predictions, and remains user-scoped", async () => {
  const trace = explainedTrace("signup", "success");
  const value = {
    traceId: trace.id,
    snapshotId: trace.snapshotId,
    eventId: trace.events.at(-1).id,
    level: "beginner",
    visited: trace.events.map((e) => e.id),
    predictions: {},
    completed: true,
  };
  assert.equal(
    (await api("/codejourneys/signup/checkpoint", value, owner.cookie, "PUT"))
      .status,
    400,
  );
  for (const event of trace.events.filter((e) => e.prediction))
    value.predictions[event.id] = {
      answer: event.prediction.correct,
      correct: true,
    };
  assert.equal(
    (await api("/codejourneys/signup/checkpoint", value, owner.cookie, "PUT"))
      .status,
    200,
  );
  assert.equal(
    (await api("/codejourneys/progress", undefined, other.cookie)).data
      .checkpoints.length,
    0,
  );
  assert.equal(
    (await api("/codejourneys/progress", undefined, owner.cookie)).data
      .checkpoints[0].completed,
    true,
  );
  const alternate = explainedTrace("signup", "invalid");
  const next = await api(
    "/codejourneys/signup/checkpoint",
    {
      ...value,
      traceId: alternate.id,
      eventId: alternate.events[0].id,
      visited: [alternate.events[0].id],
      predictions: {},
      completed: false,
    },
    owner.cookie,
    "PUT",
  );
  assert(
    next.data.completedScenarios.includes("success"),
    "Exploring another branch must not erase the completed main path.",
  );
});

test("repository journeys use real analyzed components, cross-file source and versioned graph edges without demo fallback", async () => {
  const files = {
    "routes.ts": `import express from 'express'; import {createAccount} from './accounts'; const app=express(); app.post('/register', (req,res)=>res.json(createAccount(req.body)));`,
    "accounts.ts": `export function createAccount(input: {email:string}) { if (!input.email) throw new Error('Missing email'); return persist(input.email); }\nfunction persist(email:string) { return {email}; }`,
  };
  const graph = analyze({
    repository: "https://github.com/test/actual-project",
    commit: "c".repeat(40),
    files,
  });
  saveSnapshot(graph, { snapshotId: graph.snapshotId }, "", files);
  const result = await api(`/codejourneys?snapshotId=${graph.snapshotId}`);
  assert.equal(result.status, 200);
  assert(result.data.journeys.length > 0);
  assert(
    result.data.journeys.every(
      (j) =>
        j.origin === "repository" &&
        j.commit === graph.commit &&
        j.snapshotId === graph.snapshotId,
    ),
  );
  assert(
    !result.data.journeys.some((j) => j.id === "signup" || j.id === "login"),
  );
  const route = result.data.journeys.find((j) =>
    j.title.includes("POST /register"),
  );
  assert(route);
  const detail = (await api(`/codejourneys/${route.id}`)).data.journey;
  const trace = (
    await api(`/codejourneys/${route.id}/scenarios/${detail.scenarios[0].id}`)
  ).data;
  assert.equal(trace.mode, "explained_path");
  assert(trace.events.some((e) => e.source.file === "accounts.ts"));
  assert(
    trace.events.every(
      (e) => e.timestamp === null && e.observedFields === null,
    ),
  );
  assert(detail.scenarios.every((s) => !s.runRecipe && !s.failure));
  for (const path of detail.scenarios)
    for (let i = 1; i < path.path.length; i++) {
      assert(
        graph.relationships.some(
          (e) => e.source === path.path[i - 1] && e.target === path.path[i],
        ),
      );
    }
  const account = trace.events.find((e) => e.title === "createAccount");
  assert(account.condition.includes("!input.email"));
  const source = (
    await api(
      `/journey-snapshots/${graph.snapshotId}/source?referenceId=${account.sourceRefId}`,
    )
  ).data;
  assert.equal(source.excerpt, files["accounts.ts"]);
  assert(source.url.includes(graph.commit));
  const answer = await answerEventQuestion(
    trace,
    account,
    "What does this check?",
    "intermediate",
  );
  assert.equal(answer.eventId, account.id);
  assert.equal(answer.snapshotId, graph.snapshotId);
  assert(answer.answer.includes("!input.email"));
  assert.equal(
    (await api(`/codejourneys?snapshotId=${"0".repeat(24)}`)).status,
    404,
  );
});

test("repository pagination and same-line declarations preserve exact component evidence", async () => {
  const files = {
    "many.ts": Array.from(
      { length: 70 },
      (_, i) =>
        `export function task${i}(input${i}:number) { if(input${i}<${i}) return false; return true; }`,
    ).join(" "),
  };
  const graph = analyze({
    repository: "https://github.com/test/paginated-source",
    commit: "e".repeat(40),
    files,
  });
  saveSnapshot(graph, { snapshotId: graph.snapshotId }, "", files);
  const first = (
    await api(`/codejourneys?snapshotId=${graph.snapshotId}&page=1`)
  ).data;
  const second = (
    await api(`/codejourneys?snapshotId=${graph.snapshotId}&page=2`)
  ).data;
  assert.equal(first.total, 70);
  assert.equal(first.journeys.length, 60);
  assert.equal(first.hasMore, true);
  assert.equal(second.journeys.length, 10);
  assert.equal(second.hasMore, false);
  assert.equal(
    new Set([...first.journeys, ...second.journeys].map((j) => j.id)).size,
    70,
  );
  const card = [...first.journeys, ...second.journeys].find(
    (j) => j.title === "Explore task69",
  );
  const detail = (await api(`/codejourneys/${card.id}`)).data.journey;
  assert.equal(detail.events.length, 1);
  assert(detail.events[0].condition.includes("input69<69"));
  assert(!detail.events[0].condition.includes("input0"));
  assert(detail.events[0].sourceExcerpt.startsWith("export function task69"));
  assert(!detail.events[0].sourceExcerpt.includes("function task68"));
  assert.equal(
    (await api(`/codejourneys?snapshotId=${graph.snapshotId}&page=0`)).status,
    400,
  );
});

test("AI provider component explanations validate source citations, bounded sections and safe expression choices", async () => {
  const original = globalThis.fetch,
    apiKey = process.env.LLM_API_KEY;
  const trace = explainedTrace("signup", "success"),
    event = trace.events[1];
  const sections = {
    purpose: "Checks the incoming signup body.",
    inputsOutputs:
      "Declared request, response and next parameters. Runtime values are unknown.",
    conditions: "Validation failure returns before next.",
    sideEffects: "Assigns parsed data only on the supported source path.",
    nextConnections:
      "The source calls next after successful parsing; this is not a runtime capture.",
  };
  let sent;
  try {
    process.env.LLM_API_KEY = "journey-provider-test-key";
    globalThis.fetch = async (_url, options) => {
      sent = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: "The highlighted middleware validates signup input.",
                  sourceRefId: event.sourceRefId,
                  expression: "explaining",
                  sections,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    };
    const answer = await answerEventQuestion(
      trace,
      event,
      "Explain this component.",
      "beginner",
    );
    assert.equal(answer.generated, true);
    assert.equal(answer.expression, "explaining");
    assert.deepEqual(answer.sections, sections);
    assert.equal(answer.notice, "");
    const context = JSON.parse(sent.messages[1].content);
    assert.equal(context.sourceRefId, event.sourceRefId);
    assert(context.source.includes("req.body.email"));
    assert(!Object.hasOwn(context, "observedFields"));
    for (const invalid of [
      { sourceRefId: "invented", expression: "explaining" },
      {
        sourceRefId: event.sourceRefId,
        expression: "https://untrusted.example/pose.png",
      },
    ]) {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answer: "Unsupported explanation.",
                    sections,
                    ...invalid,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        );
      const fallback = await answerEventQuestion(
        trace,
        event,
        "Explain this component.",
        "advanced",
      );
      assert.equal(fallback.generated, false);
      assert.equal(fallback.expression, "questioning");
      assert(fallback.notice.includes("source-derived"));
      assert.equal(fallback.sourceRefId, event.sourceRefId);
    }
  } finally {
    globalThis.fetch = original;
    if (apiKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = apiKey;
  }
});

test("automatic summaries are three source-linked sentences and observed summaries remain owner-only", async () => {
  const trace = explainedTrace("signup", "success"),
    event = trace.events[1];
  const path = `/traces/${encodeURIComponent(trace.id)}/events/${encodeURIComponent(event.id)}/explanation`;
  const result = await api(path);
  assert.equal(result.status, 200);
  assert.equal(result.data.sentences.length, 3);
  assert.equal(result.data.componentId, event.key);
  assert.equal(result.data.sourceRefId, event.sourceRefId);
  assert.equal(result.data.sourceHash, trace.sourceHash);
  assert.equal(result.data.generated, false);
  assert.match(result.data.notice, /unavailable/);
  const observedPath = `/traces/${captured.id}/events/${encodeURIComponent(captured.events[0].id)}/explanation`;
  assert.equal((await api(observedPath)).status, 401);
  assert.equal((await api(observedPath, undefined, other.cookie)).status, 404);
  assert.equal((await api(observedPath, undefined, owner.cookie)).status, 200);
});

test("summary cache deduplicates generation and invalidates changed source, component and path context", async () => {
  const { createExplanationCache } =
    await import("../src/journeyExplanations.js");
  const trace = explainedTrace("signup", "success"),
    event = trace.events[1];
  let calls = 0,
    finish;
  const explain = createExplanationCache(async () => {
    calls++;
    if (calls === 1)
      await new Promise((resolve) => {
        finish = resolve;
      });
    return {
      generated: true,
      sentences: [
        "It checks input.",
        "It evaluates the source condition.",
        "It connects to a source operation.",
      ],
    };
  });
  const first = explain(trace, event),
    second = explain(trace, event);
  assert.equal(calls, 1);
  finish();
  assert.deepEqual(await first, await second);
  await explain(trace, event);
  assert.equal(calls, 1);
  await explain({ ...trace, sourceHash: "different-source" }, event);
  await explain({ ...trace, snapshotId: "different-snapshot" }, event);
  await explain(trace, { ...event, key: "different-component" });
  await explain(trace, event, "advanced");
  await explain(
    {
      ...trace,
      events: trace.events.map((e, i) =>
        i === 2 ? { ...e, key: "different-next" } : e,
      ),
    },
    event,
  );
  assert.equal(calls, 6);
});

test("brief AI provider replies require three bounded sentences and the selected source citation", async () => {
  const originalFetch = globalThis.fetch,
    originalKey = process.env.LLM_API_KEY;
  const trace = explainedTrace("signup", "success"),
    event = trace.events[1];
  let sentences = [
    "It checks signup input.",
    "It tests the email condition in the source.",
    "It connects the request to a possible next source operation.",
  ];
  try {
    process.env.LLM_API_KEY = "test-only-key";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: "Signup input check.",
                  sourceRefId: event.sourceRefId,
                  sentences,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    const good = await answerEventQuestion(
      trace,
      event,
      "Explain briefly.",
      "beginner",
      { brief: true },
    );
    assert.equal(good.generated, true);
    assert.deepEqual(good.sentences, sentences);
    sentences = ["Only one sentence."];
    const bad = await answerEventQuestion(
      trace,
      event,
      "Explain briefly.",
      "beginner",
      { brief: true },
    );
    assert.equal(bad.generated, false);
    assert.equal(bad.sentences, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = originalKey;
  }
});

test("source-only explanations describe actual parameters, conditions, returns and route handlers", async () => {
  const { createExplanationCache } =
    await import("../src/journeyExplanations.js");
  const { repositoryJourneys } = await import("../src/repositoryJourneys.js");
  const files = {
    "calc.ts":
      "export function total(price: number, tax: number) { if (price < 0) return 0; return price + tax; }\nexport function double(value: number) { return value * 2; }",
    "routes.ts":
      "import express from 'express'; const app = express(); app.get('/health', health); function health(req,res) { return res.json({ok:true}); }",
  };
  const graph = analyze({
    repository: "https://github.com/test/explanations",
    commit: "e".repeat(40),
    files,
  });
  saveSnapshot(graph, { snapshotId: graph.snapshotId }, "", files);
  const explain = createExplanationCache(async () => ({
    generated: false,
    expression: "explaining",
  }));
  const journeys = repositoryJourneys(graph.snapshotId);
  for (const [name, expected] of [
    ["total", /price < 0/],
    ["double", /value \* 2/],
    ["GET \/health", /request handler/],
  ]) {
    const journey = journeys.find((j) => j.events[0].title === name);
    assert(journey, name);
    const trace = explainedTrace(journey.id, journey.scenarios[0].id);
    const result = await explain(trace, trace.events[0]);
    assert.equal(result.generated, false);
    assert.equal(result.sentences.length, 3);
    assert.match(result.sentences.join(" "), expected);
    assert.match(
      result.sentences.join(" "),
      /unknown|not observed|does not prove|does not establish/,
    );
    if (name === "total")
      assert.match(result.sentences[0], /price: number, tax: number/);
  }
});

test("source-only question replies focus on the question, resolve names and do not invent design intent", async () => {
  const { sourceQuestionGuidance } =
    await import("../src/journeySourceGuidance.js");
  const event = {
    id: "event",
    key: "c1",
    title: "createBuild",
    kind: "function_call",
    inputs: "Declared parameters: req, res. Runtime values: unknown.",
    outputs:
      "Source return expressions: res.json(result). Runtime result: unknown.",
    condition:
      'Source conditions (not evaluated): typeof req.body.repoUrl !== "string"',
    connections: [{ type: "calls", target: "c2" }],
  };
  const next = { id: "next", key: "c2", title: "buildRepository" };
  const trace = { mode: "explained_path", events: [event, next] },
    journey = { events: [event, next] };
  const checks = sourceQuestionGuidance(
    trace,
    event,
    journey,
    "What should I check before changing this?",
  );
  assert.match(checks.answer, /typeof req.body.repoUrl/);
  assert.match(checks.answer, /res.json\(result\)/);
  assert(!checks.answer.includes("Only this event"));
  const connections = sourceQuestionGuidance(
    trace,
    event,
    journey,
    "What does this call?",
  );
  assert.match(connections.answer, /buildRepository/);
  assert(!connections.answer.includes("→ c2"));
  const why = sourceQuestionGuidance(
    trace,
    event,
    journey,
    "Why was it designed this way?",
  );
  assert.match(why.answer, /does not establish/);
  assert.match(why.answer, /unknown/);
});

test("expanded route walkthrough describes linked handler facts and cites their own source", async () => {
  const { sourceWalkthrough } = await import("../src/journeyWalkthrough.js");
  const route = {
    id: "route",
    key: "r",
    title: "POST /",
    kind: "http_request",
    sourceRefId: "route-ref",
    connections: [{ type: "handles_route", target: "handler" }],
  };
  const handler = {
    id: "handler-event",
    key: "handler",
    title: "createBuild",
    sourceRefId: "handler-ref",
    inputs: "Declared parameters: req, res. Runtime values: unknown.",
    outputs:
      "Source return expressions: res.json(result). Runtime result: unknown.",
    condition:
      'Source conditions (not evaluated): typeof req.body.repoUrl !== "string"',
    connections: [{ type: "calls", target: "build" }],
  };
  const helper = { key: "build", title: "buildRepository" };
  const trace = { mode: "explained_path", events: [route, handler, helper] };
  const steps = sourceWalkthrough(trace, route, { events: trace.events });
  assert.equal(steps.length, 7);
  assert.equal(steps[0].sourceRefId, "route-ref");
  for (const title of [
    "Declared inputs",
    "Validation and decisions",
    "Calls and delegation",
    "Return or response",
  ]) {
    const step = steps.find((s) => s.title === title);
    assert(step, title);
    assert.equal(step.sourceRefId, "handler-ref");
  }
  assert.match(steps.map((s) => s.explanation).join(" "), /repoUrl/);
  assert.match(steps.map((s) => s.explanation).join(" "), /buildRepository/);
});

test("AI walkthrough rejects fabricated per-step source citations", async () => {
  const original = globalThis.fetch,
    key = process.env.LLM_API_KEY;
  const trace = explainedTrace("signup", "success"),
    event = trace.events[1];
  let ref = event.sourceRefId;
  try {
    process.env.LLM_API_KEY = "test-only-key";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: "Source explanation.",
                  sourceRefId: event.sourceRefId,
                  sentences: [
                    "Input validation.",
                    "Source condition.",
                    "Next connection.",
                  ],
                  steps: [
                    {
                      title: "Input",
                      explanation: "This step checks the request input.",
                      sourceRefId: ref,
                    },
                    {
                      title: "Condition",
                      explanation:
                        "The source condition controls the available paths.",
                      sourceRefId: event.sourceRefId,
                    },
                    {
                      title: "Evidence",
                      explanation: "Runtime outcomes remain unknown.",
                      sourceRefId: event.sourceRefId,
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    const good = await answerEventQuestion(
      trace,
      event,
      "Explain the implementation.",
      "beginner",
      { brief: true, walkthrough: true },
    );
    assert.equal(good.generated, true);
    assert.equal(good.steps.length, 3);
    ref = "fabricated-ref";
    const bad = await answerEventQuestion(
      trace,
      event,
      "Explain the implementation.",
      "beginner",
      { brief: true, walkthrough: true },
    );
    assert.equal(bad.generated, false);
    assert.equal(bad.steps, undefined);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
  }
});

function fakeWalkthroughResponse(context) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    answer: "The selected component uses the recorded source contract.",
    sourceRefId: context.sourceRefId,
    sentences: ["It receives the declared inputs.", "It follows the recorded source conditions.", "It connects to the next source operation."],
    steps: [
      { title: "Inputs", explanation: "Inspect the declared inputs in the selected source.", sourceRefId: context.sourceRefId },
      { title: "Conditions", explanation: "Inspect the recorded conditions before assuming their outcome.", sourceRefId: context.sourceRefId },
      { title: "Connections", explanation: "Follow the linked source operation without assuming runtime order.", sourceRefId: context.sourceRefId },
    ],
  }) } }] }));
}

test("automatic journey generation already coalesces overlapping steps and isolates levels and observed traces", async () => {
  const { createExplanationCache } = await import("../src/journeyExplanations.js");
  const explain = createExplanationCache();
  const trace = explainedTrace("signup", "success");
  const firstEvent = trace.events[1], nextEvent = trace.events[2];
  const original = globalThis.fetch, key = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = "mock-key";
  let calls = 0, release, started;
  const firstStarted = new Promise((resolve) => { started = resolve; });
  globalThis.fetch = async (_url, options) => {
    calls++;
    const context = JSON.parse(JSON.parse(options.body).messages[1].content);
    if (calls === 1) await new Promise((resolve) => { release = resolve; started(); });
    return fakeWalkthroughResponse(context);
  };
  try {
    const first = explain(trace, firstEvent), duplicate = explain(trace, firstEvent);
    await firstStarted;
    assert.equal(calls, 1);
    const next = await explain(trace, nextEvent);
    assert.equal(next.generated, true);
    assert.equal(next.eventId, nextEvent.id);
    assert.equal(next.sourceRefId, nextEvent.sourceRefId);
    assert.equal(calls, 2, "a different uncached step must generate normally");
    release();
    const [a, b] = await Promise.all([first, duplicate]);
    assert.equal(a.generated, true);
    assert.deepEqual(a, b);
    assert.equal(a.eventId, firstEvent.id);
    assert.equal(a.sentences.length, 3);
    assert(a.steps.every((step) => a.sourceReferences.some((reference) => reference.sourceRefId === step.sourceRefId)));
    for (const event of [firstEvent, nextEvent, firstEvent]) await explain(trace, event);
    assert.equal(calls, 2, "overlapping and repeated visits must add zero provider calls");
    await explain(trace, firstEvent, "advanced");
    assert.equal(calls, 3);
    const observedA = { ...trace, mode: "observed_replay", id: "observed-generation-a" };
    const observedB = { ...observedA, id: "observed-generation-b" };
    assert.equal((await explain(observedA, firstEvent)).traceId, observedA.id);
    assert.equal((await explain(observedB, firstEvent)).traceId, observedB.id);
    assert.equal(calls, 5, "observed traces must generate independently");
    assert.equal((await explain(observedA, firstEvent)).traceId, observedA.id);
    assert.equal(calls, 5);
  } finally {
    release?.();
    globalThis.fetch = original;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
  }
});

test("automatic journey missing-key and provider-error fallbacks retain their short retry window", async () => {
  const { createExplanationCache } = await import("../src/journeyExplanations.js");
  const explain = createExplanationCache();
  const trace = explainedTrace("signup", "success"), event = trace.events[1];
  const original = globalThis.fetch, key = process.env.LLM_API_KEY, originalNow = Date.now;
  let time = originalNow(), calls = 0, failing = true;
  Date.now = () => time;
  globalThis.fetch = async (_url, options) => {
    calls++;
    if (failing) return new Response("Unauthorized", { status: 401 });
    return fakeWalkthroughResponse(JSON.parse(JSON.parse(options.body).messages[1].content));
  };
  try {
    delete process.env.LLM_API_KEY;
    const offline = await explain(trace, event);
    assert.equal(offline.generated, false);
    assert.equal(offline.sentences.length, 3);
    assert.match(offline.notice, /unavailable/);
    assert.equal(calls, 0);
    process.env.LLM_API_KEY = "mock-key";
    time += 20001;
    assert.equal((await explain(trace, event)).generated, false);
    assert.equal(calls, 1);
    assert.equal((await explain(trace, event)).generated, false);
    assert.equal(calls, 1, "the existing short fallback cache prevents immediate repeated failures");
    failing = false;
    time += 20001;
    assert.equal((await explain(trace, event)).generated, true);
    assert.equal(calls, 2, "generation can recover after the existing retry window");
    assert.equal((await explain(trace, event)).generated, true);
    assert.equal(calls, 2);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = original;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
  }
});

function completeExplanation(trace, event) {
  return {
    generated: true, expression: "explaining",
    sentences: ["It receives declared inputs.", "It evaluates source conditions.", "It connects to a source operation."],
    steps: ["Inputs", "Conditions", "Connections"].map((title) => ({
      title, explanation: "Inspect this part of the saved implementation.", sourceRefId: event.sourceRefId,
    })),
    sourceReferences: [{ sourceRefId: event.sourceRefId, title: event.title, ...event.source }],
    eventId: event.id, traceId: trace.id, sourceRefId: event.sourceRefId, snapshotId: trace.snapshotId,
  };
}

test("successful explanations survive new cache instances and the old memory TTL", async () => {
  const { createExplanationCache } = await import("../src/journeyExplanations.js");
  const trace = explainedTrace("signup", "success"), event = trace.events[1];
  let calls = 0;
  const generate = async (trace, event) => { calls++; return completeExplanation(trace, event); };
  const explain = createExplanationCache(generate);
  const first = await explain(trace, event);
  assert.equal(calls, 1);
  assert.deepEqual(await explain(trace, event), first);
  assert.equal(calls, 1);
  assert.deepEqual(await createExplanationCache(generate)(trace, event), first);
  assert.equal(calls, 1, "recreating the cache must add zero generation calls");
  const originalNow = Date.now;
  Date.now = () => originalNow() + 3600001;
  try { assert.deepEqual(await explain(trace, event), first); }
  finally { Date.now = originalNow; }
  assert.equal(calls, 1, "successful durable artifacts must survive the old one-hour TTL");
  const rebound = { ...trace, id: "compatible-explained-trace", events: trace.events.map((item) => ({ ...item, id: `new-${item.id}` })) };
  const result = await createExplanationCache(generate)(rebound, rebound.events[1]);
  assert.equal(calls, 1);
  assert.equal(result.traceId, rebound.id);
  assert.equal(result.eventId, rebound.events[1].id);
  assert.equal(result.sourceRefId, event.sourceRefId);
  assert.deepEqual(result.steps, first.steps);
});

test("durable cache rejects corrupt or stale citation artifacts and safely regenerates", async () => {
  const { createExplanationCache } = await import("../src/journeyExplanations.js");
  const trace = explainedTrace("signup", "success"), event = trace.events[1];
  let calls = 0;
  const generate = async (trace, event) => { calls++; return completeExplanation(trace, event); };
  for (const defect of ["step", "reference", "coordinates", "incomplete", "json", "identity"]) {
    db.exec("DELETE FROM journey_explanation_artifacts");
    await createExplanationCache(generate)(trace, event);
    const row = db.prepare("SELECT * FROM journey_explanation_artifacts").get();
    const stored = JSON.parse(row.data);
    if (defect === "step") stored.value.steps[0].sourceRefId = "unrelated-step";
    if (defect === "reference") stored.value.sourceReferences[0].sourceRefId = "unrelated-reference";
    if (defect === "coordinates") stored.value.sourceReferences[0].startLine++;
    if (defect === "incomplete") stored.value.sentences.pop();
    if (defect === "identity") stored.key = "another-cache-identity";
    db.prepare("UPDATE journey_explanation_artifacts SET data=? WHERE cache_key=?")
      .run(defect === "json" ? "invalid JSON" : JSON.stringify(stored), row.cache_key);
    const before = calls;
    const result = await createExplanationCache(generate)(trace, event);
    assert.equal(calls, before + 1, defect);
    assert.equal(result.generated, true);
    assert(result.steps.every((step) => step.sourceRefId === event.sourceRefId));
    await createExplanationCache(generate)(trace, event);
    assert.equal(calls, before + 1, `${defect} regeneration must leave a valid artifact`);
  }
});

test("incomplete successes, fallback replies and failures never persist", async () => {
  const { createExplanationCache } = await import("../src/journeyExplanations.js");
  const trace = explainedTrace("signup", "success"), event = trace.events[1];
  for (const defect of ["sentences", "steps", "sourceReferences", "citation", "credential", "fallback", "failure"]) {
    let calls = 0;
    const generate = async () => {
      calls++;
      if (defect === "failure") throw new Error("provider failed");
      const result = completeExplanation(trace, event);
      if (["sentences", "steps", "sourceReferences"].includes(defect)) delete result[defect];
      if (defect === "citation") result.steps[0].sourceRefId = "fabricated";
      if (defect === "credential") result.sentences[0] = "sk-abcdefghijklmnopqrstuvwxyz123456";
      if (defect === "fallback") result.generated = false;
      return result;
    };
    for (let i = 0; i < 2; i++) {
      if (defect === "failure") await assert.rejects(createExplanationCache(generate)(trace, event), /provider failed/);
      else await createExplanationCache(generate)(trace, event);
    }
    assert.equal(calls, 2, `${defect} must not be reused by a fresh cache instance`);
    assert.equal(db.prepare("SELECT count(*) AS n FROM journey_explanation_artifacts").get().n, 0);
  }
});

test("persisted observed artifacts remain trace-scoped and authorization precedes cache access", async () => {
  const { createExplanationCache } = await import("../src/journeyExplanations.js");
  const a = saveObservedRun(journey, scenario, contractFixture(), owner.data.user.id);
  const b = saveObservedRun(journey, scenario, contractFixture(), owner.data.user.id);
  let calls = 0;
  const generate = async (trace, event) => { calls++; return completeExplanation(trace, event); };
  await createExplanationCache(generate)(a, a.events[0], "advanced");
  await createExplanationCache(generate)(b, b.events[0], "advanced");
  assert.equal(calls, 2);
  await createExplanationCache(generate)(a, a.events[0], "advanced");
  assert.equal(calls, 2);
  const path = `/traces/${a.id}/events/${encodeURIComponent(a.events[0].id)}/explanation?level=advanced`;
  const prepare = db.prepare;
  let reads = 0;
  db.prepare = function (sql, ...args) {
    if (/SELECT.*journey_explanation_artifacts/i.test(sql)) reads++;
    return prepare.call(this, sql, ...args);
  };
  try {
    assert.equal((await api(path)).status, 401);
    assert.equal((await api(path, undefined, other.cookie)).status, 404);
    assert.equal(reads, 0, "denied callers must never reach artifact reads");
    const response = await api(path, undefined, owner.cookie);
    assert.equal(response.status, 200);
    assert.equal(response.data.generated, true);
    assert.equal(response.data.traceId, a.id);
    assert(reads > 0);
  } finally { db.prepare = prepare; }
});

test("successful explanations survive a real backend-process restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "journey-artifact-"));
  const database = join(directory, "artifacts.sqlite");
  const script = `
    const { explainedTrace } = await import('./src/journeyService.js');
    const { createExplanationCache } = await import('./src/journeyExplanations.js');
    const { db } = await import('./src/journeyStorage.js');
    const trace = explainedTrace('signup', 'success');
    let calls = 0;
    const result = await createExplanationCache(async (trace, event) => {
      calls++;
      return (${completeExplanation.toString()})(trace, event);
    })(trace, trace.events[1]);
    console.log(JSON.stringify({calls,result}));
    db.close();
  `;
  try {
    const run = () => {
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: new URL("..", import.meta.url), env: { ...process.env, DATABASE_PATH: database },
        encoding: "utf8", timeout: 15000,
      });
      assert.equal(child.status, 0, child.stderr);
      return JSON.parse(child.stdout);
    };
    const cold = run(), warm = run();
    assert.equal(cold.calls, 1);
    assert.equal(warm.calls, 0);
    assert.deepEqual(warm.result, cold.result);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("durable identities miss changed source, component, level, evidence and path context", async () => {
  const { createExplanationCache } = await import("../src/journeyExplanations.js");
  const trace = explainedTrace("signup", "success"), event = trace.events[1];
  let calls = 0;
  const generate = async (trace, event) => { calls++; return completeExplanation(trace, event); };
  await createExplanationCache(generate)(trace, event);
  const variants = [
    [{ ...trace, sourceHash: "changed-source" }, event, "beginner"],
    [trace, trace.events[2], "beginner"],
    [trace, event, "advanced"],
    [{ ...trace, events: trace.events.map((item, i) => i === 2 ? { ...item, key: "different-next" } : item) }, event, "beginner"],
    [{ ...trace, events: trace.events.map((item, i) => i === 0 ? { ...item, title: "Different previous context" } : item) }, event, "beginner"],
  ];
  for (const args of variants) {
    const before = calls;
    await createExplanationCache(generate)(...args);
    assert.equal(calls, before + 1);
  }
  const row = db.prepare("SELECT data FROM runtime_recipe_sources WHERE snapshot_id=?").get(trace.snapshotId);
  const changed = JSON.parse(row.data);
  changed.source += "\n// changed captured source";
  db.prepare("UPDATE runtime_recipe_sources SET data=? WHERE snapshot_id=?").run(JSON.stringify(changed), trace.snapshotId);
  try {
    const before = calls;
    await createExplanationCache(generate)(trace, event);
    assert.equal(calls, before + 1, "captured evidence changes must not hit even if metadata hash was not updated");
  } finally { db.prepare("UPDATE runtime_recipe_sources SET data=? WHERE snapshot_id=?").run(row.data, trace.snapshotId); }
});

test("persistent route walkthroughs preserve separate handler citations when anchors rebind", async () => {
  const { createExplanationCache } = await import("../src/journeyExplanations.js");
  const { repositoryJourneys } = await import("../src/repositoryJourneys.js");
  const { savedJourney } = await import("../src/journeyService.js");
  const { walkthroughEvidence } = await import("../src/journeyWalkthrough.js");
  const files = {
    "routes.ts": "import express from 'express'; import { handler } from './handler'; const app=express(); app.get('/value', handler);",
    "handler.ts": "export function handler(req,res) { return res.json({value:1}); }",
  };
  const graph = analyze({ repository: "https://github.com/test/durable-walkthrough", commit: "9".repeat(40), files });
  saveSnapshot(graph, {}, "", files);
  const route = repositoryJourneys(graph.snapshotId).find((item) => item.events[0].kind === "http_request");
  assert(route);
  const trace = explainedTrace(route.id, route.scenarios[0].id), event = trace.events[0];
  const evidence = walkthroughEvidence(savedJourney(trace.snapshotId, trace.journeyId), event);
  assert(evidence.length > 1);
  let calls = 0;
  const generate = async (trace, event) => {
    calls++;
    const result = completeExplanation(trace, event);
    result.sourceReferences = evidence.map((item) => ({ sourceRefId: item.sourceRefId, title: item.title, ...item.source }));
    result.steps[1].sourceRefId = evidence[1].sourceRefId;
    return result;
  };
  const first = await createExplanationCache(generate)(trace, event);
  const rebound = { ...trace, id: "another-compatible-route", events: trace.events.map((item) => ({ ...item, id: `new-${item.id}` })) };
  const second = await createExplanationCache(generate)(rebound, rebound.events[0]);
  assert.equal(calls, 1);
  assert.equal(second.traceId, rebound.id);
  assert.equal(second.eventId, rebound.events[0].id);
  assert.deepEqual(second.steps, first.steps);
  assert.equal(second.steps[1].sourceRefId, evidence[1].sourceRefId);
  assert.notEqual(second.steps[1].sourceRefId, event.sourceRefId);
});

test("bounded artifact retention never deletes trace history, source or progress", async () => {
  const { createExplanationCache } = await import("../src/journeyExplanations.js");
  const tracesBefore = db.prepare("SELECT count(*) AS n FROM runtime_traces").get().n;
  const sourcesBefore = db.prepare("SELECT count(*) AS n FROM runtime_recipe_sources").get().n;
  const progressBefore = db.prepare("SELECT count(*) AS n FROM playback_checkpoints").get().n;
  let calls = 0, last;
  const generate = async (trace, event) => { calls++; return completeExplanation(trace, event); };
  const explain = createExplanationCache(generate);
  for (let i = 0; i < 201; i++) {
    last = saveObservedRun(journey, scenario, contractFixture(), owner.data.user.id);
    await explain(last, last.events[0]);
  }
  assert.equal(calls, 201);
  assert.equal(db.prepare("SELECT count(*) AS n FROM journey_explanation_artifacts").get().n, 200);
  assert.equal(db.prepare("SELECT count(*) AS n FROM runtime_traces").get().n, tracesBefore + 201);
  assert.equal(db.prepare("SELECT count(*) AS n FROM runtime_recipe_sources").get().n, sourcesBefore);
  assert.equal(db.prepare("SELECT count(*) AS n FROM playback_checkpoints").get().n, progressBefore);
  await createExplanationCache(generate)(last, last.events[0]);
  assert.equal(calls, 201);
});

test("optional artifact write failure does not lose the generated response or poison future retries", async () => {
  const { createExplanationCache } = await import("../src/journeyExplanations.js");
  const trace = explainedTrace("signup", "success"), event = trace.events[1];
  let calls = 0;
  const generate = async (trace, event) => { calls++; return completeExplanation(trace, event); };
  db.exec("CREATE TEMP TRIGGER fail_explanation_write BEFORE INSERT ON journey_explanation_artifacts BEGIN SELECT RAISE(ABORT,'simulated cache write failure'); END;");
  try {
    assert.equal((await createExplanationCache(generate)(trace, event)).generated, true);
    assert.equal(db.prepare("SELECT count(*) AS n FROM journey_explanation_artifacts").get().n, 0);
  } finally { db.exec("DROP TRIGGER fail_explanation_write"); }
  assert.equal((await createExplanationCache(generate)(trace, event)).generated, true);
  await createExplanationCache(generate)(trace, event);
  assert.equal(calls, 2);
});
