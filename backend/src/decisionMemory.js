import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./storage.js";
import { parseRepository } from "./github.js";
import { answerQuestion } from "./workspace.js";

const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const now = () => new Date().toISOString();
const userIdSchema = z.string().trim().min(1).max(200);
const evidenceSchema = z
  .object({
    kind: z.enum([
      "source_code",
      "test",
      "documentation",
      "pull_request",
      "incident",
      "observed_run",
      "maintainer_explanation",
      "other",
    ]),
    snapshotId: z.string().max(150).optional(),
    referenceId: z.string().max(200).optional(),
    description: z.string().trim().max(1000).optional(),
    externalRef: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine(
    (item) =>
      Boolean(item.snapshotId) === Boolean(item.referenceId) ||
      (!item.snapshotId && !item.referenceId),
    "Snapshot and source-reference IDs must be provided together",
  )
  .refine(
    (item) =>
      Boolean(item.snapshotId && item.referenceId) ||
      Boolean(item.description || item.externalRef),
    "Evidence needs a source reference, description, or external reference",
  );
const textList = z.array(z.string().trim().min(1).max(1000)).max(30);
const decisionContentSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    summary: z.string().trim().min(1).max(2000),
    context: z.string().trim().max(5000).optional(),
    decision: z.string().trim().max(5000).optional(),
    rationale: z.string().trim().max(5000).optional(),
    constraints: textList.default([]),
    alternatives: z
      .array(
        z
          .object({
            option: z.string().trim().min(1).max(500),
            reasonRejected: z.string().trim().max(2000).optional(),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    consequences: textList.default([]),
    openQuestions: textList.default([]),
  })
  .strict();
const failureContentSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    summary: z.string().trim().min(1).max(2000),
    observedFailure: z.string().trim().min(1).max(5000),
    environment: z.string().trim().max(3000).optional(),
    suspectedCause: z.string().trim().max(5000).optional(),
    causeStatus: z
      .enum(["unknown", "suspected", "confirmed"])
      .default("unknown"),
    resolution: z.string().trim().max(5000).optional(),
    resolutionVerified: z.boolean().default(false),
    preventiveRule: z.string().trim().max(3000).optional(),
  })
  .strict();
const evidenceListSchema = z.array(evidenceSchema).max(80);
const recordTypeSchema = z.enum(["decision", "failure_lesson"]);

function repositoryUrl(value) {
  try {
    return parseRepository(value).url;
  } catch {
    throw fail("Enter a public https://github.com/owner/repository URL");
  }
}

function assertRepositoryExists(repository) {
  const row = db
    .prepare("SELECT id FROM repositories WHERE id=? OR url=?")
    .get(repository, repository);
  if (!row) throw fail("Repository has not been analyzed by this backend", 404);
}

function validateEvidence(repository, evidence) {
  const checked = evidenceListSchema.parse(evidence || []);
  for (const item of checked) {
    if (!item.snapshotId) continue;
    const row = db
      .prepare("SELECT graph_json FROM snapshots WHERE id=?")
      .get(item.snapshotId);
    if (!row) throw fail("Evidence snapshot not found", 404);
    const graph = JSON.parse(row.graph_json);
    if (repositoryUrl(graph.repository) !== repository)
      throw fail("Evidence belongs to a different repository", 400);
    if (
      !graph.references.some((reference) => reference.id === item.referenceId)
    )
      throw fail("Evidence source reference not found in its snapshot", 400);
  }
  return checked;
}

function validateContent(type, value, evidence) {
  const content =
    type === "decision"
      ? decisionContentSchema.parse(value)
      : failureContentSchema.parse(value);
  if (
    type === "failure_lesson" &&
    content.causeStatus === "confirmed" &&
    !evidence.length
  )
    throw fail("A confirmed cause must include reviewed supporting evidence");
  if (
    type === "failure_lesson" &&
    content.resolutionVerified &&
    !evidence.some((item) => ["test", "observed_run"].includes(item.kind))
  )
    throw fail(
      "A verified resolution must include test or observed-run evidence",
    );
  return content;
}

function transaction(work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function audit({
  repository,
  recordId = null,
  questionId = null,
  revision = null,
  actorId = null,
  action,
  details = {},
}) {
  db.prepare(
    `INSERT INTO decision_memory_audit
      (id,repository_id,record_id,question_id,revision,actor_id,action,details_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    randomUUID(),
    repository,
    recordId,
    questionId,
    revision,
    actorId,
    action,
    JSON.stringify(details),
    now(),
  );
}

function requireIdentity(principal) {
  if (!principal?.userId)
    throw fail(
      "Authenticated maintainer identity is not configured for this backend",
      503,
    );
  return userIdSchema.parse(principal.userId);
}

function requireMaintainer(principal, repository, hideUnauthorized = false) {
  const actorId = requireIdentity(principal);
  if (principal.demo === true) return actorId;
  if (principal.repositoryRoles?.[repository] !== "maintainer")
    throw fail(
      hideUnauthorized ? "Record not found" : "Maintainer permission required",
      hideUnauthorized ? 404 : 403,
    );
  return actorId;
}

function readRecordRow(id) {
  const row = db
    .prepare("SELECT * FROM decision_memory_records WHERE id=?")
    .get(id);
  if (!row) throw fail("Decision-memory record not found", 404);
  const revision = db
    .prepare(
      `SELECT revision,content_json,evidence_json,submitted_by,created_at,
              approved_by,approved_at
       FROM decision_memory_revisions WHERE record_id=? AND revision=?`,
    )
    .get(id, row.current_revision);
  if (!revision) throw fail("Decision-memory revision is unavailable", 500);
  return {
    id: row.id,
    repository: row.repository_id,
    type: row.record_type,
    status: row.status,
    currentRevision: row.current_revision,
    supersedesId: row.supersedes_id,
    supersededBy: row.superseded_by,
    withdrawnReason: row.withdrawn_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: {
      number: revision.revision,
      content: JSON.parse(revision.content_json),
      evidence: JSON.parse(revision.evidence_json),
      submittedBy: revision.submitted_by,
      createdAt: revision.created_at,
      approvedBy: revision.approved_by,
      approvedAt: revision.approved_at,
    },
    authoritative: row.status === "approved",
  };
}

export function createRecord(input, principal = null) {
  const type = recordTypeSchema.parse(input.type);
  const repository = repositoryUrl(input.repository);
  assertRepositoryExists(repository);
  const evidence = validateEvidence(repository, input.evidence);
  const content = validateContent(type, input.content, evidence);
  const actorId = principal?.userId
    ? userIdSchema.parse(principal.userId)
    : null;
  const id = randomUUID();
  const timestamp = now();
  transaction(() => {
    db.prepare(
      `INSERT INTO decision_memory_records
       (id,repository_id,record_type,status,current_revision,created_at,updated_at)
       VALUES (?,?,?,'draft',1,?,?)`,
    ).run(id, repository, type, timestamp, timestamp);
    db.prepare(
      `INSERT INTO decision_memory_revisions
       (record_id,revision,content_json,evidence_json,submitted_by,created_at)
       VALUES (?,1,?,?,?,?)`,
    ).run(
      id,
      JSON.stringify(content),
      JSON.stringify(evidence),
      actorId,
      timestamp,
    );
    audit({
      repository,
      recordId: id,
      revision: 1,
      actorId,
      action: "record.created",
      details: { type },
    });
  });
  return readRecordRow(id);
}

export function reviseRecord(id, input, principal = null) {
  const current = readRecordRow(id);
  const expectedRevision = z
    .number()
    .int()
    .positive()
    .parse(input.expectedRevision);
  if (expectedRevision !== current.currentRevision)
    throw fail("Record revision changed; reload before editing", 409);
  if (
    !["draft", "awaiting_review", "approved", "needs_review"].includes(
      current.status,
    )
  )
    throw fail(`Cannot revise a ${current.status} record`, 409);
  const actorId = principal?.userId
    ? userIdSchema.parse(principal.userId)
    : null;
  if (current.revision.submittedBy && current.revision.submittedBy !== actorId)
    throw fail("Only the submitting user can edit this draft", 403);
  const evidence = validateEvidence(
    current.repository,
    input.evidence ?? current.revision.evidence,
  );
  const content = validateContent(current.type, input.content, evidence);
  const nextRevision = current.currentRevision + 1;
  const timestamp = now();
  transaction(() => {
    const changed = db
      .prepare(
        `UPDATE decision_memory_records
         SET status='draft',current_revision=?,updated_at=?
         WHERE id=? AND current_revision=? AND status=?`,
      )
      .run(
        nextRevision,
        timestamp,
        id,
        expectedRevision,
        current.status,
      ).changes;
    if (changed !== 1) throw fail("Record revision changed; reload", 409);
    db.prepare(
      `INSERT INTO decision_memory_revisions
       (record_id,revision,content_json,evidence_json,submitted_by,created_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(
      id,
      nextRevision,
      JSON.stringify(content),
      JSON.stringify(evidence),
      actorId,
      timestamp,
    );
    audit({
      repository: current.repository,
      recordId: id,
      revision: nextRevision,
      actorId,
      action: "record.revised",
      details: { previousRevision: expectedRevision },
    });
  });
  return readRecordRow(id);
}

export function submitRecord(id, expectedRevision, principal = null) {
  const record = readRecordRow(id);
  const actorId = principal?.userId
    ? userIdSchema.parse(principal.userId)
    : null;
  if (
    record.currentRevision !==
    z.number().int().positive().parse(expectedRevision)
  )
    throw fail("Record revision changed; reload before submitting", 409);
  if (record.status !== "draft")
    throw fail(`Cannot submit a ${record.status} record`, 409);
  transaction(() => {
    const changed = db
      .prepare(
        `UPDATE decision_memory_records SET status='awaiting_review',updated_at=?
         WHERE id=? AND current_revision=? AND status='draft'`,
      )
      .run(now(), id, expectedRevision).changes;
    if (changed !== 1)
      throw fail("Record changed; reload before submitting", 409);
    audit({
      repository: record.repository,
      recordId: id,
      revision: expectedRevision,
      actorId,
      action: "record.submitted",
    });
  });
  return readRecordRow(id);
}

export function approveRecord(id, expectedRevision, principal) {
  const actorId = requireIdentity(principal);
  const record = readRecordRow(id);
  requireMaintainer(principal, record.repository, true);
  if (
    record.currentRevision !==
    z.number().int().positive().parse(expectedRevision)
  )
    throw fail("Record revision changed; reload before approving", 409);
  if (record.status !== "awaiting_review")
    throw fail("Only a submitted revision can be approved", 409);
  const timestamp = now();
  transaction(() => {
    const changed = db
      .prepare(
        `UPDATE decision_memory_records SET status='approved',updated_at=?
         WHERE id=? AND current_revision=? AND status='awaiting_review'`,
      )
      .run(timestamp, id, expectedRevision).changes;
    if (changed !== 1)
      throw fail("Record changed; reload before approving", 409);
    db.prepare(
      `UPDATE decision_memory_revisions SET approved_by=?,approved_at=?
       WHERE record_id=? AND revision=?`,
    ).run(actorId, timestamp, id, expectedRevision);
    audit({
      repository: record.repository,
      recordId: id,
      revision: expectedRevision,
      actorId,
      action: "record.approved",
    });
  });
  return readRecordRow(id);
}

export function markNeedsReview(id, expectedRevision, reason, principal) {
  const actorId = requireIdentity(principal);
  const record = readRecordRow(id);
  requireMaintainer(principal, record.repository, true);
  if (record.status !== "approved")
    throw fail("Only approved records can be marked for review", 409);
  if (
    record.currentRevision !==
    z.number().int().positive().parse(expectedRevision)
  )
    throw fail(
      "Record revision changed; reload before marking for review",
      409,
    );
  const note = z.string().trim().min(1).max(1000).parse(reason);
  transaction(() => {
    const changed = db
      .prepare(
        `UPDATE decision_memory_records SET status='needs_review',updated_at=?
         WHERE id=? AND current_revision=? AND status='approved'`,
      )
      .run(now(), id, expectedRevision).changes;
    if (changed !== 1) throw fail("Record changed; reload before review", 409);
    audit({
      repository: record.repository,
      recordId: id,
      revision: record.currentRevision,
      actorId,
      action: "record.needs_review",
      details: { reason: note },
    });
  });
  return readRecordRow(id);
}

export function resolveReview(
  id,
  expectedRevision,
  outcome,
  reason,
  principal,
) {
  const actorId = requireIdentity(principal);
  const record = readRecordRow(id);
  requireMaintainer(principal, record.repository, true);
  if (record.status !== "needs_review")
    throw fail("Record is not awaiting review", 409);
  if (
    record.currentRevision !==
    z.number().int().positive().parse(expectedRevision)
  )
    throw fail("Record revision changed; reload before resolving review", 409);
  const resolution = z
    .object({
      outcome: z.enum(["still_applicable", "withdraw"]),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict()
    .parse({ outcome, reason });
  if (resolution.outcome === "still_applicable" && !record.revision.approvedAt)
    throw fail("A previously approved revision is required", 409);
  const nextStatus =
    resolution.outcome === "still_applicable" ? "approved" : "withdrawn";
  transaction(() => {
    const changed = db
      .prepare(
        `UPDATE decision_memory_records SET status=?,withdrawn_reason=?,updated_at=?
       WHERE id=? AND current_revision=? AND status='needs_review'`,
      )
      .run(
        nextStatus,
        nextStatus === "withdrawn" ? resolution.reason : null,
        now(),
        id,
        expectedRevision,
      ).changes;
    if (changed !== 1)
      throw fail("Record changed; reload before resolving review", 409);
    audit({
      repository: record.repository,
      recordId: id,
      revision: record.currentRevision,
      actorId,
      action: "record.review_resolved",
      details: resolution,
    });
  });
  return readRecordRow(id);
}

export function withdrawRecord(id, expectedRevision, reason, principal) {
  const actorId = requireIdentity(principal);
  const record = readRecordRow(id);
  requireMaintainer(principal, record.repository, true);
  if (["withdrawn", "superseded"].includes(record.status))
    throw fail(`Cannot withdraw a ${record.status} record`, 409);
  if (
    record.currentRevision !==
    z.number().int().positive().parse(expectedRevision)
  )
    throw fail("Record revision changed; reload before withdrawing", 409);
  const note = z.string().trim().min(1).max(1000).parse(reason);
  transaction(() => {
    const changed = db
      .prepare(
        `UPDATE decision_memory_records SET status='withdrawn',withdrawn_reason=?,updated_at=?
         WHERE id=? AND current_revision=? AND status=?`,
      )
      .run(note, now(), id, expectedRevision, record.status).changes;
    if (changed !== 1)
      throw fail("Record changed; reload before withdrawing", 409);
    audit({
      repository: record.repository,
      recordId: id,
      revision: record.currentRevision,
      actorId,
      action: "record.withdrawn",
      details: { reason: note },
    });
  });
  return readRecordRow(id);
}

export function supersedeRecord(
  id,
  replacementId,
  expectedRevision,
  principal,
) {
  const actorId = requireIdentity(principal);
  const oldRecord = readRecordRow(id);
  const replacement = readRecordRow(replacementId);
  requireMaintainer(principal, oldRecord.repository, true);
  if (oldRecord.id === replacement.id)
    throw fail("A record cannot supersede itself");
  if (
    oldRecord.repository !== replacement.repository ||
    oldRecord.type !== replacement.type
  )
    throw fail("Replacement must have the same repository and record type");
  if (oldRecord.status !== "approved" && oldRecord.status !== "needs_review")
    throw fail("Only approved or review-needed records can be superseded", 409);
  if (replacement.status !== "approved")
    throw fail("Replacement record must be approved first", 409);
  if (replacement.supersedesId)
    throw fail("Replacement record already supersedes another record", 409);
  if (
    oldRecord.currentRevision !==
    z.number().int().positive().parse(expectedRevision)
  )
    throw fail("Record revision changed; reload before superseding", 409);
  transaction(() => {
    const changed = db
      .prepare(
        `UPDATE decision_memory_records
         SET status='superseded',superseded_by=?,updated_at=?
         WHERE id=? AND current_revision=? AND status=?`,
      )
      .run(
        replacementId,
        now(),
        id,
        expectedRevision,
        oldRecord.status,
      ).changes;
    if (changed !== 1)
      throw fail("Record changed; reload before superseding", 409);
    const replacementChanged = db
      .prepare(
        `UPDATE decision_memory_records SET supersedes_id=?
         WHERE id=? AND current_revision=? AND status='approved' AND supersedes_id IS NULL`,
      )
      .run(id, replacementId, replacement.currentRevision).changes;
    if (replacementChanged !== 1)
      throw fail("Replacement record changed; reload before superseding", 409);
    audit({
      repository: oldRecord.repository,
      recordId: id,
      revision: expectedRevision,
      actorId,
      action: "record.superseded",
      details: { replacementId },
    });
    audit({
      repository: replacement.repository,
      recordId: replacementId,
      revision: replacement.currentRevision,
      actorId,
      action: "record.supersedes",
      details: { supersedesId: id },
    });
  });
  return readRecordRow(id);
}

function canViewDrafts(principal, repository) {
  return Boolean(
    principal?.userId &&
    (principal.demo === true ||
      principal.repositoryRoles?.[repository] === "maintainer"),
  );
}

export function searchRecords(options, principal = null) {
  const repository = repositoryUrl(options.repository);
  assertRepositoryExists(repository);
  const includeDrafts = options.includeDrafts === true;
  const includeHistory = options.includeHistory === true;
  if (
    (includeDrafts || includeHistory) &&
    !canViewDrafts(principal, repository)
  )
    throw fail(
      "Maintainer permission required to search non-current records",
      403,
    );
  const query = z.string().trim().max(500).optional().parse(options.query);
  const type = options.type ? recordTypeSchema.parse(options.type) : null;
  const snapshotId = options.snapshotId
    ? z.string().max(150).parse(options.snapshotId)
    : null;
  const sourceReferenceId = options.sourceReferenceId
    ? z.string().max(200).parse(options.sourceReferenceId)
    : null;
  if (snapshotId) {
    const snapshot = db
      .prepare("SELECT graph_json FROM snapshots WHERE id=?")
      .get(snapshotId);
    if (
      !snapshot ||
      repositoryUrl(JSON.parse(snapshot.graph_json).repository) !== repository
    )
      throw fail("Snapshot does not belong to this repository", 400);
  }
  const statuses = includeHistory
    ? [
        "approved",
        "needs_review",
        "superseded",
        "withdrawn",
        ...(includeDrafts ? ["draft", "awaiting_review"] : []),
      ]
    : includeDrafts
      ? ["approved", "needs_review", "draft", "awaiting_review"]
      : ["approved", "needs_review"];
  const rows = db
    .prepare(
      `SELECT id FROM decision_memory_records
       WHERE repository_id=? AND status IN (${statuses.map(() => "?").join(",")})
         ${type ? "AND record_type=?" : ""}
       ORDER BY updated_at DESC`,
    )
    .all(repository, ...statuses, ...(type ? [type] : []));
  const q = query?.toLocaleLowerCase();
  const matching = rows
    .map((row) => readRecordRow(row.id))
    .filter((record) => {
      if (
        sourceReferenceId &&
        !record.revision.evidence.some(
          (item) => item.referenceId === sourceReferenceId,
        )
      )
        return false;
      if (
        snapshotId &&
        !record.revision.evidence.some((item) => item.snapshotId === snapshotId)
      )
        return false;
      if (!q) return true;
      return JSON.stringify(record.revision.content)
        .toLocaleLowerCase()
        .includes(q);
    });
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .parse(options.limit);
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(10000)
    .default(0)
    .parse(options.offset);
  return {
    repository,
    total: matching.length,
    items: matching.slice(offset, offset + limit).map((record) => ({
      ...record,
      versionMatch: snapshotId
        ? record.revision.evidence.some(
            (item) => item.snapshotId === snapshotId,
          )
          ? "exact"
          : "different_or_unpinned"
        : null,
    })),
    limit,
    offset,
  };
}

function normalizedQuestion(question) {
  return question
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function validateQuestionEvidence(repository, evidence) {
  return validateEvidence(repository, evidence || []);
}

export function createQuestion(input, principal = null) {
  const repository = repositoryUrl(input.repository);
  assertRepositoryExists(repository);
  const question = z.string().trim().min(1).max(2000).parse(input.question);
  const evidence = validateQuestionEvidence(repository, input.evidence);
  const origin = z
    .enum([
      "why_question",
      "journey",
      "contribution",
      "pr_analysis",
      "failure",
      "other",
    ])
    .optional()
    .parse(input.origin);
  const anchors = [
    ...new Set(
      evidence
        .filter((item) => item.referenceId)
        .map((item) => `${item.snapshotId}:${item.referenceId}`),
    ),
  ].sort();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([repository, normalizedQuestion(question), anchors]))
    .digest("hex");
  const actorId = principal?.userId
    ? userIdSchema.parse(principal.userId)
    : null;
  const timestamp = now();
  return transaction(() => {
    let row = db
      .prepare(
        "SELECT id,data_json,occurrence_count FROM decision_memory_questions WHERE repository_id=? AND fingerprint=? AND status='open'",
      )
      .get(repository, fingerprint);
    let id;
    const duplicate = Boolean(row);
    if (row) {
      id = row.id;
      db.prepare(
        "UPDATE decision_memory_questions SET occurrence_count=occurrence_count+1,updated_at=? WHERE id=?",
      ).run(timestamp, id);
    } else {
      id = randomUUID();
      const data = {
        question,
        evidence,
        origin,
        response: null,
        closeReason: null,
      };
      db.prepare(
        `INSERT INTO decision_memory_questions
         (id,repository_id,fingerprint,status,data_json,occurrence_count,created_at,updated_at)
         VALUES (?,?,?,'open',?,1,?,?)`,
      ).run(
        id,
        repository,
        fingerprint,
        JSON.stringify(data),
        timestamp,
        timestamp,
      );
    }
    db.prepare(
      `INSERT INTO decision_memory_question_occurrences
       (id,question_id,origin,data_json,created_at) VALUES (?,?,?,?,?)`,
    ).run(
      randomUUID(),
      id,
      origin || null,
      JSON.stringify({ question, evidence, actorId }),
      timestamp,
    );
    audit({
      repository,
      questionId: id,
      actorId,
      action: duplicate ? "question.duplicate_observed" : "question.created",
      details: { origin: origin || null },
    });
    return readQuestionRow(id);
  });
}

function readQuestionRow(id) {
  const row = db
    .prepare("SELECT * FROM decision_memory_questions WHERE id=?")
    .get(id);
  if (!row) throw fail("Maintainer question not found", 404);
  const attachments = db
    .prepare(
      `SELECT id,filename,content_type AS contentType,size_bytes AS sizeBytes,
              uploaded_by AS uploadedBy,created_at AS createdAt
       FROM decision_memory_question_attachments WHERE question_id=? ORDER BY created_at`,
    )
    .all(id);
  return {
    id: row.id,
    repository: row.repository_id,
    fingerprint: row.fingerprint,
    status: row.status,
    ...JSON.parse(row.data_json),
    occurrenceCount: row.occurrence_count,
    resolvedRecordId: row.resolved_record_id,
    attachments,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listQuestions(
  repositoryInput,
  principal,
  statusInput = "open",
) {
  const repository = repositoryUrl(repositoryInput);
  const actorId = requireMaintainer(principal, repository);
  assertRepositoryExists(repository);
  const status = z
    .enum(["open", "closed", "resolved", "all"])
    .default("open")
    .parse(statusInput);
  return {
    repository,
    questions: db
      .prepare(
        `SELECT id FROM decision_memory_questions
         WHERE repository_id=? ${status === "all" ? "" : "AND status=?"}
         ORDER BY updated_at DESC LIMIT 100`,
      )
      .all(...(status === "all" ? [repository] : [repository, status]))
      .map((row) => readQuestionRow(row.id)),
    viewedBy: actorId,
  };
}

export function respondToQuestion(id, input, principal) {
  const actorId = requireIdentity(principal);
  const question = readQuestionRow(id);
  requireMaintainer(principal, question.repository, true);
  if (question.status !== "open") throw fail("Question is not open", 409);
  const body = z
    .object({
      response: z.string().trim().min(1).max(5000),
      evidence: evidenceListSchema.max(20).default([]),
    })
    .strict()
    .parse(input);
  const responseEvidence = validateQuestionEvidence(
    question.repository,
    body.evidence,
  );
  const previous = JSON.parse(
    db
      .prepare("SELECT data_json FROM decision_memory_questions WHERE id=?")
      .get(id).data_json,
  );
  const data = {
    ...previous,
    response: body.response,
    responseEvidence,
    respondedBy: actorId,
    respondedAt: now(),
  };
  transaction(() => {
    const changed = db
      .prepare(
        `UPDATE decision_memory_questions SET data_json=?,updated_at=?
         WHERE id=? AND status='open'`,
      )
      .run(JSON.stringify(data), data.respondedAt, id).changes;
    if (changed !== 1)
      throw fail("Question changed; reload before responding", 409);
    audit({
      repository: question.repository,
      questionId: id,
      actorId,
      action: "question.responded",
      details: { evidenceCount: responseEvidence.length },
    });
  });
  return readQuestionRow(id);
}

export function saveQuestionAttachment(
  id,
  { filename, contentType, content },
  principal,
) {
  const actorId = requireIdentity(principal);
  const question = readQuestionRow(id);
  requireMaintainer(principal, question.repository, true);
  if (question.status !== "open") throw fail("Question is not open", 409);
  if (
    !Buffer.isBuffer(content) ||
    content.length < 1 ||
    content.length > 5 * 1024 * 1024
  )
    throw fail("Attachment must be between 1 byte and 5 MB");
  const safeFilename = z
    .string()
    .trim()
    .min(1)
    .max(180)
    .parse(filename)
    .replace(/[\\/\u0000-\u001f\u007f"]/g, "_");
  const safeType = z
    .string()
    .trim()
    .max(120)
    .default("application/octet-stream")
    .parse(contentType || "application/octet-stream");
  const idValue = randomUUID();
  const createdAt = now();
  transaction(() => {
    db.prepare(
      `INSERT INTO decision_memory_question_attachments
       (id,question_id,filename,content_type,size_bytes,uploaded_by,created_at,content)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      idValue,
      id,
      safeFilename,
      safeType,
      content.length,
      actorId,
      createdAt,
      content,
    );
    audit({
      repository: question.repository,
      questionId: id,
      actorId,
      action: "question.attachment_added",
      details: {
        attachmentId: idValue,
        filename: safeFilename,
        sizeBytes: content.length,
      },
    });
  });
  return readQuestionRow(id).attachments.find(
    (attachment) => attachment.id === idValue,
  );
}

export function readQuestionAttachment(questionId, attachmentId, principal) {
  const question = readQuestionRow(questionId);
  requireMaintainer(principal, question.repository, true);
  const attachment = db
    .prepare(
      `SELECT filename,content_type AS contentType,content
       FROM decision_memory_question_attachments WHERE id=? AND question_id=?`,
    )
    .get(attachmentId, questionId);
  if (!attachment) throw fail("Question attachment not found", 404);
  return { ...attachment, content: Buffer.from(attachment.content) };
}

export function getQuestion(id, repositoryInput, principal) {
  const repository = repositoryUrl(repositoryInput);
  requireMaintainer(principal, repository);
  const question = readQuestionRow(id);
  if (question.repository !== repository)
    throw fail("Maintainer question not found", 404);
  return question;
}

export async function suggestQuestionResponse(id, input, principal) {
  const question = readQuestionRow(id);
  requireMaintainer(principal, question.repository, true);
  if (question.status !== "open") throw fail("Question is not open", 409);

  let source;
  if (input?.componentId && input?.snapshotId) {
    const snapshotRow = db
      .prepare("SELECT graph_json FROM snapshots WHERE id=?")
      .get(input.snapshotId);
    if (!snapshotRow)
      throw fail("Question source snapshot is unavailable", 404);
    const graph = JSON.parse(snapshotRow.graph_json);
    if (repositoryUrl(graph.repository) !== question.repository)
      throw fail("Question source belongs to a different repository", 400);
    const component = graph.components.find(
      (item) => item.id === input.componentId,
    );
    if (!component)
      throw fail(
        "Analyzed module or function was not found in this snapshot",
        404,
      );
    source = {
      graph,
      componentId: component.id,
      referenceId: component.referenceId,
      snapshotId: input.snapshotId,
    };
  } else {
    const requestedReference =
      input?.referenceId && input?.snapshotId
        ? {
            kind: "source_code",
            referenceId: input.referenceId,
            snapshotId: input.snapshotId,
          }
        : null;
    const evidence = requestedReference
      ? validateQuestionEvidence(question.repository, [requestedReference])
      : question.evidence.filter((item) => item.referenceId && item.snapshotId);
    const selectedSource = evidence[0];
    if (!selectedSource)
      throw fail(
        "Select a related module or function before generating a response draft",
      );

    const snapshotRow = db
      .prepare("SELECT graph_json FROM snapshots WHERE id=?")
      .get(selectedSource.snapshotId);
    if (!snapshotRow)
      throw fail("Question source snapshot is unavailable", 404);
    const graph = JSON.parse(snapshotRow.graph_json);
    if (repositoryUrl(graph.repository) !== question.repository)
      throw fail("Question source belongs to a different repository", 400);
    const reference = graph.references.find(
      (item) =>
        item.id === selectedSource.referenceId &&
        item.snapshotId === selectedSource.snapshotId,
    );
    if (!reference) throw fail("Question source reference is unavailable", 404);

    const component = graph.components
      .map((item) => {
        const componentReference = graph.references.find(
          (ref) =>
            ref.id === item.referenceId &&
            ref.snapshotId === selectedSource.snapshotId,
        );
        if (!componentReference || componentReference.file !== reference.file)
          return null;
        const distance =
          reference.endLine < componentReference.startLine
            ? componentReference.startLine - reference.endLine
            : componentReference.endLine < reference.startLine
              ? reference.startLine - componentReference.endLine
              : 0;
        return { item, distance };
      })
      .filter(Boolean)
      .sort((left, right) => left.distance - right.distance)[0]?.item;
    if (!component)
      throw fail(
        "No analyzed component is available for the selected source",
        422,
      );
    source = {
      graph,
      componentId: component.id,
      referenceId: selectedSource.referenceId,
      snapshotId: selectedSource.snapshotId,
    };
  }

  const suggestion = await answerQuestion(
    source.graph,
    source.componentId,
    question.question,
  );
  return {
    response: suggestion.answer,
    mode: suggestion.mode,
    notice: suggestion.notice,
    citations: suggestion.citations,
    source: {
      componentId: source.componentId,
      snapshotId: source.snapshotId,
      referenceId: source.referenceId,
    },
  };
}

export function resolveQuestion(id, input, principal) {
  const actorId = requireIdentity(principal);
  const question = readQuestionRow(id);
  requireMaintainer(principal, question.repository, true);
  if (question.status !== "open") throw fail("Question is not open", 409);
  const body = z
    .object({
      response: z.string().trim().max(5000).optional(),
      responseEvidence: evidenceListSchema.max(20).default([]),
      recordId: z.string().max(150).optional(),
      closeReason: z.string().trim().min(1).max(1000).optional(),
    })
    .strict()
    .refine(
      (value) => Boolean(value.recordId || value.closeReason || value.response),
      {
        message:
          "Provide a maintainer response, linked record, or close reason",
      },
    )
    .parse(input);
  if (body.recordId) {
    const record = readRecordRow(body.recordId);
    if (record.repository !== question.repository)
      throw fail("Linked record belongs to a different repository", 400);
  }
  const previous = JSON.parse(
    db
      .prepare("SELECT data_json FROM decision_memory_questions WHERE id=?")
      .get(id).data_json,
  );
  const responseEvidence = validateQuestionEvidence(
    question.repository,
    body.responseEvidence,
  );
  const data = {
    ...previous,
    response: body.response || previous.response || null,
    responseEvidence: responseEvidence.length
      ? responseEvidence
      : previous.responseEvidence || [],
    closeReason: body.closeReason || null,
    respondedBy: body.response ? actorId : previous.respondedBy || null,
    respondedAt: body.response ? now() : previous.respondedAt || null,
  };
  const nextStatus = body.recordId || body.response ? "resolved" : "closed";
  transaction(() => {
    const changed = db
      .prepare(
        `UPDATE decision_memory_questions
       SET status=?,data_json=?,resolved_record_id=?,updated_at=?
       WHERE id=? AND status='open'`,
      )
      .run(
        nextStatus,
        JSON.stringify(data),
        body.recordId || null,
        now(),
        id,
      ).changes;
    if (changed !== 1)
      throw fail("Question changed; reload before resolving", 409);
    audit({
      repository: question.repository,
      questionId: id,
      actorId,
      action: "question.resolved",
      details: {
        recordId: body.recordId || null,
        closeReason: body.closeReason || null,
        status: nextStatus,
      },
    });
  });
  return readQuestionRow(id);
}

export function listRecordHistory(id, repositoryInput, principal) {
  const repository = repositoryUrl(repositoryInput);
  requireMaintainer(principal, repository);
  const record = readRecordRow(id);
  if (record.repository !== repository) throw fail("Record not found", 404);
  return {
    recordId: id,
    revisions: db
      .prepare(
        `SELECT revision,content_json,evidence_json,submitted_by,created_at,approved_by,approved_at
         FROM decision_memory_revisions WHERE record_id=? ORDER BY revision`,
      )
      .all(id)
      .map((item) => ({
        revision: item.revision,
        content: JSON.parse(item.content_json),
        evidence: JSON.parse(item.evidence_json),
        submittedBy: item.submitted_by,
        createdAt: item.created_at,
        approvedBy: item.approved_by,
        approvedAt: item.approved_at,
      })),
    events: db
      .prepare(
        `SELECT action,revision,actor_id,details_json,created_at
         FROM decision_memory_audit WHERE record_id=? ORDER BY created_at`,
      )
      .all(id)
      .map((item) => ({
        action: item.action,
        revision: item.revision,
        actorId: item.actor_id,
        details: JSON.parse(item.details_json),
        createdAt: item.created_at,
      })),
  };
}

export function getRecord(id, repositoryInput, principal = null) {
  const repository = repositoryUrl(repositoryInput);
  const record = readRecordRow(id);
  if (record.repository !== repository) throw fail("Record not found", 404);
  if (
    ["draft", "awaiting_review"].includes(record.status) &&
    !canViewDrafts(principal, repository)
  )
    throw fail("Record not found", 404);
  return record;
}
