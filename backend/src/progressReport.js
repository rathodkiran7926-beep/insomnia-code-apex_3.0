import { z } from "zod";
import { db } from "./storage.js";
import { boundedFetch, parseRepository } from "./github.js";

const querySchema = z
  .object({
    snapshotId: z.string().min(1).max(150),
    learnerId: z.string().uuid(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    journeyIds: z.string().max(40000).default(""),
  })
  .strict();
const pageSize = 25;
function snapshot(id) {
  const row = db
    .prepare(
      "SELECT repository_id,commit_sha,graph_json FROM snapshots WHERE id=?",
    )
    .get(id);
  if (!row)
    throw Object.assign(
      new Error("Analyze a repository before opening its progress report."),
      { status: 404 },
    );
  return row;
}
export function repositoryProgress(input) {
  const query = querySchema.parse(input);
  const current = snapshot(query.snapshotId);
  const scope = "SELECT id FROM snapshots WHERE repository_id=?";
  const summary = db
    .prepare(
      `SELECT count(*) AS attempts,
    coalesce(sum(syntax_status='passed'),0) AS syntaxPassed,
    coalesce(sum(syntax_status='failed'),0) AS syntaxFailed,
    count(DISTINCT CASE WHEN review_status='passed' THEN task_id END) AS tasksCompleted,
    coalesce(sum(review_status='passed'),0) AS reviewsPassed,
    count(DISTINCT task_id) AS tasksAttempted
    FROM practice_attempts WHERE learner_id=? AND snapshot_id IN (${scope})`,
    )
    .get(query.learnerId, current.repository_id);
  const quiz = db
    .prepare(
      `SELECT count(DISTINCT s.id) AS sessions,
    count(a.id) AS answered,coalesce(sum(a.correct),0) AS correct
    FROM practice_quiz_sessions s LEFT JOIN practice_quiz_answers a ON a.session_id=s.id
    WHERE s.learner_id=? AND (s.snapshot_id IN (${scope}) OR s.snapshot_id='learning-journey')`,
    )
    .get(query.learnerId, current.repository_id);
  const offset = (query.page - 1) * pageSize;
  const attempts = db
    .prepare(
      `SELECT a.id,a.snapshot_id AS snapshotId,a.task_id AS taskId,
    a.difficulty,a.syntax_status AS status,a.review_status AS reviewStatus,a.created_at AS createdAt,
    json_extract(t.data,'$.title') AS title
    FROM practice_attempts a LEFT JOIN practice_tasks t ON t.task_id=a.task_id
    WHERE a.learner_id=? AND a.snapshot_id IN (${scope})
    ORDER BY a.created_at DESC,a.id LIMIT ? OFFSET ?`,
    )
    .all(query.learnerId, current.repository_id, pageSize + 1, offset);
  const quizzes = db
    .prepare(
      `SELECT s.id,s.snapshot_id AS snapshotId,s.difficulty,s.created_at AS createdAt,
    json_array_length(s.questions) AS questions,count(a.id) AS answered,coalesce(sum(a.correct),0) AS correct,
    max(a.answered_at) AS lastAnsweredAt
    FROM practice_quiz_sessions s LEFT JOIN practice_quiz_answers a ON a.session_id=s.id
    WHERE s.learner_id=? AND (s.snapshot_id IN (${scope}) OR s.snapshot_id='learning-journey') GROUP BY s.id
    ORDER BY s.created_at DESC,s.id LIMIT ? OFFSET ?`,
    )
    .all(query.learnerId, current.repository_id, pageSize + 1, offset);
  const comparisonScope = `FROM pr_comparisons p JOIN snapshots s ON s.id=p.head_snapshot_id WHERE s.repository_id=?`;
  const comparisonsTotal = db
    .prepare(`SELECT count(*) AS n ${comparisonScope}`)
    .get(current.repository_id).n;
  const comparisons = db
    .prepare(
      `SELECT p.id,p.base_snapshot_id AS beforeSnapshotId,p.head_snapshot_id AS afterSnapshotId,
    json_extract(p.data,'$.pr.number') AS number,json_extract(p.data,'$.pr.title') AS title,
    json_extract(p.data,'$.createdAt') AS createdAt,json_array_length(p.data,'$.pr.files') AS filesChanged
    ${comparisonScope} ORDER BY json_extract(p.data,'$.createdAt') DESC,p.id LIMIT ? OFFSET ?`,
    )
    .all(current.repository_id, pageSize + 1, offset);
  const snapshots = db
    .prepare(
      `SELECT id AS snapshotId,commit_sha AS "commit" FROM snapshots WHERE repository_id=? ORDER BY rowid DESC`,
    )
    .all(current.repository_id);
  const journeys = [];
  for (const id of [
    ...new Set(query.journeyIds.split(",").filter(Boolean)),
  ].slice(0, 500)) {
    const match = /^repo-([a-f0-9]{24})-(c\d+)$/.exec(id);
    if (!match) continue;
    const component = db
      .prepare(
        `SELECT json_extract(c.data,'$.name') AS name
      FROM components c JOIN snapshots s ON s.id=c.snapshot_id
      WHERE c.snapshot_id=? AND c.id=? AND s.repository_id=?`,
      )
      .get(match[1], match[2], current.repository_id);
    if (component)
      journeys.push({
        id,
        snapshotId: match[1],
        title: `Follow ${component.name}`,
      });
  }
  return {
    repository: current.repository_id,
    snapshotId: query.snapshotId,
    generatedAt: new Date().toISOString(),
    summary: {
      ...summary,
      quizSessions: quiz.sessions,
      quizAnswered: quiz.answered,
      quizCorrect: quiz.correct,
      comparisons: comparisonsTotal,
      snapshots: snapshots.length,
      commitsAnalyzed: new Set(snapshots.map((s) => s.commit)).size,
    },
    snapshots,
    journeys,
    attempts: attempts.slice(0, pageSize),
    quizzes: quizzes.slice(0, pageSize),
    comparisons: comparisons.slice(0, pageSize),
    page: query.page,
    hasMore: {
      attempts: attempts.length > pageSize,
      quizzes: quizzes.length > pageSize,
      comparisons: comparisons.length > pageSize,
    },
  };
}
export async function repositoryCommits(input, signal) {
  const query = z
    .object({
      snapshotId: z.string().min(1).max(150),
      page: z.coerce.number().int().min(1).max(1000).default(1),
    })
    .strict()
    .parse(input);
  const current = snapshot(query.snapshotId);
  const repo = parseRepository(current.repository_id);
  const params = new URLSearchParams({
    sha: current.commit_sha,
    per_page: "30",
    page: String(query.page),
  });
  const data = JSON.parse(
    await boundedFetch(
      `https://api.github.com/repos/${repo.owner}/${repo.name}/commits?${params}`,
      {
        signal,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Codebase-Mentor",
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
      },
    ),
  );
  if (!Array.isArray(data))
    throw new Error("GitHub returned an invalid commit list.");
  return {
    repository: repo.url,
    throughCommit: current.commit_sha,
    page: query.page,
    hasMore: data.length === 30,
    commits: data.map((item) => ({
      sha: item.sha,
      message: String(item.commit?.message || "")
        .split("\n")[0]
        .slice(0, 500),
      author: String(
        item.author?.login || item.commit?.author?.name || "Unknown author",
      ).slice(0, 150),
      date: item.commit?.author?.date || null,
      url: `${repo.url}/commit/${item.sha}`,
    })),
  };
}
