import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";
process.env.DATABASE_PATH = ":memory:";
delete process.env.LLM_API_KEY;
const { db, saveSnapshot } = await import("../src/storage.js");
const { collaborationRoutes } = await import("../src/collaborationAuth.js");
const { handoffRoutes } = await import("../src/handoffRoutes.js");
const { validateBriefing, generateHandoffBriefing } =
  await import("../src/handoffContext.js");
const { analyze } = await import("../src/analyzer.js");
const { containsCredential, redactCredentials } =
  await import("../src/handoffSafety.js");
const { handoffRepository, handoffRepositorySource } =
  await import("../src/handoffRepository.js");
const app = express();
app.use(express.json());
app.use("/api/collaboration", collaborationRoutes);
app.use("/api/handoffs", handoffRoutes);
app.use((e, _req, res, _next) =>
  res
    .status(e.status || (e.name === "ZodError" ? 400 : 500))
    .json({ error: e.name === "ZodError" ? "Invalid data" : e.message }),
);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
after(() => new Promise((resolve) => server.close(resolve)));
const base = `http://127.0.0.1:${server.address().port}/api`;
async function api(
  path,
  cookie = "",
  body,
  method = body === undefined ? "GET" : "POST",
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    body: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
    headers: response.headers,
  };
}
async function register(name, inviteToken) {
  const result = await api("/collaboration/register", "", {
    name,
    email: `${name}@test.example`,
    password: "test password 123456",
    ...(inviteToken ? { inviteToken } : {}),
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result;
}
const files = {
  "src/users.ts": `export async function createUser(email: string) {
  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    throw new Error('User already exists');
  }
  return { email };
}
export function findUserByEmail(email: string) { return null; }
`,
  "src/users.test.ts": `import { createUser } from './users'; export const testCreate = () => createUser('a');`,
  "other.ts": `export function unrelated(){return 'do not include';}`,
};
const graph = analyze({
  repository: "https://github.com/example/users",
  commit: "a".repeat(40),
  branch: "main",
  files,
});
saveSnapshot(graph, { snapshotId: graph.snapshotId }, "", files);
const ref = graph.references.find((r) => r.file === "src/users.ts");
let junior,
  senior,
  developer,
  outsider,
  workspace,
  sessionId,
  secondId,
  resolutionId;
test("real accounts, hashed credentials, one-time reviewer invitations and separate workspace access", async () => {
  junior = await register("junior");
  outsider = await register("outsider");
  const me = await api("/collaboration/me", junior.cookie);
  workspace = me.body.workspaces[0].id;
  assert.equal(me.body.workspaces[0].role, "maintainer");
  assert.match(junior.headers.get("set-cookie"), /HttpOnly/i);
  assert.match(junior.headers.get("set-cookie"), /SameSite=Strict/i);
  assert.notEqual(
    db
      .prepare("SELECT password_hash FROM collaboration_users WHERE id=?")
      .get(junior.body.user.id).password_hash,
    "test password 123456",
  );
  const invitation = await api(
    `/collaboration/workspaces/${workspace}/invites`,
    junior.cookie,
    { role: "reviewer" },
  );
  senior = await register("senior", invitation.body.token);
  assert.equal(
    (
      await api("/collaboration/accept-invite", senior.cookie, {
        token: invitation.body.token,
      })
    ).status,
    400,
  );
  const invitation2 = await api(
    `/collaboration/workspaces/${workspace}/invites`,
    junior.cookie,
    { role: "developer" },
  );
  developer = await register("developer", invitation2.body.token);
  assert.equal(
    (
      await api(
        `/collaboration/workspaces/${workspace}/invites`,
        senior.cookie,
        { role: "reviewer" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api(
        `/collaboration/workspaces/${workspace}/members`,
        outsider.cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await api("/collaboration/login", "", {
        email: "junior@test.example",
        password: "wrong password here",
      })
    ).status,
    401,
  );
});
function creation(overrides = {}) {
  return {
    workspaceId: workspace,
    snapshotId: graph.snapshotId,
    referenceId: ref.id,
    requestId: randomUUID(),
    startLine: 1,
    endLine: 7,
    title: "Why a conflict?",
    question: "Why reject an existing account?",
    expectedBehavior: "Update account",
    actualBehavior: "Throws an error",
    attemptedSolutions: "Read the validation",
    assignedTo: senior.body.user.id,
    ...overrides,
  };
}
test("validate question, range, references, assignment and immutable source; retry does not duplicate", async () => {
  for (const invalid of [
    { question: " " },
    { startLine: 0 },
    { endLine: 999 },
    { startLine: 6, endLine: 2 },
    { referenceId: "not-a-reference" },
    { assignedTo: outsider.body.user.id },
  ]) {
    const result = await api("/handoffs", junior.cookie, creation(invalid));
    assert([400, 404].includes(result.status), JSON.stringify(result));
  }
  const body = creation(),
    result = await api("/handoffs", junior.cookie, body);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  sessionId = result.body.session.id;
  assert.equal(
    result.body.snapshot.source_code,
    files["src/users.ts"].split("\n").slice(0, 7).join("\n"),
  );
  assert.equal(result.body.snapshot.branch_name, "main");
  assert.equal(result.body.snapshot.function_name, "createUser");
  assert.equal(
    (await api("/handoffs", junior.cookie, body)).body.session.id,
    sessionId,
  );
  const second = await api("/handoffs", junior.cookie, creation());
  secondId = second.body.session.id;
  assert.notEqual(secondId, sessionId);
  db.prepare(
    "UPDATE source_files SET content=? WHERE snapshot_id=? AND path=?",
  ).run("// live cache changed", graph.snapshotId, "src/users.ts");
  assert.equal(
    (await api(`/handoffs/${sessionId}`, senior.cookie)).body.snapshot
      .source_code,
    result.body.snapshot.source_code,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE handoff_snapshots SET source_code=? WHERE session_id=?",
        )
        .run("altered", sessionId),
    /immutable/,
  );
});
test("every handoff operation requires authentication and workspace/repository authorization", async () => {
  const mutations = [
    ["", "PATCH", { title: "steal" }],
    ["/comments", "POST", { content: "x" }],
    ["/context", "POST", {}],
    ["/status", "PATCH", { status: "OPEN" }],
    ["/resolution", "POST", { solution: "x", explanation: "x" }],
    ["/confirm-resolution", "POST", { resolutionId: randomUUID() }],
    ["/approve-knowledge", "POST", {}],
    ["/share", "POST", {}],
  ];
  for (const [suffix, method, body] of mutations) {
    assert.equal(
      (await api(`/handoffs/${sessionId}${suffix}`, "", body, method)).status,
      401,
    );
    assert.equal(
      (
        await api(
          `/handoffs/${sessionId}${suffix}`,
          outsider.cookie,
          body,
          method,
        )
      ).status,
      404,
    );
  }
  for (const suffix of [
    "",
    "/comments",
    "/repository",
    "/repository/source?path=src%2Fusers.ts",
  ]) {
    assert.equal(
      (await api(`/handoffs/${sessionId}${suffix}`, "")).status,
      401,
    );
    assert.equal(
      (await api(`/handoffs/${sessionId}${suffix}`, outsider.cookie)).status,
      404,
    );
  }
  assert.equal(
    (await api(`/handoffs?workspaceId=${workspace}`, outsider.cookie)).status,
    404,
  );
  assert.equal(
    (await api(`/handoffs/knowledge?workspaceId=${workspace}`, outsider.cookie))
      .status,
    404,
  );
  assert.equal((await api("/handoffs/not-a-uuid", junior.cookie)).status, 400);
});
test("shared explorer and full files use the immutable original graph and source, not the active cache", async () => {
  const index = await api(`/handoffs/${sessionId}/repository`, senior.cookie);
  assert.equal(index.status, 200, JSON.stringify(index.body));
  assert.equal(index.body.graph.commit, "a".repeat(40));
  assert(index.body.files.some((f) => f.path === "src/users.ts"));
  assert(index.body.graph.components.some((c) => c.name === "findUserByEmail"));
  assert(index.body.graph.relationships.some((r) => r.type === "calls"));
  const full = await api(
    `/handoffs/${sessionId}/repository/source?path=src%2Fusers.ts`,
    senior.cookie,
  );
  assert.equal(full.status, 200, JSON.stringify(full.body));
  assert.equal(full.body.excerpt, files["src/users.ts"]);
  assert.equal(full.body.complete, true);
  assert.equal(full.body.startLine, 1);
  assert.equal(full.body.commit, "a".repeat(40));
  assert.equal(
    (
      await api(
        `/handoffs/${sessionId}/repository/source?path=..%2F.env`,
        junior.cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await api(
        `/handoffs/${sessionId}/repository/source?path=missing.ts`,
        junior.cookie,
      )
    ).status,
    404,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE handoff_repository_files SET content=? WHERE analysis_snapshot_id=?",
        )
        .run("edited", graph.snapshotId),
    /immutable/,
  );
});
test("older handoffs gain their own pinned explorer and filter supporting credentials and sensitive paths", () => {
  const legacyFiles = {
    "src/logic.ts": "export function answer() { return 42; }",
    "src/config.ts":
      'export const apiKey = "test-only-sensitive-value";\nexport const port = 3001;',
    "src/credentials.ts": 'export const account = "must not be shared";',
  };
  const legacyGraph = analyze({
    repository: graph.repository,
    commit: "b".repeat(40),
    files: legacyFiles,
  });
  saveSnapshot(legacyGraph, {}, "", legacyFiles);
  const original = {
    analysis_snapshot_id: legacyGraph.snapshotId,
    commit_sha: legacyGraph.commit,
    file_path: "src/logic.ts",
    start_line: 1,
    end_line: 1,
    source_code: legacyFiles["src/logic.ts"],
  };
  const view = handoffRepository(original);
  assert.equal(view.graph.commit, legacyGraph.commit);
  assert(!view.files.some((f) => f.path.includes("credentials")));
  assert(!JSON.stringify(view.graph).includes("test-only-sensitive-value"));
  const supporting = handoffRepositorySource(original, "src/config.ts");
  assert.equal(supporting.redacted, true);
  assert(!supporting.excerpt.includes("test-only-sensitive-value"));
  assert.equal(supporting.endLine, 2);
  assert.equal(
    handoffRepositorySource(original, "src/logic.ts").excerpt,
    original.source_code,
  );
  assert.throws(
    () =>
      handoffRepositorySource(
        { ...original, source_code: "mismatched old selection" },
        "src/logic.ts",
      ),
    /does not match/,
  );
});
test("senior replies, requests clarification and annotates pinned lines; separate questions remain isolated", async () => {
  assert.equal(
    (
      await api(`/handoffs/${sessionId}/comments`, senior.cookie, {
        content: "Not in selection",
        lineStart: 9,
      })
    ).status,
    400,
  );
  const reply = await api(`/handoffs/${sessionId}/comments`, senior.cookie, {
    content: "This is create-only. Check the API contract.",
    lineStart: 4,
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.equal(reply.body.comments[0].line_start, 4);
  assert.equal(reply.body.comments[0].snapshot_id, reply.body.snapshot.id);
  const request = await api(`/handoffs/${sessionId}/comments`, senior.cookie, {
    content: "What behavior does the contract require?",
    kind: "context_request",
  });
  assert.equal(request.body.session.status, "NEEDS_CONTEXT");
  assert.equal(
    (
      await api(`/handoffs/${sessionId}/comments`, junior.cookie, {
        content: "The requirement is create only.",
      })
    ).status,
    201,
  );
  const reload = await api(`/handoffs/${sessionId}`, senior.cookie);
  assert.equal(reload.body.comments.length, 3);
  assert.equal(reload.body.comments[0].author_name, "senior");
  assert.equal(
    (await api(`/handoffs/${secondId}`, senior.cookie)).body.comments.length,
    0,
  );
  assert.equal(
    (
      await api(
        `/handoffs/${sessionId}/status`,
        developer.cookie,
        { status: "IN_REVIEW" },
        "PATCH",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api(`/handoffs/${sessionId}/comments`, developer.cookie, {
        content: "x",
        kind: "context_request",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api(
        `/handoffs/${sessionId}/status`,
        senior.cookie,
        { status: "RESOLVED" },
        "PATCH",
      )
    ).status,
    400,
  );
});
test("senior solution needs author confirmation and explicit maintainer approval for knowledge", async () => {
  assert.equal(
    (
      await api(`/handoffs/${sessionId}/resolution`, junior.cookie, {
        solution: "x",
        explanation: "x",
      })
    ).status,
    403,
  );
  const proposal = await api(
    `/handoffs/${sessionId}/resolution`,
    senior.cookie,
    {
      solution: "Keep the conflict response.",
      explanation: "The contract calls for creating a new account only.",
    },
  );
  assert.equal(proposal.status, 201, JSON.stringify(proposal.body));
  resolutionId = proposal.body.resolutions[0].id;
  assert.equal(proposal.body.session.status, "IN_REVIEW");
  assert.equal(
    (
      await api(`/handoffs/${sessionId}/confirm-resolution`, senior.cookie, {
        resolutionId,
      })
    ).status,
    403,
  );
  assert.equal(
    (await api(`/handoffs/${sessionId}/approve-knowledge`, junior.cookie, {}))
      .status,
    409,
  );
  const confirmed = await api(
    `/handoffs/${sessionId}/confirm-resolution`,
    junior.cookie,
    { resolutionId },
  );
  assert.equal(confirmed.body.session.status, "RESOLVED");
  assert.equal(
    (await api(`/handoffs/${sessionId}/approve-knowledge`, senior.cookie, {}))
      .status,
    403,
  );
  assert.equal(
    (await api(`/handoffs/${sessionId}/approve-knowledge`, junior.cookie, {}))
      .status,
    200,
  );
  const knowledge = await api(
    `/handoffs/knowledge?workspaceId=${workspace}&search=contract`,
    senior.cookie,
  );
  assert.equal(knowledge.body.entries.length, 1);
  assert.equal(knowledge.body.entries[0].commit_sha, "a".repeat(40));
  assert.equal(
    (
      await api(`/handoffs/${sessionId}/comments`, senior.cookie, {
        content: "cannot edit resolved review",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api(
        `/handoffs/${sessionId}/status`,
        junior.cookie,
        { status: "CLOSED" },
        "PATCH",
      )
    ).body.session.status,
    "CLOSED",
  );
  assert.equal(
    (
      await api(
        `/handoffs/${sessionId}/status`,
        junior.cookie,
        { status: "OPEN" },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (await api(`/handoffs/knowledge?workspaceId=${workspace}`, junior.cookie))
      .body.entries.length,
    0,
  );
  assert.equal(
    (
      await api(`/handoffs/${sessionId}/confirm-resolution`, junior.cookie, {
        resolutionId,
      })
    ).status,
    409,
  );
});
test("session search, assignment and status filters reflect real records", async () => {
  const assigned = await api(
    `/handoffs?workspaceId=${workspace}&filter=assigned`,
    senior.cookie,
  );
  assert.equal(assigned.body.total, 2);
  assert.equal(assigned.body.sessions.length, 2);
  const mine = await api(
    `/handoffs?workspaceId=${workspace}&filter=mine`,
    developer.cookie,
  );
  assert.equal(mine.body.total, 0);
  assert.equal(
    (
      await api(
        `/handoffs?workspaceId=${workspace}&search=missing`,
        senior.cookie,
      )
    ).body.total,
    0,
  );
});
test("AI citation validation rejects invented references; provider failure preserves source and discussion", async () => {
  const saved = (await api(`/handoffs/${sessionId}`, senior.cookie)).body;
  const context = saved.snapshot.context;
  assert(!JSON.stringify(context).includes("unrelated"));
  const candidate = {
    purpose: { text: "Checks an account.", referenceIds: ["selection"] },
    findings: [],
    hypotheses: ["Intent is unverified."],
    unresolved: [],
    review: [],
  };
  assert.equal(
    validateBriefing(candidate, context).purpose.text,
    "Checks an account.",
  );
  assert.throws(
    () =>
      validateBriefing(
        {
          ...candidate,
          purpose: { text: "invented", referenceIds: ["made-up"] },
        },
        context,
      ),
    /citation/,
  );
  const oldFetch = globalThis.fetch;
  process.env.LLM_API_KEY = "test-only";
  globalThis.fetch = async () => new Response("{}", { status: 503 });
  try {
    assert.equal((await generateHandoffBriefing(context, {})).state, "failed");
  } finally {
    globalThis.fetch = oldFetch;
    delete process.env.LLM_API_KEY;
  }
  assert.equal(
    (await api(`/handoffs/${sessionId}/context`, senior.cookie, {})).body
      .briefing.state,
    "unavailable",
  );
  const reloaded = (await api(`/handoffs/${sessionId}`, junior.cookie)).body;
  assert.equal(reloaded.comments.length, 3);
  assert(reloaded.snapshot.source_code.includes("createUser"));
});
test("logout revokes the stored session cookie", async () => {
  assert.equal(
    (await api("/collaboration/logout", outsider.cookie, {})).status,
    200,
  );
  assert.equal((await api("/collaboration/me", outsider.cookie)).status, 401);
});
test("handoff evidence filtering excludes common inline credentials without changing line positions", () => {
  const value = 'const apiKey = "example-sensitive-value";\nconst port = 3001;';
  assert(containsCredential(value));
  assert(!redactCredentials(value).includes("example-sensitive-value"));
  assert.equal(redactCredentials(value).split("\n").length, 2);
  assert(!containsCredential("const token = process.env.API_KEY;"));
});
test("simultaneous briefing requests share one validated generation and then use the saved result", async () => {
  const oldFetch = globalThis.fetch;
  let requests = 0;
  process.env.LLM_API_KEY = "test-only";
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith(base)) return oldFetch(url, options);
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                purpose: {
                  text: "Checks an existing user before creating an account.",
                  referenceIds: ["selection"],
                },
                findings: [],
                hypotheses: ["Create-only behavior may be intentional."],
                unresolved: ["Check the API contract."],
                review: [],
              }),
            },
          },
        ],
      }),
    );
  };
  try {
    const results = await Promise.all([
      api(`/handoffs/${sessionId}/context`, senior.cookie, {}),
      api(`/handoffs/${sessionId}/context`, junior.cookie, {}),
    ]);
    assert(results.every((r) => r.body.briefing.state === "complete"));
    await api(`/handoffs/${sessionId}/context`, senior.cookie, {});
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = oldFetch;
    delete process.env.LLM_API_KEY;
  }
});
