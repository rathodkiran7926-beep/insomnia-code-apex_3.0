import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";

process.env.DATABASE_PATH = ":memory:";
const { db, saveSnapshot } = await import("../src/storage.js");
const { analyze } = await import("../src/analyzer.js");
const { checkDraft } = await import("../src/practice.js");
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

function generatedTasks() {
  return {
    tasks: graph.components
      .filter((component) =>
        graph.references.some(
          (reference) =>
            reference.id === component.referenceId &&
            reference.snapshotId === graph.snapshotId,
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

async function withGeneratedResponse(content, callback) {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/chat/completions")) {
      requests.push(JSON.parse(options.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(content) } }],
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
  const key = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  const unavailable = await api("/tasks", requestContext);
  assert.equal(unavailable.status, 503);
  process.env.LLM_API_KEY = key;
  const badResponse = generatedTasks();
  badResponse.tasks[0].referenceIds = ["fabricated-reference"];
  await withGeneratedResponse(badResponse, async () => {
    const invalid = await api("/tasks", requestContext);
    assert.equal(invalid.status, 502);
    assert.match(invalid.body.error, /invalid source citations/i);
  });
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
