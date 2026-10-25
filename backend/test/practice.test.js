import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATABASE_PATH = ":memory:";
const { db, saveSnapshot } = await import("../src/storage.js");
const { analyze } = await import("../src/analyzer.js");
const { checkDraft, listPracticeTasks } = await import("../src/practice.js");
const { generationUsage } = await import("../src/generationAccounting.js");
const { practiceRoutes } = await import("../src/practiceRoutes.js");

const app = express();
app.use(express.json());
app.use("/api/practice", practiceRoutes);
app.use((error, _req, res, _next) =>
  res.status(error.status || (error.name === "ZodError" ? 400 : 500)).json({
    error: error.name === "ZodError" ? "Invalid request data" : error.message,
  }),
);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
after(() => new Promise((resolve) => server.close(resolve)));
const base = `http://127.0.0.1:${server.address().port}/api/practice`;
const learnerId = randomUUID();
const files = {
  "src/users.ts": `export function findUser(email: string) {
  return email.trim();
}
export function createUser(email: string) {
  return findUser(email);
}
`,
  "src/routes.ts": `import { createUser } from './users';
export function register(email: string) {
  return createUser(email);
}
`,
};
const graph = analyze({
  repository: "https://github.com/example/practice",
  commit: "b".repeat(40),
  branch: "main",
  files,
});
saveSnapshot(graph, { snapshotId: graph.snapshotId }, "", files);

async function api(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

const requestContext = {
  snapshotId: graph.snapshotId,
  learnerId,
  difficulty: "beginner",
  context: {
    goal: "contribute",
    profile: "beginner",
    journey: "signup",
    studiedConcepts: ["validation"],
  },
};
process.env.LLM_API_KEY = "practice-test-key";
process.env.LLM_MODEL = "practice-test-model";
const originalFetch = globalThis.fetch;

function generatedTasks(snapshot = graph) {
  return {
    tasks: snapshot.components
      .filter((component) =>
        snapshot.references.some(
          (reference) =>
            reference.id === component.referenceId &&
            reference.snapshotId === snapshot.snapshotId,
        ),
      )
      .slice(0, 3)
      .map((component, index) => ({
        title: [
          "Normalize email input before account lookup",
          "Return a typed result for an unknown account",
          "Add a registration test for whitespace input",
        ][index],
        objective:
          "Update the actual account-registration behavior so whitespace-only or padded email input is handled consistently before the repository lookup.",
        whyItMatters:
          "This repository currently passes user input across the registration flow and should make that boundary behavior explicit.",
        acceptanceCriteria: [
          "Normalize leading and trailing whitespace before lookup.",
          "Preserve the existing return contract for valid email input.",
        ],
        componentId: component.id,
        referenceIds: [component.referenceId],
        firstHint:
          "Trace where the email value enters this function and where it is first used.",
      })),
  };
}

async function withGeneratedResponse(content, callback, usage) {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/chat/completions")) {
      requests.push(JSON.parse(options.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(content) } }],
          ...(usage ? { usage } : {}),
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(url, options);
  };
  try {
    return await callback(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function rangeFixture(newline = "\n", body = '  return "selected implementation";') {
  const source = [
    ...Array(150).fill('// irrelevant prefix padding'),
    'export function repeated() { return "wrong same-name body"; }',
    ...Array(7).fill(''),
    '// selected neighboring context',
    'export function repeated() {',
    body,
    '}',
    ...Array(8).fill(''),
    'export function other() { return "other implementation"; }',
  ].join(newline);
  const files = { "src/ranges.ts": source };
  const snapshot = analyze({
    repository: `https://github.com/example/ranges-${randomUUID()}`,
    commit: "d".repeat(40), branch: "main", files,
  });
  return { snapshot, files, source };
}

test("late declarations reach the provider with exact citations and full editable source", async () => {
  for (const newline of ["\n", "\r\n"]) {
    const { snapshot, files, source } = rangeFixture(newline,
      '  const apiKey = "sk-abcdefghijklmnopqrstuvwxyz123456";\n  return "selected implementation";'.replaceAll("\n", newline));
    saveSnapshot(snapshot, { snapshotId: snapshot.snapshotId }, "", files);
    const selected = snapshot.references.find((ref) => /^export function repeated\(\) \{\r?\n/.test(ref.excerpt));
    assert(source.indexOf("selected implementation") > 3000);
    await withGeneratedResponse(generatedTasks(snapshot), async (requests) => {
      const response = await api("/tasks", { ...requestContext, snapshotId: snapshot.snapshotId });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(requests.length, 1);
      const context = JSON.parse(requests[0].messages[1].content);
      const supplied = context.components.find((item) => item.referenceId === selected.id);
      assert.match(supplied.excerpt, /selected implementation/);
      assert.match(supplied.excerpt, /selected neighboring context/);
      assert.doesNotMatch(supplied.excerpt, /irrelevant prefix|wrong same-name body|sk-abcdefghijklmnopqrstuvwxyz123456/);
      assert(supplied.excerpt.length <= 3000);
      assert.equal(supplied.startLine, selected.startLine);
      const task = response.body.tasks.find((item) => item.evidence.referenceId === selected.id);
      assert.equal(task.startingCode, source);
      assert.deepEqual(task.citations[0], {
        snapshotId: snapshot.snapshotId, referenceId: selected.id,
        file: selected.file, startLine: selected.startLine, endLine: selected.endLine,
        excerpt: selected.excerpt, url: selected.url,
      });
      const unchanged = await api("/attempts", { learnerId, taskId: task.id, code: source });
      assert.equal(unchanged.status, 400);
      const edited = await api("/attempts", { learnerId, taskId: task.id, code: `${source}\n// edit` });
      assert.equal(edited.status, 201);
      assert.equal(edited.body.verification.status, "passed");
    });
  }
});

test("invalid and stale ranges use labelled stored evidence rather than unrelated source", async () => {
  for (const range of [
    { startLine: 0, endLine: 2 }, { startLine: 9999, endLine: 10000 },
    { startLine: 2, endLine: 1 }, { startLine: 1.5, endLine: 3 },
    { startLine: undefined, endLine: undefined }, { startLine: 1, endLine: 3 },
    null, // Same coordinates, but captured source has changed.
  ]) {
    const { snapshot, files } = rangeFixture();
    const selected = snapshot.references.find((ref) => /^export function repeated\(\) \{\r?\n/.test(ref.excerpt));
    if (range) Object.assign(selected, range);
    else files["src/ranges.ts"] = files["src/ranges.ts"].replace("selected implementation", "changed implementation");
    saveSnapshot(snapshot, { snapshotId: snapshot.snapshotId }, "", files);
    await withGeneratedResponse(generatedTasks(snapshot), async (requests) => {
      const response = await api("/tasks", { ...requestContext, snapshotId: snapshot.snapshotId });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const supplied = JSON.parse(requests[0].messages[1].content).components.find((item) => item.referenceId === selected.id);
      assert.match(supplied.excerpt, /stored reference excerpt/i);
      assert.match(supplied.excerpt, /selected implementation/);
      assert.doesNotMatch(supplied.excerpt, /irrelevant prefix|wrong same-name body/);
      assert(supplied.excerpt.length <= 3000);
    });
  }
});

test("oversized declarations are bounded and explicitly marked as truncated", async () => {
  const { snapshot, files } = rangeFixture("\n", `  // ${"body padding ".repeat(300)}\n  return "selected implementation";`);
  saveSnapshot(snapshot, { snapshotId: snapshot.snapshotId }, "", files);
  const selected = snapshot.references.find((ref) => /^export function repeated\(\) \{\r?\n/.test(ref.excerpt));
  await withGeneratedResponse(generatedTasks(snapshot), async (requests) => {
    const response = await api("/tasks", { ...requestContext, snapshotId: snapshot.snapshotId });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const supplied = JSON.parse(requests[0].messages[1].content).components.find((item) => item.referenceId === selected.id);
    assert.match(supplied.excerpt, /export function repeated/);
    assert.match(supplied.excerpt, /truncated/i);
    assert.doesNotMatch(supplied.excerpt, /irrelevant prefix|wrong same-name body/);
    assert(supplied.excerpt.length <= 3000);
  });
});

test("draft checks validate syntax only for JavaScript and TypeScript without execution", () => {
  assert.deepEqual(checkDraft("export const value = 1;", "src/value.ts"), {
    status: "passed",
    errors: [],
    checks: ["syntax"],
  });
  assert.equal(
    checkDraft("export function {", "src/value.ts").status,
    "failed",
  );
  const syntacticallyValidTypeMismatch = checkDraft(
    'const amount: number = "not a number";',
    "src/value.ts",
  );
  assert.equal(syntacticallyValidTypeMismatch.status, "passed");
  assert.deepEqual(syntacticallyValidTypeMismatch.checks, ["syntax"]);
  assert.equal(
    checkDraft("export const value = 1;", "src/value.js").checks.length,
    1,
  );
  assert.equal(checkDraft("source", "README.md").status, "unavailable");
  assert.equal(checkDraft("x".repeat(20001), "src/value.js").status, "failed");
});

test("task API asks the LLM for specific repo work and validates snapshot citations", async () => {
  await withGeneratedResponse(generatedTasks(), async (requests) => {
    const response = await api("/tasks", requestContext);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.snapshotId, graph.snapshotId);
    assert.equal(response.body.commit, graph.commit);
    assert.equal(response.body.tasks.length, 3);
    assert.equal(
      response.body.tasks[0].title,
      "Normalize email input before account lookup",
    );
    assert(response.body.tasks.every((task) => task.difficulty === "beginner"));
    assert(
      response.body.tasks.every((task) =>
        task.evidence.url.includes(graph.commit),
      ),
    );
    assert(requests.length === 1);
    assert.match(
      requests[0].messages[0].content,
      /genuinely useful, concrete coding tasks/,
    );
    const promptContext = JSON.parse(requests[0].messages[1].content);
    assert.equal(promptContext.learner.journey, "signup");
    assert(
      promptContext.components.some((component) =>
        component.excerpt.includes("createUser"),
      ),
    );
  });
  await withGeneratedResponse(generatedTasks(), async () => {
    const advanced = await api("/tasks", {
      ...requestContext,
      difficulty: "advanced",
    });
    assert.equal(advanced.status, 200);
    assert(advanced.body.tasks.every((task) => task.difficulty === "advanced"));
  });
});

test("LLM-generated attempts retain bounded syntax-only outcomes and history", async () => {
  await withGeneratedResponse(generatedTasks(), async () => {
    const tasks = await api("/tasks", requestContext);
    const task = tasks.body.tasks[0];
    const edited = `${task.startingCode}\n// learner contribution draft`;
    const passed = await api("/attempts", {
      learnerId,
      taskId: task.id,
      code: edited,
      reflection: "I preserved the existing contract.",
    });
    assert.equal(passed.status, 201);
    assert.equal(passed.body.verification.status, "passed");
    assert.equal(passed.body.verification.runtimeTestsExecuted, false);
    assert.equal(passed.body.verification.scope, "syntax-only");
    assert.match(passed.body.verification.message, /syntax check passed/i);
    const failed = await api("/attempts", {
      learnerId,
      taskId: task.id,
      code: `${task.startingCode}\nexport function {`,
      reflection: "",
    });
    assert.equal(failed.body.verification.status, "failed");
    const history = await api(
      `/attempts?learnerId=${learnerId}&snapshotId=${graph.snapshotId}`,
    );
    assert.equal(history.status, 200);
    assert.equal(history.body.attempts.length, 2);
    assert(
      ["passed", "failed"].includes(
        history.body.attempts[0].verificationStatus,
      ),
    );
    assert(Array.isArray(history.body.attempts[0].verificationErrors));
  });
});

test("journey quiz works without an LLM, varies questions, and schedules concept review", async () => {
  const key = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  const journeyRequest = {
    learnerId,
    difficulty: "beginner",
    context: requestContext.context,
  };
  const created = await api("/quizzes/sessions", journeyRequest);
  assert.equal(created.status, 201);
  assert.equal(created.body.questions.length, 5);
  assert.match(created.body.message, /no repository or AI provider/i);
  const nextUnansweredSession = await api(
    "/quizzes/sessions",
    journeyRequest,
  );
  assert.equal(nextUnansweredSession.status, 201);
  assert.equal(
    new Set([
      ...created.body.questions.map((item) => item.id),
      ...nextUnansweredSession.body.questions.map((item) => item.id),
    ]).size,
    10,
    "the two most recent beginner sessions should not repeat questions",
  );
  const question = created.body.questions[0];
  assert.equal("correctOption" in question, false);
  assert.equal("explanation" in question, false);
  assert(["coding_practice", "collaboration"].includes(question.category));
  assert(!/which source file|what file|what role/i.test(question.prompt));
  const response = await api(`/quizzes/sessions/${created.body.id}/answers`, {
    learnerId,
    questionId: question.id,
    optionId: question.options[0].id,
  });
  assert.equal(response.status, 200);
  assert.equal(typeof response.body.explanation, "string");
  assert.equal(typeof response.body.correct, "boolean");
  const duplicate = await api(`/quizzes/sessions/${created.body.id}/answers`, {
    learnerId,
    questionId: question.id,
    optionId: question.options[0].id,
  });
  assert.equal(duplicate.status, 409);
  const progress = db
    .prepare(
      "SELECT attempts,correct,due_at FROM practice_quiz_concepts WHERE learner_id=? AND snapshot_id=?",
    )
    .get(learnerId, "learning-journey");
  assert.equal(progress.attempts, 1);
  assert(progress.due_at);
  const nextSession = await api("/quizzes/sessions", journeyRequest);
  assert.equal(nextSession.status, 201);
  assert(
    nextSession.body.questions.some(
      (candidate) => candidate.id !== question.id,
    ),
    "a review should introduce an unanswered question when the bank has one",
  );
  process.env.LLM_API_KEY = key;
});

test("LLM generation fails explicitly when disabled and rejects fabricated citations", async () => {
  const uncachedRequest = { ...requestContext, context: { lesson: "generation-failure" } };
  const key = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  const unavailable = await api("/tasks", uncachedRequest);
  assert.equal(unavailable.status, 503);
  process.env.LLM_API_KEY = key;
  const badResponse = generatedTasks();
  badResponse.tasks[0].referenceIds = ["fabricated-reference"];
  await withGeneratedResponse(badResponse, async () => {
    const invalid = await api("/tasks", uncachedRequest);
    assert.equal(invalid.status, 502);
    assert.match(invalid.body.error, /invalid source citations/i);
  });
});

test("durable banks reuse exact tasks across learners and preserve private attempts", async () => {
  const { snapshot, files } = rangeFixture();
  saveSnapshot(snapshot, {}, "", files);
  const request = { ...requestContext, snapshotId: snapshot.snapshotId };
  await withGeneratedResponse(generatedTasks(snapshot), async (requests) => {
    const cold = await api("/tasks", request);
    assert.equal(cold.status, 200);
    assert.equal(requests.length, 1);
    const task = cold.body.tasks[0];
    const attempt = await api("/attempts", { learnerId, taskId: task.id, code: `${task.startingCode}\n// saved draft` });
    assert.equal(attempt.status, 201);
    const repeated = await api("/tasks", request);
    assert.deepEqual(repeated.body, cold.body);
    const foreignLearner = randomUUID();
    assert.deepEqual((await api("/tasks", { ...request, learnerId: foreignLearner })).body, cold.body);
    assert.equal(requests.length, 1, "warm requests must make zero additional provider calls");
    const history = await api(`/attempts?learnerId=${learnerId}&snapshotId=${snapshot.snapshotId}`);
    assert.equal(history.body.attempts[0].taskId, task.id);
    assert.equal((await api(`/attempts?learnerId=${foreignLearner}&snapshotId=${snapshot.snapshotId}`)).body.attempts.length, 0);
    const originalRow = db.prepare("SELECT data FROM practice_tasks WHERE task_id=?").get(task.id).data;
    for (const context of [
      { ...request.context, goal: "testing" },
      { ...request.context, profile: "experienced" },
      { ...request.context, journey: "other journey" },
      { ...request.context, lesson: "new lesson" },
      { ...request.context, studiedConcepts: ["other concept"] },
      { ...request.context, studiedConcepts: ["validation", "other concept"] },
      { ...request.context, studiedConcepts: ["other concept", "validation"] },
    ]) assert.equal((await api("/tasks", { ...request, context })).status, 200);
    assert.equal((await api("/tasks", { ...request, difficulty: "advanced" })).status, 200);
    assert.equal(requests.length, 9, "each material context or difficulty change must generate once");
    assert.equal(db.prepare("SELECT data FROM practice_tasks WHERE task_id=?").get(task.id).data, originalRow);
    assert.deepEqual((await api("/tasks", request)).body, cold.body);
    assert.equal(requests.length, 9);
  });
});

test("simultaneous identical practice requests coalesce to one complete bank", async () => {
  const { snapshot, files } = rangeFixture();
  saveSnapshot(snapshot, {}, "", files);
  const request = { ...requestContext, snapshotId: snapshot.snapshotId };
  await withGeneratedResponse(generatedTasks(snapshot), async (requests) => {
    const replies = await Promise.all([listPracticeTasks(request), listPracticeTasks(request)]);
    assert.deepEqual(replies[0], replies[1]);
    assert.equal(requests.length, 1);
    assert.deepEqual((await api("/tasks", request)).body, replies[0]);
    assert.equal(requests.length, 1);
  });
});

test("incomplete, legacy, corrupt and foreign task banks are misses with working Retry", async () => {
  for (const corruption of ["orphan", "missing-task", "manifest", "duplicate-id", "scope", "citation", "digest", "version", "context"]) {
    const { snapshot, files } = rangeFixture();
    saveSnapshot(snapshot, {}, "", files);
    const request = { ...requestContext, snapshotId: snapshot.snapshotId };
    await withGeneratedResponse(generatedTasks(snapshot), async (requests) => {
      const cold = await api("/tasks", request);
      assert.equal(cold.status, 200);
      const bank = db.prepare("SELECT * FROM practice_task_banks WHERE snapshot_id=?").get(snapshot.snapshotId);
      const manifest = JSON.parse(bank.manifest);
      const first = manifest[0];
      if (corruption === "context") {
        assert.equal((await api("/tasks", { ...request, context: { lesson: "different curriculum" } })).status, 200);
        const other = db.prepare("SELECT manifest FROM practice_task_banks WHERE snapshot_id=? AND cache_key<>?").get(snapshot.snapshotId, bank.cache_key);
        db.prepare("UPDATE practice_task_banks SET manifest=? WHERE cache_key=?").run(other.manifest, bank.cache_key);
      }
      if (corruption === "orphan") db.prepare("DELETE FROM practice_task_banks WHERE cache_key=?").run(bank.cache_key);
      if (corruption === "missing-task") db.prepare("DELETE FROM practice_tasks WHERE task_id=?").run(first.id);
      if (corruption === "manifest") db.prepare("UPDATE practice_task_banks SET manifest='invalid json' WHERE cache_key=?").run(bank.cache_key);
      if (corruption === "duplicate-id") db.prepare("UPDATE practice_task_banks SET manifest=? WHERE cache_key=?")
        .run(JSON.stringify([first, first, first]), bank.cache_key);
      if (corruption === "scope") db.prepare("UPDATE practice_tasks SET snapshot_id='foreign-snapshot' WHERE task_id=?").run(first.id);
      if (corruption === "version") db.prepare("UPDATE practice_task_banks SET cache_key=? WHERE cache_key=?").run(`old-version:${bank.cache_key}`, bank.cache_key);
      if (corruption === "citation" || corruption === "digest") {
        const task = JSON.parse(db.prepare("SELECT data FROM practice_tasks WHERE task_id=?").get(first.id).data);
        task.citations[0].snapshotId = "foreign-snapshot";
        const data = JSON.stringify(task);
        db.prepare("UPDATE practice_tasks SET data=? WHERE task_id=?").run(data, first.id);
        if (corruption === "citation") {
          first.digest = createHash("sha256").update(`${bank.cache_key}:${data}`).digest("hex").slice(0, 24);
          db.prepare("UPDATE practice_task_banks SET manifest=? WHERE cache_key=?").run(JSON.stringify(manifest), bank.cache_key);
        }
      }
      const recovered = await api("/tasks", request);
      assert.equal(recovered.status, 200, `${corruption}: ${JSON.stringify(recovered.body)}`);
      const expectedCalls = corruption === "context" ? 3 : 2;
      assert.equal(requests.length, expectedCalls, `${corruption} must regenerate once`);
      assert.deepEqual((await api("/tasks", request)).body, recovered.body);
      assert.equal(requests.length, expectedCalls, `${corruption} recovery must leave a valid bank`);
    });
  }
});

test("changed full source invalidates a bank even outside the selected evidence window", async () => {
  const { snapshot, files, source } = rangeFixture();
  saveSnapshot(snapshot, {}, "", files);
  const request = { ...requestContext, snapshotId: snapshot.snapshotId };
  await withGeneratedResponse(generatedTasks(snapshot), async (requests) => {
    const cold = await api("/tasks", request);
    assert.equal(cold.status, 200);
    const changed = source.replace("irrelevant prefix padding", "changed prefix padding");
    saveSnapshot(snapshot, {}, "", { "src/ranges.ts": changed });
    const regenerated = await api("/tasks", request);
    assert.equal(regenerated.status, 200);
    assert.equal(requests.length, 2);
    assert(regenerated.body.tasks.every((task) => task.startingCode === changed));
    assert.notDeepEqual(regenerated.body.tasks.map((task) => task.id), cold.body.tasks.map((task) => task.id));
    for (const task of cold.body.tasks)
      assert.equal(JSON.parse(db.prepare("SELECT data FROM practice_tasks WHERE task_id=?").get(task.id).data).startingCode, source);
    assert.deepEqual((await api("/tasks", request)).body, regenerated.body);
    assert.equal(requests.length, 2);
  });
});

test("failed bank persistence rolls back tasks and permits a clean retry", async () => {
  const { snapshot, files } = rangeFixture();
  saveSnapshot(snapshot, {}, "", files);
  const request = { ...requestContext, snapshotId: snapshot.snapshotId };
  db.exec(`CREATE TEMP TRIGGER fail_practice_bank BEFORE INSERT ON practice_task_banks
    BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;`);
  try {
    await withGeneratedResponse(generatedTasks(snapshot), async () => {
      assert.equal((await api("/tasks", request)).status, 500);
    });
    assert.equal(db.prepare("SELECT count(*) AS n FROM practice_tasks WHERE snapshot_id=?").get(snapshot.snapshotId).n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM practice_task_banks WHERE snapshot_id=?").get(snapshot.snapshotId).n, 0);
  } finally { db.exec("DROP TRIGGER fail_practice_bank"); }
  await withGeneratedResponse(generatedTasks(snapshot), async (requests) => {
    assert.equal((await api("/tasks", request)).status, 200);
    assert.equal((await api("/tasks", request)).status, 200);
    assert.equal(requests.length, 1);
  });
});

test("failed and invalid generations never poison Retry or leave partial banks", async () => {
  for (const failure of ["provider", "schema", "citation", "duplicate"]) {
    const { snapshot, files } = rangeFixture();
    saveSnapshot(snapshot, {}, "", files);
    const request = { ...requestContext, snapshotId: snapshot.snapshotId };
    const invalid = generatedTasks(snapshot);
    if (failure === "schema") invalid.tasks[2].objective = "short";
    if (failure === "citation") invalid.tasks[2].referenceIds = ["invented"];
    if (failure === "duplicate") invalid.tasks[2].title = invalid.tasks[0].title;
    if (failure === "provider") {
      globalThis.fetch = async (url, options) => String(url).includes("/chat/completions")
        ? new Response("provider rejected request", { status: 401 }) : originalFetch(url, options);
      try { assert.equal((await api("/tasks", request)).status, 502); }
      finally { globalThis.fetch = originalFetch; }
    } else await withGeneratedResponse(invalid, async () => {
      assert.equal((await api("/tasks", request)).status, 502);
    });
    assert.equal(db.prepare("SELECT count(*) AS n FROM practice_tasks WHERE snapshot_id=?").get(snapshot.snapshotId).n, 0);
    await withGeneratedResponse(generatedTasks(snapshot), async (requests) => {
      assert.equal((await api("/tasks", request)).status, 200);
      assert.equal((await api("/tasks", request)).status, 200);
      assert.equal(requests.length, 1);
    });
  }
});

test("task bank survives backend process restart without a provider request", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "practice-bank-"));
  const database = path.join(directory, "cache.sqlite");
  const script = `
    import { readFileSync } from 'node:fs';
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const { db, saveSnapshot } = await import('./src/storage.js');
    const { listPracticeTasks } = await import('./src/practice.js');
    if (input.cold) saveSnapshot(input.graph, {}, '', input.files);
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (!input.cold) throw new Error('warm process must not call provider');
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(input.generated)}}]}));
    };
    const response = await listPracticeTasks(input.request);
    console.log(JSON.stringify({calls,response}));
    db.close();
  `;
  try {
    const run = (cold) => {
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: new URL("..", import.meta.url), encoding: "utf8",
        env: { ...process.env, DATABASE_PATH: database },
        input: JSON.stringify({ cold, graph, files, request: requestContext, generated: generatedTasks() }),
        timeout: 15000,
      });
      assert.equal(child.status, 0, child.stderr);
      return JSON.parse(child.stdout);
    };
    const cold = run(true);
    assert.equal(cold.calls, 1);
    const warm = run(false);
    assert.equal(warm.calls, 0);
    assert.deepEqual(warm.response, cold.response);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("practice endpoints reject unknown snapshots and malformed difficulty", async () => {
  const missing = await api("/tasks", {
    ...requestContext,
    snapshotId: "not-a-snapshot",
  });
  assert.equal(missing.status, 404);
  const invalid = await api("/tasks", {
    ...requestContext,
    difficulty: "expert",
  });
  assert.equal(invalid.status, 400);
});

test("practice accounting counts cold/coalesced/cache work without changing artifact identity or leaking context", async () => {
  const { snapshot, files } = rangeFixture();
  saveSnapshot(snapshot, {}, "", files);
  const request = { ...requestContext, snapshotId: snapshot.snapshotId, context: { lesson: `private-context-${learnerId}` } };
  const sequence = generationUsage().at(-1)?.sequence || 0;
  const model = process.env.LLM_MODEL;
  try {
    await withGeneratedResponse(generatedTasks(snapshot), async (calls) => {
      const [a, b] = await Promise.all([listPracticeTasks(request), listPracticeTasks(request)]);
      assert.deepEqual(a, b);
      assert.equal(calls.length, 1);
      process.env.LLM_MODEL = "changed-model-must-not-invalidate-cache";
      assert.deepEqual(await listPracticeTasks(request), a);
      assert.equal(calls.length, 1);
      const other = rangeFixture();
      saveSnapshot(other.snapshot, {}, "", other.files);
      const changed = await listPracticeTasks({ ...request, snapshotId: other.snapshot.snapshotId });
      assert.equal(changed.snapshotId, other.snapshot.snapshotId);
      assert.equal(calls.length, 2);
      const records = generationUsage().filter((row) => row.sequence > sequence && row.feature === "practice_tasks");
      const attempts = records.filter((row) => row.kind === "attempt");
      assert.equal(attempts.length, 2);
      assert(attempts.every((row) => row.status === "success" && Number.isFinite(row.durationMs)));
      assert.deepEqual(attempts[0].tokens, { input: 41, output: 7, total: 48 });
      assert.equal(records.filter((row) => row.kind === "cache" && row.status === "hit").length, 1);
      assert.equal(records.filter((row) => row.kind === "cache" && row.status === "coalesced").length, 1);
      assert(!JSON.stringify(records).includes(learnerId));
      assert(!JSON.stringify(records).includes(snapshot.snapshotId));
      assert(!JSON.stringify(records).includes(request.context.lesson));
      assert(!JSON.stringify(records).includes(process.env.LLM_API_KEY));
    }, { prompt_tokens: 41, completion_tokens: 7, total_tokens: 48 });
  } finally {
    if (model === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = model;
  }
});

test("practice accounting records provider retries and malformed output without changing errors or retryability", async () => {
  const { snapshot, files } = rangeFixture();
  saveSnapshot(snapshot, {}, "", files);
  const request = { ...requestContext, snapshotId: snapshot.snapshotId };
  const sequence = generationUsage().at(-1)?.sequence || 0;
  let calls = 0, malformed = false;
  globalThis.fetch = async (url, options) => {
    if (!String(url).includes("/chat/completions")) return originalFetch(url, options);
    calls++;
    if (calls === 1) return new Response("private provider failure details", { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: {
      content: malformed ? "malformed JSON" : JSON.stringify(generatedTasks(snapshot)),
    } }] }));
  };
  try {
    assert.equal((await api("/tasks", request)).status, 200);
    assert.equal(calls, 2);
    malformed = true;
    const retryRequest = { ...request, context: { lesson: "new uncached material" } };
    assert.equal((await api("/tasks", retryRequest)).status, 502);
    assert.equal(calls, 3);
    malformed = false;
    assert.equal((await api("/tasks", retryRequest)).status, 200);
    assert.equal((await api("/tasks", retryRequest)).status, 200);
    assert.equal(calls, 4);
    const records = generationUsage().filter((row) => row.sequence > sequence && row.feature === "practice_tasks");
    assert.equal(records.filter((row) => row.kind === "attempt").length, 4);
    assert.equal(records.filter((row) => row.kind === "attempt" && row.status === "error").length, 1);
    assert.equal(records.filter((row) => row.kind === "generation_error" && row.errorCategory === "invalid_output").length, 1);
    assert(records.filter((row) => row.kind === "attempt").every((row) => row.tokens.total === "unknown"));
    assert(!JSON.stringify(records).includes("private provider failure details"));
  } finally { globalThis.fetch = originalFetch; }
});
