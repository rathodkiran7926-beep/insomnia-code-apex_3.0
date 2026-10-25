import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_PATH = ":memory:";
const { db } = await import("../src/storage.js");
await import("../src/practice.js");
const { repositoryProgress, repositoryCommits } =
  await import("../src/progressReport.js");
db.exec(
  "CREATE TABLE IF NOT EXISTS pr_comparisons(id TEXT PRIMARY KEY,base_snapshot_id TEXT,head_snapshot_id TEXT,data TEXT)",
);
const learner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const repository = "https://github.com/example/progress";
const first = "a".repeat(24),
  second = "b".repeat(24),
  foreign = "c".repeat(24);
for (const [id, repo, commit] of [
  [first, repository, "1".repeat(40)],
  [second, repository, "2".repeat(40)],
  [foreign, "https://github.com/example/other", "3".repeat(40)],
]) {
  db.prepare("INSERT INTO snapshots VALUES (?,?,?,?)").run(
    id,
    repo,
    commit,
    "{}",
  );
  db.prepare("INSERT INTO components VALUES (?,?,?)").run(
    "c1",
    id,
    JSON.stringify({ name: "actualHandler" }),
  );
}
db.prepare("INSERT INTO practice_tasks VALUES (?,?,?,?,?)").run(
  "task",
  first,
  "c1",
  "beginner",
  JSON.stringify({ title: "Change actualHandler" }),
);
function attempt(id, owner, snapshot, status) {
  db.prepare("INSERT INTO practice_attempts VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    id,
    owner,
    snapshot,
    "task",
    "beginner",
    "PRIVATE DRAFT",
    "PRIVATE REFLECTION",
    status,
    "[]",
    "2026-10-25T10:00:00Z",
  );
}
for (let i = 0; i < 26; i++)
  attempt(
    `attempt-${i}`,
    learner,
    i % 2 ? first : second,
    i % 2 ? "passed" : "failed",
  );
attempt("other-learner", other, first, "passed");
attempt("other-repository", learner, foreign, "passed");
for (const [id, owner, snap] of [
  ["q1", learner, first],
  ["q2", learner, "learning-journey"],
  ["q3", other, first],
  ["q4", learner, foreign],
]) {
  db.prepare("INSERT INTO practice_quiz_sessions VALUES (?,?,?,?,?,?)").run(
    id,
    owner,
    snap,
    "beginner",
    JSON.stringify([{ id: "one" }, { id: "two" }]),
    "2026-10-25T10:00:00Z",
  );
  db.prepare("INSERT INTO practice_quiz_answers VALUES (?,?,?,?,?,?,?)").run(
    id + "answer",
    id,
    "one",
    "concept",
    "chosen",
    1,
    "2026-10-25T10:01:00Z",
  );
}
db.prepare("INSERT INTO pr_comparisons VALUES (?,?,?,?)").run(
  "comparison",
  first,
  second,
  JSON.stringify({
    createdAt: "2026-10-25T10:02:00Z",
    pr: { title: "Update handler", number: 7, files: [{ path: "app.ts" }] },
    privatePatch: "PRIVATE DIFF",
  }),
);

test("progress totals include all repository versions and general quizzes, but exclude other learners and repositories", () => {
  const result = repositoryProgress({
    snapshotId: first,
    learnerId: learner,
    journeyIds: `repo-${first}-c1,repo-${foreign}-c1`,
  });
  assert.equal(result.summary.attempts, 26);
  assert.equal(result.summary.syntaxPassed, 13);
  assert.equal(result.summary.syntaxFailed, 13);
  assert.equal(result.summary.tasksAttempted, 1);
  assert.equal(result.summary.quizSessions, 2);
  assert.equal(result.summary.quizAnswered, 2);
  assert.equal(result.summary.quizCorrect, 2);
  assert.equal(result.summary.commitsAnalyzed, 2);
  assert.equal(result.summary.comparisons, 1);
  assert.equal(result.comparisons[0].filesChanged, 1);
  assert.equal(result.attempts.length, 25);
  assert.equal(result.hasMore.attempts, true);
  assert.equal(result.journeys.length, 1);
  assert.equal(result.journeys[0].title, "Follow actualHandler");
  assert(result.quizzes.some((q) => q.snapshotId === "learning-journey"));
  assert.doesNotMatch(
    JSON.stringify(result),
    /PRIVATE|other-learner|other-repository/,
  );
  const next = repositoryProgress({
    snapshotId: first,
    learnerId: learner,
    page: 2,
  });
  assert.equal(next.attempts.length, 1);
  assert.equal(next.hasMore.attempts, false);
  assert.equal(next.summary.attempts, 26);
  assert(!result.attempts.some((a) => a.id === next.attempts[0].id));
});
test("invalid or missing snapshot and learner IDs cannot produce a progress report", () => {
  assert.throws(
    () => repositoryProgress({ snapshotId: "missing", learnerId: learner }),
    (e) => e.status === 404,
  );
  assert.throws(() =>
    repositoryProgress({ snapshotId: first, learnerId: "invalid" }),
  );
  assert.throws(() =>
    repositoryProgress({ snapshotId: first, learnerId: learner, page: 0 }),
  );
});
test("commit history is pinned to the selected snapshot and paginated without claiming total counts", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const request = new URL(url);
    assert.equal(request.hostname, "api.github.com");
    assert.equal(request.pathname, "/repos/example/progress/commits");
    assert.equal(request.searchParams.get("sha"), "1".repeat(40));
    assert.equal(request.searchParams.get("page"), "2");
    return Response.json([
      {
        sha: "4".repeat(40),
        commit: {
          message: "Actual commit\nDetails",
          author: { name: "Developer", date: "2026-10-25T10:00:00Z" },
        },
      },
    ]);
  };
  try {
    const result = await repositoryCommits({ snapshotId: first, page: 2 });
    assert.equal(result.commits[0].message, "Actual commit");
    assert.equal(result.commits[0].author, "Developer");
    assert.equal(result.hasMore, false);
    assert.equal(result.repository, repository);
    assert.equal(result.total, undefined);
  } finally {
    globalThis.fetch = original;
  }
});
