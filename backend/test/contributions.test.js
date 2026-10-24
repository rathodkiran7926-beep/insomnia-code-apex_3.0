import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { z } from "zod";

process.env.DATABASE_PATH = ":memory:";
delete process.env.LLM_API_KEY;
const { db, saveSnapshot } = await import("../src/storage.js");
const { analyze } = await import("../src/analyzer.js");
const { contributionRoutes } = await import("../src/contributionRoutes.js");
let githubFailure = null;
let issuesAvailable = true;
let malformedIssues = false;
let issueState = "open";
let aiResponse = null;
const aiRequests = [];

const graph = analyze({
  repository: "https://github.com/example/contribution-demo",
  commit: "a".repeat(40),
  files: {
    "src/accessibility.ts":
      "export function focusFirstItem(items) { return items[0]; }\n",
    "README.md":
      "# Contribution demo\n\nRun npm test before opening a pull request.",
    "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
  },
});
saveSnapshot(
  graph,
  {},
  "",
  {
    "src/accessibility.ts":
      "export function focusFirstItem(items) { return items[0]; }\n",
    "README.md":
      "# Contribution demo\n\nRun npm test before opening a pull request.",
    "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
  },
  { paths: ["pnpm-lock.yaml"] },
);

const issue = {
  number: 42,
  title: "Improve accessibility focus handling",
  html_url: "https://github.com/example/contribution-demo/issues/42",
  state: "open",
  body: "Improve focus handling for keyboard navigation and add a small test covering the first focused item.",
  labels: [{ name: "good-first-issue" }],
  updated_at: new Date().toISOString(),
  comments: 2,
};
const originalFetch = globalThis.fetch;
const calls = [];

function githubResponse(url) {
  const parsed = new URL(url);
  const path = parsed.pathname;
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  calls.push(url);
  if (path === "/repos/example/contribution-demo" && githubFailure)
    return json({ message: "GitHub response" }, githubFailure);
  if (path === "/repos/example/contribution-demo")
    return json({
      name: "contribution-demo",
      stargazers_count: 12,
      license: { spdx_id: "MIT" },
      default_branch: "main",
    });
  if (path.endsWith("/commits"))
    return json([
      {
        sha: "b".repeat(40),
        commit: { committer: { date: new Date().toISOString() } },
      },
    ]);
  if (path.endsWith("/issues/42/comments")) return json([]);
  if (path.endsWith("/issues/42")) return json({ ...issue, state: issueState });
  if (path.endsWith("/issues"))
    return json(
      malformedIssues ? [{ number: "42" }] : issuesAvailable ? [issue] : [],
    );
  if (path.endsWith("/contributors"))
    return json([
      { login: "maintainer", contributions: 8 },
      { login: "helper", contributions: 2 },
    ]);
  if (path.endsWith("/pulls"))
    return json([
      {
        number: 7,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        closed_at: new Date().toISOString(),
        merged_at: new Date().toISOString(),
      },
    ]);
  if (
    path.endsWith("/contents/CONTRIBUTING.md") ||
    path.endsWith("/contents/CODE_OF_CONDUCT.md")
  )
    return json({ type: "file" });
  if (path.endsWith("/releases")) return json([]);
  return json({ message: "Not Found" }, 404);
}

const app = express();
app.use(express.json());
app.use("/api/contributions", contributionRoutes);
app.use((error, _req, res, _next) => {
  res.status(error instanceof z.ZodError ? 400 : error.status || 500).json({
    error: error instanceof z.ZodError ? "Invalid request data" : error.message,
  });
});
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/api/contributions`;
globalThis.fetch = async (input, options) => {
  const url = String(input);
  if (url.startsWith("https://ai.test/")) {
    aiRequests.push(JSON.parse(options.body));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(aiResponse) } }],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.startsWith("https://api.github.com/")) return githubResponse(url);
  return originalFetch(input, options);
};

test("analyze endpoint uses the existing snapshot and real GitHub metadata", async () => {
  const response = await originalFetch(`${endpoint}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      snapshotId: graph.snapshotId,
      preferences: { skills: ["accessibility"], difficulty: "beginner" },
    }),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.repository.snapshotId, graph.snapshotId);
  assert.equal(data.repository.commit, graph.commit);
  assert.equal(data.issues[0].number, issue.number);
  assert.equal(data.issues[0].difficulty, "beginner");
  assert.equal(data.issues[0].score, 75);
  assert.equal(data.issues[0].files[0], "src/accessibility.ts");
  assert.equal(data.recommendationMode, "rules");
  assert.equal(data.signals.repository.license, "MIT");
  assert.equal(data.signals.contributors.leaderShare, 80);
  assert(
    calls.some((url) =>
      url.endsWith(
        "/issues?state=open&sort=updated&direction=desc&per_page=100&page=1",
      ),
    ),
  );
  assert(
    calls.every(
      (url) =>
        !url.includes("codeload.github.com") && !url.includes("/git/trees/"),
    ),
  );
});

test("plan endpoint fetches the selected issue and returns snapshot-grounded fallback", async () => {
  const response = await originalFetch(`${endpoint}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      snapshotId: graph.snapshotId,
      issueNumber: issue.number,
    }),
  });
  assert.equal(response.status, 200);
  const plan = await response.json();
  assert.equal(plan.mode, "fallback");
  assert.equal(plan.snapshotId, graph.snapshotId);
  assert(plan.relevantFiles.includes("src/accessibility.ts"));
  assert(plan.commands.includes("pnpm run test"));
  assert(plan.gitCommands.some((command) => command.includes("git push")));
  assert(calls.some((url) => url.endsWith("/issues/42")));
  assert(
    calls.some((url) =>
      url.endsWith(
        "/issues/42/comments?per_page=30&page=1&sort=updated&direction=desc",
      ),
    ),
  );
});

test("configured AI produces a validated plan while issue content stays untrusted", async () => {
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = "https://ai.test/v1";
  aiResponse = {
    summary: "Clarify keyboard focus after navigation.",
    expectedOutcome: "Keyboard users can identify the focused item.",
    implementationSteps: [
      "Confirm the expected focus behavior.",
      "Make a focused code change.",
    ],
    testing: ["Run the test command listed from package metadata."],
    maintainerQuestions: [],
    definitionOfDone: ["The focused behavior is verified."],
  };
  const response = await originalFetch(`${endpoint}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      snapshotId: graph.snapshotId,
      issueNumber: issue.number,
    }),
  });
  assert.equal(response.status, 200);
  const plan = await response.json();
  assert.equal(plan.mode, "ai-assisted");
  assert.equal(plan.summary, aiResponse.summary);
  assert(plan.commands.includes("pnpm run test"));
  assert.match(aiRequests[0].messages[0].content, /untrusted data/);
  assert.equal(
    JSON.parse(aiRequests[0].messages[1].content).untrustedIssue.number,
    issue.number,
  );
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
  aiResponse = null;
});

test("missing snapshots and malformed inputs fail explicitly", async () => {
  const missing = await originalFetch(`${endpoint}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshotId: "missing" }),
  });
  assert.equal(missing.status, 404);
  assert.match(
    (await missing.json()).error,
    /Analyze a repository in Workspace/,
  );
  const invalid = await originalFetch(`${endpoint}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshotId: graph.snapshotId, issueNumber: -1 }),
  });
  assert.equal(invalid.status, 400);
});

test("no-match, GitHub-failure, and rate-limit cases return useful outcomes", async () => {
  issuesAvailable = false;
  const empty = await originalFetch(`${endpoint}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshotId: graph.snapshotId }),
  });
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).issues, []);
  issuesAvailable = true;

  githubFailure = 500;
  const failed = await originalFetch(`${endpoint}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshotId: graph.snapshotId }),
  });
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /temporarily unavailable/);

  githubFailure = 403;
  const rateLimited = await originalFetch(`${endpoint}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshotId: graph.snapshotId }),
  });
  assert.equal(rateLimited.status, 429);
  assert.match((await rateLimited.json()).error, /rate limit/);
  githubFailure = null;
});

test("malformed GitHub data and issues closed after selection fail clearly", async () => {
  malformedIssues = true;
  const malformed = await originalFetch(`${endpoint}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshotId: graph.snapshotId }),
  });
  assert.equal(malformed.status, 502);
  assert.match((await malformed.json()).error, /unexpected response/);
  malformedIssues = false;

  issueState = "closed";
  const closed = await originalFetch(`${endpoint}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      snapshotId: graph.snapshotId,
      issueNumber: issue.number,
    }),
  });
  assert.equal(closed.status, 409);
  assert.match((await closed.json()).error, /no longer open/);
  issueState = "open";
});

test("server is closed after the contribution API tests", async () => {
  globalThis.fetch = originalFetch;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  db.close();
});
