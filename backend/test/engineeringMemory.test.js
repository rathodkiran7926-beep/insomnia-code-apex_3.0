import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";
process.env.DATABASE_PATH = ":memory:";
delete process.env.LLM_API_KEY;
const { db, saveSnapshot } = await import("../src/storage.js");
const { analyze } = await import("../src/analyzer.js");
const { collaborationRoutes } = await import("../src/collaborationAuth.js");
const { handoffRoutes } = await import("../src/handoffRoutes.js");
const { engineeringMemoryRoutes } =
  await import("../src/engineeringMemoryRoutes.js");
const app = express();
app.use(express.json());
app.use("/api/collaboration", collaborationRoutes);
app.use("/api/handoffs", handoffRoutes);
app.use("/api/memory", engineeringMemoryRoutes);
app.use((e, _req, res, _next) =>
  res
    .status(e.status || (e.name === "ZodError" ? 400 : 500))
    .json({ error: e.message }),
);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
after(() => new Promise((resolve) => server.close(resolve)));
async function api(
  path,
  cookie = "",
  body,
  method = body === undefined ? "GET" : "POST",
) {
  const r = await fetch(
    `http://127.0.0.1:${server.address().port}/api${path}`,
    {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0] || "",
  };
}
async function register(name, inviteToken) {
  const r = await api("/collaboration/register", "", {
    name,
    email: `${name}@test.example`,
    password: "local test password 123",
    ...(inviteToken ? { inviteToken } : {}),
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r;
}
const files = {
  "src/accounts.ts": `export function createAccount(email:string) { if(!email) throw new Error('Email required'); return {email}; }\nexport function unrelated(){return 1;}`,
};
function snapshot(commit, source = files) {
  const graph = analyze({
    repository: "https://github.com/example/engineering-memory",
    commit: commit.repeat(40),
    files: source,
  });
  saveSnapshot(graph, { snapshotId: graph.snapshotId }, "", source);
  return graph;
}
const graph = snapshot("a"),
  component = graph.components.find((c) => c.name === "createAccount"),
  ref = graph.references.find((r) => r.id === component.referenceId);
let owner, reviewer, developer, outsider, workspace, record;
const content = {
  title: "Require an email before account creation",
  decision: "Reject requests without an email.",
  rationale: "Identity is required by the account contract.",
};
const input = () => ({
  workspaceId: workspace,
  type: "decision",
  snapshotId: graph.snapshotId,
  referenceIds: [ref.id],
  content,
});
async function command(id, name, cookie, revision = 1, extra = {}) {
  return api(`/memory/records/${id}/${name}`, cookie, {
    expectedRevision: revision,
    ...extra,
  });
}
test("memory reuses authenticated workspace roles; drafts and approvals cannot leak across teams", async () => {
  owner = await register("memory-owner");
  outsider = await register("memory-outsider");
  workspace = (await api("/collaboration/me", owner.cookie)).data.workspaces[0]
    .id;
  for (const [name, role] of [
    ["memory-reviewer", "reviewer"],
    ["memory-developer", "developer"],
  ]) {
    const invite = await api(
      `/collaboration/workspaces/${workspace}/invites`,
      owner.cookie,
      { role },
    );
    const person = await register(name, invite.data.token);
    if (role === "reviewer") reviewer = person;
    else developer = person;
  }
  assert.equal((await api("/memory/records")).status, 401);
  const created = await api("/memory/records", owner.cookie, input());
  assert.equal(created.status, 201, JSON.stringify(created.data));
  record = created.data;
  assert.equal(record.status, "draft");
  assert.equal(record.authoritative, false);
  assert.equal(record.evidence[0].commit, graph.commit);
  assert.equal(
    (await api(`/memory/records?workspaceId=${workspace}`, owner.cookie)).data
      .entries.length,
    0,
  );
  assert.equal(
    (await api(`/memory/records/${record.id}`, outsider.cookie)).status,
    404,
  );
  assert.equal(
    (await api(`/memory/records?workspaceId=${workspace}`, outsider.cookie))
      .status,
    404,
  );
  assert.equal(
    (
      await api("/memory/records", owner.cookie, {
        ...input(),
        approvedBy: "fake",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("/memory/records", owner.cookie, {
        ...input(),
        referenceIds: ["invented"],
      })
    ).status,
    400,
  );
  assert.equal(
    (await command(record.id, "submit", developer.cookie)).status,
    403,
  );
});
test("an exact submitted revision needs maintainer approval and retains immutable approval history after edits", async () => {
  assert.equal((await command(record.id, "approve", owner.cookie)).status, 409);
  assert.equal((await command(record.id, "submit", owner.cookie)).status, 200);
  assert.equal(
    (await command(record.id, "approve", reviewer.cookie)).status,
    403,
  );
  const approved = await command(record.id, "approve", owner.cookie);
  assert.equal(approved.status, 200);
  assert.equal(approved.data.authoritative, true);
  assert.equal(approved.data.approvedBy, "memory-owner");
  const linked = await api(
    `/memory/records?workspaceId=${workspace}&snapshotId=${graph.snapshotId}&referenceId=${ref.id}`,
    developer.cookie,
  );
  assert.equal(linked.data.entries[0].id, record.id);
  const updated = await command(record.id, "revisions", owner.cookie, 1, {
    content: { ...content, rationale: "A reviewed correction." },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.revision, 2);
  assert.equal(updated.data.status, "draft");
  assert.equal(
    (await api(`/memory/records?workspaceId=${workspace}`, developer.cookie))
      .data.entries.length,
    0,
  );
  assert.equal(
    (await command(record.id, "approve", owner.cookie, 1)).status,
    409,
  );
  const history = (
    await api(`/memory/records/${record.id}/history`, owner.cookie)
  ).data;
  assert.equal(history.revisions.length, 2);
  assert.equal(history.revisions[1].content.rationale, content.rationale);
  assert(history.revisions[1].approvedAt);
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE engineering_memory_revisions SET content_json='{}' WHERE record_id=? AND revision=1",
        )
        .run(record.id),
    /immutable/,
  );
  await command(record.id, "submit", owner.cookie, 2);
  await command(record.id, "approve", owner.cookie, 2);
});
test("unrelated source edits preserve applicability; relevant changes disclose uncertainty and can request review", async () => {
  const unchanged = snapshot("b", {
    "src/accounts.ts": files["src/accounts.ts"].replace("return 1", "return 2"),
  });
  const matching = await api(
    `/memory/records/${record.id}?snapshotId=${unchanged.snapshotId}`,
    owner.cookie,
  );
  assert.equal(matching.data.applicability.state, "source_unchanged");
  assert.equal(matching.data.authoritative, true);
  const checked = await command(
    record.id,
    "check-applicability",
    owner.cookie,
    2,
    { snapshotId: unchanged.snapshotId },
  );
  assert.equal(checked.data.status, "approved");
  const changed = snapshot("c", {
    "src/accounts.ts": files["src/accounts.ts"].replace(
      "return {email}",
      "return {email, pending:true}",
    ),
  });
  const warning = await api(
    `/memory/records/${record.id}?snapshotId=${changed.snapshotId}`,
    owner.cookie,
  );
  assert.equal(warning.data.applicability.state, "source_changed");
  assert.equal(warning.data.authoritative, false);
  assert.equal(
    (
      await command(record.id, "check-applicability", reviewer.cookie, 2, {
        snapshotId: changed.snapshotId,
      })
    ).status,
    403,
  );
  const reviewed = await command(
    record.id,
    "check-applicability",
    owner.cookie,
    2,
    { snapshotId: changed.snapshotId },
  );
  assert.equal(reviewed.data.status, "needs_review");
  assert(!reviewed.data.publicationNote.includes("proved"));
  assert.equal(
    (
      await command(record.id, "review", owner.cookie, 2, {
        outcome: "still_applicable",
        reason:
          "Keep the historical design explanation; current source still needs contextual review.",
      })
    ).data.status,
    "approved",
  );
});
test("failure lessons preserve an unknown cause and unverified resolution without inventing execution evidence", async () => {
  const failure = await api("/memory/records", developer.cookie, {
    ...input(),
    type: "failure_lesson",
    content: {
      title: "Email delivery failure",
      observedFailure: "A teammate reported a timeout during email delivery.",
      resolution: "Retry after reviewing delivery settings.",
    },
  });
  assert.equal(failure.status, 201, JSON.stringify(failure.data));
  assert.equal(failure.data.content.causeStatus, "unknown");
  assert.equal(failure.data.content.resolutionStatus, "not_verified");
  assert.equal(failure.data.content.reviewedCause, "");
  assert.equal(
    (await command(failure.data.id, "submit", developer.cookie)).status,
    200,
  );
  assert.equal(
    (await command(failure.data.id, "approve", developer.cookie)).status,
    403,
  );
  assert.equal(
    (await command(failure.data.id, "approve", owner.cookie)).status,
    200,
  );
  assert.equal(
    (
      await api("/memory/records", owner.cookie, {
        ...input(),
        type: "failure_lesson",
        content: {
          title: "Unsafe verification claim",
          resolutionStatus: "maintainer_reported",
        },
      })
    ).status,
    400,
  );
});
test("accepted handoffs promote once into linked knowledge; reopening removes current authority without duplicating discussions", async () => {
  const handoff = await api("/handoffs", owner.cookie, {
    workspaceId: workspace,
    snapshotId: graph.snapshotId,
    referenceId: ref.id,
    startLine: 1,
    endLine: 1,
    title: "Why require email?",
    question: "Why reject empty email?",
    requestId: randomUUID(),
  });
  assert.equal(handoff.status, 201, JSON.stringify(handoff.data));
  const id = handoff.data.session.id;
  assert.equal(
    (await api(`/handoffs/${id}/approve-knowledge`, owner.cookie, {})).status,
    409,
  );
  const proposal = await api(`/handoffs/${id}/resolution`, reviewer.cookie, {
    solution: "Keep identity required.",
    explanation: "The account contract requires identity before persistence.",
  });
  assert.equal(proposal.status, 201);
  await api(`/handoffs/${id}/confirm-resolution`, owner.cookie, {
    resolutionId: proposal.data.resolutions[0].id,
  });
  assert.equal(
    (await api(`/handoffs/${id}/approve-knowledge`, reviewer.cookie, {}))
      .status,
    403,
  );
  const promoted = await api(
    `/handoffs/${id}/approve-knowledge`,
    owner.cookie,
    { type: "failure_lesson" },
  );
  assert.equal(promoted.status, 200, JSON.stringify(promoted.data));
  const linked = promoted.data.memoryRecords[0];
  assert.equal(linked.type, "failure_lesson");
  await api(`/handoffs/${id}/approve-knowledge`, owner.cookie, {
    type: "failure_lesson",
  });
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM engineering_memory WHERE origin_session_id=?",
      )
      .get(id).n,
    1,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM handoff_sessions WHERE id=?").get(id)
      .n,
    1,
  );
  const knowledge = (await api(`/memory/records/${linked.id}`, owner.cookie))
    .data;
  assert.equal(knowledge.origin_session_id, id);
  assert.equal(knowledge.content.causeStatus, "unknown");
  await api(
    `/handoffs/${id}/status`,
    owner.cookie,
    { status: "OPEN" },
    "PATCH",
  );
  assert.equal(
    (await api(`/memory/records/${linked.id}`, owner.cookie)).data.status,
    "needs_review",
  );
  assert.equal(
    (
      await command(linked.id, "review", owner.cookie, 1, {
        outcome: "still_applicable",
        reason: "Try restoring it.",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api(`/handoffs/knowledge?workspaceId=${workspace}`, owner.cookie)
    ).data.entries.some((e) => e.id === id),
    false,
  );
});
test("supersession and withdrawal are audited, preserve history and require a replacement from the same workspace", async () => {
  const replacement = (
    await api("/memory/records", owner.cookie, {
      ...input(),
      content: { ...content, title: "Updated email identity decision" },
    })
  ).data;
  await command(replacement.id, "submit", owner.cookie);
  await command(replacement.id, "approve", owner.cookie);
  const invalid = await command(record.id, "supersede", owner.cookie, 2, {
    replacementId: record.id,
    reason: "Invalid self reference",
  });
  assert.equal(invalid.status, 400);
  const replaced = await command(record.id, "supersede", owner.cookie, 2, {
    replacementId: replacement.id,
    reason: "The updated record gives the current constraints.",
  });
  assert.equal(replaced.data.status, "superseded");
  assert.equal(replaced.data.superseded_by, replacement.id);
  assert.equal(
    (await command(record.id, "revisions", owner.cookie, 2, { content }))
      .status,
    409,
  );
  assert.equal(
    (
      await command(replacement.id, "withdraw", reviewer.cookie, 1, {
        reason: "Reviewer cannot withdraw",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await command(replacement.id, "withdraw", owner.cookie, 1, {
        reason: "Explanation requires additional evidence.",
      })
    ).data.status,
    "withdrawn",
  );
  const history = (
    await api(`/memory/records/${record.id}/history`, owner.cookie)
  ).data;
  assert(history.events.some((e) => e.action === "supersede"));
  assert.equal(history.revisions.length, 2);
});

test("simultaneous corrections cannot overwrite the revision a maintainer reviewed", async () => {
  const created = (await api("/memory/records", owner.cookie, input())).data;
  const results = await Promise.all([
    command(created.id, "revisions", owner.cookie, 1, {
      content: { ...content, rationale: "Correction A" },
    }),
    command(created.id, "revisions", owner.cookie, 1, {
      content: { ...content, rationale: "Correction B" },
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const history = (
    await api(`/memory/records/${created.id}/history`, owner.cookie)
  ).data;
  assert.equal(history.revisions.length, 2);
  assert.equal(history.revisions[1].content.rationale, content.rationale);
});
