import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.DATABASE_PATH = ":memory:";
const { db, saveSnapshot } = await import("../src/storage.js");
const { analyze } = await import("../src/analyzer.js");
const {
  approveRecord,
  createQuestion,
  createRecord,
  getQuestion,
  getRecord,
  listQuestions,
  listRecordHistory,
  markNeedsReview,
  resolveQuestion,
  resolveReview,
  respondToQuestion,
  readQuestionAttachment,
  reviseRecord,
  searchRecords,
  saveQuestionAttachment,
  submitRecord,
  supersedeRecord,
  withdrawRecord,
} = await import("../src/decisionMemory.js");
const { createDecisionMemoryRoutes } =
  await import("../src/decisionMemoryRoutes.js");
const { createDecisionMemoryAuth } =
  await import("../src/decisionMemoryAuth.js");

const repository = "https://github.com/example/memory";
const files = {
  "src/service.js": "export function save(value) { return value; }\n",
  "src/service.test.js": "export function testSave() { return true; }\n",
};
const graph = analyze({ repository, commit: "a".repeat(40), files });
saveSnapshot(graph, {}, "", files);
const sourceRef = graph.references.find(
  (item) => item.file === "src/service.js",
);
const testRef = graph.references.find(
  (item) => item.file === "src/service.test.js",
);
const maintainer = {
  userId: "maintainer-1",
  repositoryRoles: { [repository]: "maintainer" },
};
const author = {
  userId: "author-1",
  repositoryRoles: { [repository]: "contributor" },
};
const decision = (title = "Use a persistence boundary") => ({
  title,
  summary: "Keep persistence concerns behind the service interface.",
  context: "The application has service and storage responsibilities.",
  decision: "Keep storage operations behind the repository boundary.",
  rationale: "This keeps callers independent of storage details.",
  constraints: ["Do not expose database calls in request handlers."],
  alternatives: [
    { option: "Inline database access", reasonRejected: "Tighter coupling." },
  ],
  consequences: ["Repository changes can be tested separately."],
  openQuestions: [],
});
const evidence = [
  {
    kind: "source_code",
    snapshotId: graph.snapshotId,
    referenceId: sourceRef.id,
  },
];

test("records are repository-scoped, evidence-checked and drafts are not public retrieval", () => {
  const record = createRecord(
    { repository, type: "decision", content: decision(), evidence },
    author,
  );
  assert.equal(record.status, "draft");
  assert.equal(record.authoritative, false);
  assert.equal(searchRecords({ repository }).total, 0);
  assert.throws(
    () => getRecord(record.id, repository),
    (error) => error.status === 404,
  );
  assert.equal(
    searchRecords({ repository, includeDrafts: true }, maintainer).total,
    1,
  );
  assert.throws(
    () =>
      createRecord({
        repository,
        type: "decision",
        content: decision(),
        evidence: [{ ...evidence[0], referenceId: "not-a-reference" }],
      }),
    /source reference not found/i,
  );
  assert.throws(
    () =>
      createRecord({
        repository: "https://github.com/example/other",
        type: "decision",
        content: decision(),
      }),
    (error) => error.status === 404,
  );
});

test("approval requires a trusted maintainer, applies to one revision and preserves prior revisions", () => {
  const record = createRecord(
    { repository, type: "decision", content: decision(), evidence },
    author,
  );
  submitRecord(record.id, 1, author);
  assert.throws(
    () => approveRecord(record.id, 1, null),
    (error) => error.status === 503,
  );
  assert.throws(
    () => approveRecord(record.id, 1, author),
    (error) => error.status === 404,
  );
  const approved = approveRecord(record.id, 1, maintainer);
  assert.equal(approved.status, "approved");
  assert.equal(approved.revision.approvedBy, maintainer.userId);
  assert.equal(approved.revision.number, 1);
  assert.equal(searchRecords({ repository }).total, 1);

  const revised = reviseRecord(
    record.id,
    {
      expectedRevision: 1,
      content: decision("Use an explicit repository boundary"),
      evidence,
    },
    author,
  );
  assert.equal(revised.status, "draft");
  assert.equal(revised.currentRevision, 2);
  assert.equal(revised.revision.approvedAt, null);
  assert.equal(searchRecords({ repository }).total, 0);
  assert.throws(
    () =>
      reviseRecord(
        record.id,
        { expectedRevision: 1, content: decision("Stale"), evidence },
        author,
      ),
    (error) => error.status === 409,
  );
  const history = listRecordHistory(record.id, repository, maintainer);
  assert.equal(history.revisions.length, 2);
  assert.equal(history.revisions[0].approvedBy, maintainer.userId);
  assert.equal(history.revisions[1].approvedBy, null);
});

test("failure lessons preserve unknown causes and require evidence for verified claims", () => {
  const failure = {
    title: "Upload timed out",
    summary: "An upload did not complete within the configured request window.",
    observedFailure: "The upload request returned a timeout.",
    causeStatus: "unknown",
    resolutionVerified: false,
  };
  const record = createRecord({
    repository,
    type: "failure_lesson",
    content: failure,
  });
  assert.equal(record.revision.content.causeStatus, "unknown");
  assert.equal(record.revision.content.resolutionVerified, false);
  assert.throws(
    () =>
      createRecord({
        repository,
        type: "failure_lesson",
        content: { ...failure, causeStatus: "confirmed" },
      }),
    /confirmed cause must include/i,
  );
  assert.throws(
    () =>
      createRecord({
        repository,
        type: "failure_lesson",
        content: {
          ...failure,
          resolution: "Increase timeout",
          resolutionVerified: true,
        },
        evidence: evidence,
      }),
    /test or observed-run evidence/i,
  );
  const verified = createRecord({
    repository,
    type: "failure_lesson",
    content: {
      ...failure,
      resolution: "Apply the validated fix",
      resolutionVerified: true,
    },
    evidence: [
      {
        kind: "test",
        snapshotId: graph.snapshotId,
        referenceId: testRef.id,
      },
    ],
  });
  assert.equal(verified.revision.content.resolutionVerified, true);
});

test("maintainer questions deduplicate normalized text and preserve every occurrence", () => {
  const first = createQuestion({
    repository,
    question: "Why is storage kept behind a service?",
    evidence,
    origin: "why_question",
  });
  const duplicate = createQuestion({
    repository,
    question: "  WHY is storage kept behind a service?! ",
    evidence,
    origin: "journey",
  });
  assert.equal(first.id, duplicate.id);
  assert.equal(duplicate.occurrenceCount, 2);
  assert.throws(
    () => listQuestions(repository, null),
    (error) => error.status === 503,
  );
  assert.equal(listQuestions(repository, maintainer).questions.length, 1);
  const response = respondToQuestion(
    first.id,
    {
      response: "The service boundary isolates persistence behavior.",
      evidence,
    },
    maintainer,
  );
  assert.equal(response.status, "open");
  assert.equal(
    response.response,
    "The service boundary isolates persistence behavior.",
  );
  assert.equal(response.responseEvidence[0].referenceId, sourceRef.id);
  const attachment = saveQuestionAttachment(
    first.id,
    {
      filename: "review-notes.txt",
      contentType: "text/plain",
      content: Buffer.from("Reviewed evidence"),
    },
    maintainer,
  );
  const persistedQuestion = listQuestions(
    repository,
    maintainer,
    "all",
  ).questions.find((item) => item.id === first.id);
  assert.equal(persistedQuestion.response, response.response);
  assert.equal(persistedQuestion.attachments[0].id, attachment.id);
  assert.equal(
    readQuestionAttachment(
      first.id,
      attachment.id,
      maintainer,
    ).content.toString(),
    "Reviewed evidence",
  );
  const record = createRecord({
    repository,
    type: "decision",
    content: decision(),
    evidence,
  });
  const resolved = resolveQuestion(
    first.id,
    { response: "See the reviewed decision.", recordId: record.id },
    maintainer,
  );
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.resolvedRecordId, record.id);
  assert.equal(
    getQuestion(first.id, repository, maintainer).response,
    "See the reviewed decision.",
  );

  const closed = createQuestion({
    repository,
    question: "Why is the cache bounded?",
  });
  assert.equal(
    resolveQuestion(
      closed.id,
      { closeReason: "No rationale could be verified." },
      maintainer,
    ).status,
    "closed",
  );
  const answered = createQuestion({
    repository,
    question: "Why is the retry delay capped?",
  });
  const answeredAndResolved = resolveQuestion(
    answered.id,
    { response: "The cap prevents retries from growing without bound." },
    maintainer,
  );
  assert.equal(answeredAndResolved.status, "resolved");
  assert.equal(
    listQuestions(repository, maintainer, "all").questions.find(
      (item) => item.id === answered.id,
    ).response,
    "The cap prevents retries from growing without bound.",
  );
});

test("review, withdrawal and supersession keep history and remove obsolete guidance from normal retrieval", () => {
  function approved(title) {
    const record = createRecord({
      repository,
      type: "decision",
      content: decision(title),
      evidence,
    });
    submitRecord(record.id, 1);
    return approveRecord(record.id, 1, maintainer);
  }
  const original = approved("Original decision");
  markNeedsReview(original.id, 1, "A related source was changed", maintainer);
  assert.equal(searchRecords({ repository }).items[0].status, "needs_review");
  const restored = resolveReview(
    original.id,
    1,
    "still_applicable",
    "Reviewed against the current source",
    maintainer,
  );
  assert.equal(restored.status, "approved");

  const replacement = approved("Replacement decision");
  supersedeRecord(original.id, replacement.id, 1, maintainer);
  assert.equal(
    getRecord(original.id, repository, maintainer).status,
    "superseded",
  );
  assert.equal(
    searchRecords({ repository }).items.some((item) => item.id === original.id),
    false,
  );
  assert.equal(
    searchRecords({ repository }).items.some(
      (item) => item.id === replacement.id,
    ),
    true,
  );

  const withdrawn = approved("Withdrawn decision");
  withdrawRecord(withdrawn.id, 1, "No longer applicable", maintainer);
  assert.equal(
    searchRecords({ repository }).items.some(
      (item) => item.id === withdrawn.id,
    ),
    false,
  );
  assert.equal(
    getRecord(withdrawn.id, repository, maintainer).status,
    "withdrawn",
  );
});

test("HTTP routes expose draft creation but keep approval unavailable without trusted identity middleware", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/decision-memory", createDecisionMemoryRoutes());
  app.use((error, _req, res, _next) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/decision-memory`;
    const createdResponse = await fetch(`${base}/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repository,
        type: "decision",
        content: decision("HTTP-created decision"),
        evidence,
      }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    const approvalResponse = await fetch(
      `${base}/records/${created.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: 1 }),
      },
    );
    assert.equal(approvalResponse.status, 503);
    assert.match(
      (await approvalResponse.json()).error,
      /identity is not configured/i,
    );
    const draftResponse = await fetch(
      `${base}/records/${created.id}?repository=${encodeURIComponent(repository)}`,
    );
    assert.equal(draftResponse.status, 404);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("F07 auth adapter ignores request-supplied identity and accepts only resolver output", async () => {
  const app = express();
  app.use((req, _res, next) => {
    req.auth = {
      userId: "spoofed",
      repositoryRoles: { [repository]: "maintainer" },
    };
    next();
  });
  app.use(createDecisionMemoryAuth());
  app.get("/identity", (req, res) => res.json({ principal: req.auth }));
  app.get(
    "/trusted-identity",
    createDecisionMemoryAuth(() => maintainer),
    (req, res) => res.json({ principal: req.auth }),
  );
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const anonymous = await fetch(`${base}/identity`, {
      headers: {
        Authorization: "Bearer attacker-token",
        "X-User-Id": "attacker",
        "X-Repository-Role": "maintainer",
      },
    }).then((response) => response.json());
    assert.equal(anonymous.principal, null);
    const trusted = await fetch(`${base}/trusted-identity`).then((response) =>
      response.json(),
    );
    assert.equal(trusted.principal.userId, maintainer.userId);
    assert.equal(trusted.principal.repositoryRoles[repository], "maintainer");
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("F07 demo identity can draft, review and approve without a role assignment", async () => {
  const demoAuth = createDecisionMemoryAuth(async () => ({
    userId: "f07-demo-user",
    demo: true,
    repositoryRoles: {},
  }));
  const app = express();
  app.use(express.json());
  app.use(
    demoAuth,
    createDecisionMemoryRoutes({ getPrincipal: (req) => req.auth }),
  );
  app.use((error, _req, res, _next) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const createdResponse = await fetch(`${base}/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repository,
        type: "decision",
        content: decision("Demo-only approval"),
        evidence,
      }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.revision.submittedBy, "f07-demo-user");

    const draft = await fetch(
      `${base}/records/${created.id}?repository=${encodeURIComponent(repository)}`,
    );
    assert.equal(draft.status, 200);
    await fetch(`${base}/records/${created.id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1 }),
    }).then(async (response) =>
      assert.equal(response.status, 200, await response.text()),
    );
    const approved = await fetch(`${base}/records/${created.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    assert.equal(approved.status, 200);
    const result = await approved.json();
    assert.equal(result.status, "approved");
    assert.equal(result.revision.approvedBy, "f07-demo-user");

    const question = await fetch(`${base}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repository,
        question: "How do I review this record?",
      }),
    });
    assert.equal(question.status, 201);
    const createdQuestion = await question.json();
    const sourceComponent = graph.components.find(
      (component) => component.referenceId === sourceRef.id,
    );
    assert.ok(sourceComponent);
    const suggestionResponse = await fetch(
      `${base}/questions/${createdQuestion.id}/suggestion`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          componentId: sourceComponent.id,
          snapshotId: graph.snapshotId,
        }),
      },
    );
    assert.equal(suggestionResponse.status, 200);
    const suggestion = await suggestionResponse.json();
    assert.equal(typeof suggestion.response, "string");
    assert.ok(suggestion.citations.some((item) => item.id === sourceRef.id));
    assert.equal(suggestion.source.componentId, sourceComponent.id);
    assert.equal(
      getQuestion(createdQuestion.id, repository, {
        userId: "f07-demo-user",
        demo: true,
        repositoryRoles: {},
      }).response,
      null,
    );
    const invalidSourceSuggestion = await fetch(
      `${base}/questions/${createdQuestion.id}/suggestion`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          componentId: "not-in-this-snapshot",
          snapshotId: graph.snapshotId,
        }),
      },
    );
    assert.equal(invalidSourceSuggestion.status, 404);
    const attachmentResponse = await fetch(
      `${base}/questions/${createdQuestion.id}/attachments`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent("answer-notes.txt"),
          "X-File-Type": "text/plain",
        },
        body: Buffer.from("reviewed notes"),
      },
    );
    assert.equal(attachmentResponse.status, 201);
    const attachment = await attachmentResponse.json();
    const response = await fetch(
      `${base}/questions/${createdQuestion.id}/respond`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response:
            "The delay prevents repeated work from overwhelming the service.",
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal(
      (await response.json()).response,
      "The delay prevents repeated work from overwhelming the service.",
    );
    const persistedQuestions = await fetch(
      `${base}/questions?repository=${encodeURIComponent(repository)}&status=all`,
    ).then((result) => result.json());
    const persistedQuestion = persistedQuestions.questions.find(
      (item) => item.id === createdQuestion.id,
    );
    assert.equal(
      persistedQuestion.response,
      "The delay prevents repeated work from overwhelming the service.",
    );
    assert.equal(persistedQuestion.attachments[0].id, attachment.id);
    const downloadedAttachment = await fetch(
      `${base}/questions/${createdQuestion.id}/attachments/${attachment.id}`,
    );
    assert.equal(downloadedAttachment.status, 200);
    assert.equal(await downloadedAttachment.text(), "reviewed notes");
    const resolved = await fetch(
      `${base}/questions/${createdQuestion.id}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response:
            "The delay prevents repeated work from overwhelming the service.",
        }),
      },
    );
    assert.equal(resolved.status, 200);
    assert.equal((await resolved.json()).status, "resolved");
    const questionList = await fetch(
      `${base}/questions?repository=${encodeURIComponent(repository)}`,
    );
    assert.equal(questionList.status, 200);
    assert.equal((await questionList.json()).questions.length, 0);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
