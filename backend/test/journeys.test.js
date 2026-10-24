import test, { after } from "node:test";
import assert from "node:assert/strict";
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
