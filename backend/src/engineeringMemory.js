import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "./handoffStorage.js";
import { membership, fail } from "./collaborationAuth.js";
import { containsCredential } from "./handoffSafety.js";

db.exec(`
CREATE TABLE IF NOT EXISTS engineering_memory (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, repository_id TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('decision','failure_lesson')), revision INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','awaiting_review','approved','needs_review','superseded','withdrawn')),
 origin_session_id TEXT, origin_resolution_id TEXT UNIQUE, superseded_by TEXT,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS engineering_memory_revisions (
 record_id TEXT NOT NULL, revision INTEGER NOT NULL, content_json TEXT NOT NULL, evidence_json TEXT NOT NULL,
 author_id TEXT NOT NULL, created_at TEXT NOT NULL, approved_by TEXT, approved_at TEXT,
 PRIMARY KEY(record_id,revision));
CREATE TABLE IF NOT EXISTS engineering_memory_events (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL, revision INTEGER NOT NULL, actor_id TEXT NOT NULL,
 action TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS engineering_memory_scope ON engineering_memory(workspace_id,repository_id,status,updated_at);
CREATE TRIGGER IF NOT EXISTS immutable_memory_revision BEFORE UPDATE OF content_json,evidence_json,author_id,created_at,record_id,revision ON engineering_memory_revisions
 BEGIN SELECT RAISE(ABORT,'Knowledge revision content is immutable'); END;
`);
const note = (max = 5000) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !containsCredential(s), "Remove credentials before saving.");
export const memoryContent = z
  .object({
    title: note(160).min(1),
    summary: note().default(""),
    context: note().default(""),
    decision: note().default(""),
    rationale: note().default(""),
    constraints: note().default(""),
    alternatives: note().default(""),
    consequences: note().default(""),
    observedFailure: note().default(""),
    environment: note(1500).default(""),
    suspectedCause: note().default(""),
    reviewedCause: note().default(""),
    causeStatus: z
      .enum(["unknown", "suspected", "maintainer_reported"])
      .default("unknown"),
    resolution: note().default(""),
    prevention: note().default(""),
    resolutionStatus: z
      .enum(["not_verified", "maintainer_reported"])
      .default("not_verified"),
    verificationNote: note().default(""),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.causeStatus === "maintainer_reported" && !value.reviewedCause)
      ctx.addIssue({
        code: "custom",
        message: "Record the maintainer-reported cause explicitly.",
      });
    if (
      value.resolutionStatus === "maintainer_reported" &&
      !value.verificationNote
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Describe the reported verification; the application does not execute it.",
      });
  });
const now = () => new Date().toISOString();
const hash = (s) =>
  createHash("sha256").update(s.replaceAll("\r\n", "\n")).digest("hex");
export function memoryWorkspace(userId, workspaceId) {
  return membership(userId, z.string().uuid().parse(workspaceId));
}
function audit(record, actor, action, metadata = {}) {
  db.prepare(
    "INSERT INTO engineering_memory_events VALUES (?,?,?,?,?,?,?)",
  ).run(
    randomUUID(),
    record.id,
    record.revision,
    actor,
    action,
    JSON.stringify(metadata),
    now(),
  );
}
function graphAt(id) {
  const row =
    db.prepare("SELECT graph_json FROM snapshots WHERE id=?").get(id) ||
    db
      .prepare(
        "SELECT graph_json FROM handoff_repository_views WHERE analysis_snapshot_id=?",
      )
      .get(id);
  if (!row)
    throw fail(404, "The selected analyzed source version is unavailable.");
  return JSON.parse(row.graph_json);
}
function referenceText(graph, ref) {
  const content =
    db
      .prepare(
        "SELECT content FROM source_files WHERE snapshot_id=? AND path=?",
      )
      .get(graph.snapshotId, ref.file)?.content ??
    db
      .prepare(
        "SELECT content FROM handoff_repository_files WHERE analysis_snapshot_id=? AND path=?",
      )
      .get(graph.snapshotId, ref.file)?.content;
  if (content === undefined)
    return { text: ref.excerpt || "", complete: false };
  return {
    text:
      Number.isInteger(ref.startOffset) && Number.isInteger(ref.endOffset)
        ? content.slice(ref.startOffset, ref.endOffset)
        : content
            .split("\n")
            .slice(ref.startLine - 1, ref.endLine)
            .join("\n"),
    complete: true,
  };
}
function evidenceAt(snapshotId, referenceIds, repository, savedGraph) {
  z.array(z.string().min(1).max(200)).min(1).max(20).parse(referenceIds);
  const graph = savedGraph || graphAt(snapshotId);
  if (graph.repository !== repository)
    throw fail(400, "Source evidence belongs to a different repository.");
  return [...new Set(referenceIds)].map((id) => {
    const ref = graph.references.find(
      (r) => r.id === id && r.snapshotId === snapshotId,
    );
    if (
      !ref ||
      /(?:^|\/)\.env(?:\.|$)|secret|credential|private.?key/i.test(ref.file)
    )
      throw fail(400, "Choose a valid, shareable source reference.");
    const component = graph.components.find(
      (c) => c.referenceId === id && c.role !== "module",
    );
    const source = referenceText(graph, ref);
    return {
      snapshotId,
      commit: graph.commit,
      referenceId: ref.id,
      file: ref.file,
      startLine: ref.startLine,
      endLine: ref.endLine,
      url: ref.url,
      componentName: component?.name || null,
      componentRole: component?.role || null,
      sourceHash: source.text ? hash(source.text) : null,
      complete: source.complete,
      provenance: "analyzed_source",
    };
  });
}
function scopedRecord(userId, id) {
  const row = db
    .prepare(
      `SELECT r.* FROM engineering_memory r JOIN collaboration_members m ON m.workspace_id=r.workspace_id
 JOIN collaboration_repositories p ON p.workspace_id=r.workspace_id AND p.repository_id=r.repository_id WHERE r.id=? AND m.user_id=?`,
    )
    .get(id, userId);
  if (!row)
    throw fail(404, "Knowledge record not found or access unavailable.");
  return row;
}
function maintainer(userId, record) {
  if (memoryWorkspace(userId, record.workspace_id).role !== "maintainer")
    throw fail(
      403,
      "A workspace maintainer must approve or change publication status.",
    );
}
function expected(record, revision) {
  if (record.revision !== revision)
    throw fail(
      409,
      "This record changed. Refresh and review its latest revision.",
    );
}
function revisionData(row) {
  return {
    revision: row.revision,
    content: JSON.parse(row.content_json),
    evidence: JSON.parse(row.evidence_json),
    authorId: row.author_id,
    createdAt: row.created_at,
    approvedBy: row.approver_name || null,
    approvedAt: row.approved_at,
  };
}
export function getMemory(userId, id, snapshotId) {
  const record = scopedRecord(userId, id);
  const revision = db
    .prepare(
      `SELECT v.*,u.name AS approver_name FROM engineering_memory_revisions v LEFT JOIN collaboration_users u ON u.id=v.approved_by WHERE v.record_id=? AND v.revision=?`,
    )
    .get(id, record.revision);
  const data = { ...record, ...revisionData(revision) };
  const applicability = memoryApplicability(data, snapshotId);
  return {
    ...data,
    applicability,
    authoritative:
      record.status === "approved" &&
      !["source_changed", "source_missing", "unknown"].includes(
        applicability.state,
      ),
    publicationNote:
      "Human approval records reviewed knowledge; it does not independently prove historical intent, a root cause or a runtime outcome.",
  };
}
export function memoryApplicability(record, snapshotId) {
  if (!snapshotId)
    return {
      state: "not_compared",
      note: "Applies to the recorded evidence version. No selected version was compared.",
    };
  const graph = graphAt(snapshotId);
  if (graph.repository !== record.repository_id)
    throw fail(400, "Select a version of this record’s repository.");
  const changed = [],
    unknown = [],
    missing = [];
  for (const old of record.evidence) {
    if (old.commit === graph.commit) continue;
    let ref;
    if (old.componentName) {
      const matches = graph.components
        .filter(
          (c) => c.name === old.componentName && c.role === old.componentRole,
        )
        .map((c) =>
          graph.references.find(
            (r) => r.id === c.referenceId && r.file === old.file,
          ),
        )
        .filter(Boolean);
      if (matches.length === 1) ref = matches[0];
      else if (matches.length > 1) {
        unknown.push(old.file);
        continue;
      }
    } else
      ref = graph.references.find(
        (r) =>
          r.file === old.file &&
          graph.components.some(
            (c) => c.role === "module" && c.referenceId === r.id,
          ),
      );
    if (!ref) {
      missing.push(old.file);
      continue;
    }
    const source = referenceText(graph, ref);
    if (!old.complete || !source.complete || !old.sourceHash)
      unknown.push(old.file);
    else if (hash(source.text) !== old.sourceHash) changed.push(old.file);
  }
  const state = missing.length
    ? "source_missing"
    : changed.length
      ? "source_changed"
      : unknown.length
        ? "unknown"
        : record.evidence.every((e) => e.commit === graph.commit)
          ? "same_commit"
          : "source_unchanged";
  return {
    state,
    files: [...new Set([...changed, ...missing, ...unknown])],
    snapshotId,
    note:
      state === "same_commit"
        ? "Exact recorded commit."
        : state === "source_unchanged"
          ? "Anchored declarations match. Other dependencies and runtime behavior were not checked."
          : "Source applicability needs human review; this does not prove a regression or invalidate the historical explanation.",
  };
}
function insertMemory({
  workspaceId,
  repository,
  type,
  content,
  evidence,
  actor,
  originSession = null,
  originResolution = null,
  approvedBy = null,
  approvedAt = null,
}) {
  const id = randomUUID(),
    timestamp = now(),
    status = approvedBy ? "approved" : "draft";
  db.prepare(
    "INSERT INTO engineering_memory VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    workspaceId,
    repository,
    type,
    1,
    status,
    originSession,
    originResolution,
    null,
    actor,
    timestamp,
    timestamp,
  );
  db.prepare(
    "INSERT INTO engineering_memory_revisions VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    id,
    1,
    JSON.stringify(content),
    JSON.stringify(evidence),
    actor,
    timestamp,
    approvedBy,
    approvedAt,
  );
  audit(
    { id, revision: 1 },
    approvedBy || actor,
    approvedBy
      ? approvedAt
        ? "promoted_approved_handoff"
        : "imported_legacy_approval"
      : "created",
  );
  return id;
}
export function createMemory(userId, body) {
  const member = memoryWorkspace(userId, body.workspaceId),
    graph = graphAt(body.snapshotId);
  const shared = db
    .prepare(
      "SELECT 1 FROM collaboration_repositories WHERE workspace_id=? AND repository_id=?",
    )
    .get(body.workspaceId, graph.repository);
  if (!shared && member.role !== "maintainer")
    throw fail(
      403,
      "Ask a maintainer to share this repository with your workspace first.",
    );
  const content = memoryContent.parse(body.content),
    evidence = evidenceAt(body.snapshotId, body.referenceIds, graph.repository);
  let id;
  transaction(() => {
    if (!shared)
      db.prepare(
        "INSERT OR IGNORE INTO collaboration_repositories VALUES (?,?)",
      ).run(body.workspaceId, graph.repository);
    id = insertMemory({
      workspaceId: body.workspaceId,
      repository: graph.repository,
      type: body.type,
      content,
      evidence,
      actor: userId,
    });
  });
  return getMemory(userId, id);
}
export function changeMemory(userId, id, action, body) {
  const initial = scopedRecord(userId, id);
  expected(initial, body.expectedRevision);
  if (["approve", "withdraw", "supersede", "review", "check"].includes(action))
    maintainer(userId, initial);
  else if (
    initial.created_by !== userId &&
    memoryWorkspace(userId, initial.workspace_id).role !== "maintainer"
  )
    throw fail(403, "The author or maintainer must revise this record.");
  transaction(() => {
    const record = scopedRecord(userId, id);
    expected(record, body.expectedRevision);
    const current = getMemory(userId, id);
    let next = record.status;
    if (action === "revise") {
      if (["superseded", "withdrawn"].includes(record.status))
        throw fail(409, "Create a replacement record for archived knowledge.");
      const content = memoryContent.parse(body.content);
      const evidence = body.snapshotId
        ? evidenceAt(body.snapshotId, body.referenceIds, record.repository_id)
        : current.evidence;
      const revision = record.revision + 1;
      db.prepare(
        "INSERT INTO engineering_memory_revisions VALUES (?,?,?,?,?,?,?,?)",
      ).run(
        id,
        revision,
        JSON.stringify(content),
        JSON.stringify(evidence),
        userId,
        now(),
        null,
        null,
      );
      db.prepare("UPDATE engineering_memory SET revision=? WHERE id=?").run(
        revision,
        id,
      );
      record.revision = revision;
      next = "draft";
    } else if (action === "submit") {
      if (record.status !== "draft")
        throw fail(409, "Only a draft can be submitted.");
      if (
        record.type === "decision" &&
        (!current.content.decision || !current.content.rationale)
      )
        throw fail(400, "Add the decision and rationale before review.");
      if (record.type === "failure_lesson" && !current.content.observedFailure)
        throw fail(
          400,
          "Describe the reported failure. Its cause may remain unknown.",
        );
      next = "awaiting_review";
    } else if (action === "approve") {
      if (record.status !== "awaiting_review")
        throw fail(409, "Submit this exact revision for review first.");
      db.prepare(
        "UPDATE engineering_memory_revisions SET approved_by=?,approved_at=? WHERE record_id=? AND revision=?",
      ).run(userId, now(), id, record.revision);
      next = "approved";
    } else if (action === "withdraw") {
      if (["withdrawn", "superseded"].includes(record.status))
        throw fail(409, "This record is already archived.");
      next = "withdrawn";
    } else if (action === "supersede") {
      const replacement = getMemory(userId, body.replacementId);
      if (
        replacement.id === id ||
        replacement.workspace_id !== record.workspace_id ||
        replacement.repository_id !== record.repository_id ||
        replacement.status !== "approved" ||
        ["superseded", "withdrawn"].includes(record.status)
      )
        throw fail(
          400,
          "Choose another approved record in this workspace and repository.",
        );
      db.prepare(
        "UPDATE engineering_memory SET superseded_by=? WHERE id=?",
      ).run(replacement.id, id);
      next = "superseded";
    } else if (action === "check") {
      if (!["approved", "needs_review"].includes(record.status))
        throw fail(409, "Check applicability for published knowledge.");
      const result = memoryApplicability(current, body.snapshotId);
      if (
        ["source_changed", "source_missing", "unknown"].includes(result.state)
      )
        next = "needs_review";
      audit(record, userId, "source_applicability_checked", result);
    } else if (action === "review") {
      if (record.status !== "needs_review")
        throw fail(409, "This record is not awaiting an applicability review.");
      if (record.origin_session_id) {
        const session = db
          .prepare("SELECT status,resolved_at FROM handoff_sessions WHERE id=?")
          .get(record.origin_session_id);
        if (
          !session?.resolved_at ||
          !["RESOLVED", "CLOSED"].includes(session.status)
        )
          throw fail(
            409,
            "Resolve the reopened handoff before restoring its knowledge.",
          );
      }
      next = body.outcome === "withdraw" ? "withdrawn" : "approved";
    } else throw fail(400, "Unknown knowledge action.");
    db.prepare(
      "UPDATE engineering_memory SET status=?,updated_at=? WHERE id=?",
    ).run(next, now(), id);
    audit(record, userId, action, {
      from: record.status,
      to: next,
      ...(body.reason ? { reason: body.reason } : {}),
      ...(body.replacementId ? { replacementId: body.replacementId } : {}),
    });
  });
  return getMemory(userId, id, body.snapshotId);
}
export function memoryHistory(userId, id) {
  scopedRecord(userId, id);
  return {
    revisions: db
      .prepare(
        `SELECT v.*,u.name AS approver_name FROM engineering_memory_revisions v LEFT JOIN collaboration_users u ON u.id=v.approved_by WHERE v.record_id=? ORDER BY revision DESC`,
      )
      .all(id)
      .map(revisionData),
    events: db
      .prepare(
        `SELECT e.id,e.revision,e.action,e.metadata,e.created_at,u.name AS actor FROM engineering_memory_events e JOIN collaboration_users u ON u.id=e.actor_id WHERE record_id=? ORDER BY e.rowid DESC LIMIT 100`,
      )
      .all(id)
      .map((e) => ({ ...e, metadata: JSON.parse(e.metadata) })),
  };
}
export function searchMemory(
  userId,
  {
    workspaceId,
    repository = "",
    query = "",
    type = "",
    snapshotId,
    referenceId,
    includeDrafts = false,
    status = "",
    offset = 0,
  },
) {
  memoryWorkspace(userId, workspaceId);
  if (snapshotId && !repository) repository = graphAt(snapshotId).repository;
  const rows = db
    .prepare(
      `SELECT r.id FROM engineering_memory r JOIN collaboration_repositories p ON p.workspace_id=r.workspace_id AND p.repository_id=r.repository_id
 JOIN engineering_memory_revisions v ON v.record_id=r.id AND v.revision=r.revision
 WHERE r.workspace_id=? AND (?='' OR r.repository_id=?) AND (?='' OR r.type=?) AND (?='' OR r.status=?)
 AND (? OR r.status IN ('approved','needs_review')) AND (instr(lower(v.content_json),lower(?))>0) ORDER BY r.updated_at DESC,r.rowid DESC`,
    )
    .all(
      workspaceId,
      repository,
      repository,
      type,
      type,
      status,
      status,
      includeDrafts ? 1 : 0,
      query,
    );
  let anchor, anchorName;
  if (referenceId) {
    const graph = graphAt(snapshotId);
    anchor = graph.references.find((r) => r.id === referenceId);
    anchorName = graph.components.find(
      (c) => c.referenceId === referenceId && c.role !== "module",
    )?.name;
    if (!anchor)
      throw fail(400, "Source reference does not belong to this snapshot.");
  }
  const entries = rows
    .map((r) => getMemory(userId, r.id, snapshotId))
    .filter(
      (r) =>
        !anchor ||
        r.evidence.some(
          (e) =>
            e.file === anchor.file &&
            (anchorName && e.componentName
              ? e.componentName === anchorName
              : e.startLine <= anchor.endLine && e.endLine >= anchor.startLine),
        ),
    );
  return { entries: entries.slice(offset, offset + 30), total: entries.length };
}
// Called from the existing handoff approval transaction: one conversation, one linked knowledge record.
function promoteApprovedHandoff(
  session,
  resolutionId,
  actor,
  type = "decision",
  imported = false,
) {
  const existing = db
    .prepare(
      "SELECT id,type FROM engineering_memory WHERE origin_resolution_id=?",
    )
    .get(resolutionId);
  if (existing) {
    if (existing.type !== type)
      throw fail(409, "This answer already has a linked knowledge record.");
    return existing.id;
  }
  const resolution = db
    .prepare(
      "SELECT * FROM handoff_resolutions WHERE id=? AND session_id=? AND confirmed_at IS NOT NULL",
    )
    .get(resolutionId, session.id);
  if (!resolution)
    throw fail(
      409,
      "Confirm a teammate’s solution before saving team knowledge.",
    );
  const source = db
    .prepare("SELECT * FROM handoff_snapshots WHERE session_id=?")
    .get(session.id);
  let evidence;
  try {
    const captured = db
      .prepare(
        "SELECT graph_json FROM handoff_repository_views WHERE analysis_snapshot_id=?",
      )
      .get(source.analysis_snapshot_id);
    const graph = captured
        ? JSON.parse(captured.graph_json)
        : graphAt(source.analysis_snapshot_id),
      component = graph.components.find((c) => c.id === source.component_id);
    evidence = evidenceAt(
      source.analysis_snapshot_id,
      [component?.referenceId || source.reference_id],
      session.repository_id,
      graph,
    );
  } catch (error) {
    if (error.status !== 404) throw error;
    evidence = [
      {
        snapshotId: source.analysis_snapshot_id,
        commit: source.commit_sha,
        referenceId: source.reference_id,
        file: source.file_path,
        startLine: source.start_line,
        endLine: source.end_line,
        url: source.source_url,
        componentName: source.function_name,
        componentRole: null,
        sourceHash: hash(source.source_code),
        complete: false,
        provenance: "immutable_handoff_selection",
      },
    ];
  }
  const content = memoryContent.parse({
    title: session.title,
    context: session.question,
    summary: resolution.explanation,
    ...(type === "decision"
      ? { decision: resolution.solution, rationale: resolution.explanation }
      : {
          observedFailure:
            session.actual_behavior ||
            "Failure details were not captured in the original handoff. Review before reuse.",
          resolution: resolution.solution,
          rationale: resolution.explanation,
        }),
    causeStatus: "unknown",
    resolutionStatus: "not_verified",
  });
  return insertMemory({
    workspaceId: session.workspace_id,
    repository: session.repository_id,
    type,
    content,
    evidence,
    actor: resolution.proposed_by,
    originSession: session.id,
    originResolution: resolution.id,
    approvedBy: actor,
    approvedAt: imported ? null : now(),
  });
}
export function promoteHandoffMemory(
  session,
  resolutionId,
  actor,
  type = "decision",
) {
  maintainer(actor, session);
  if (!session.resolved_at || !["RESOLVED", "CLOSED"].includes(session.status))
    throw fail(409, "Resolve the handoff before publishing its explanation.");
  return promoteApprovedHandoff(session, resolutionId, actor, type);
}
export function reopenHandoffMemory(sessionId, actor) {
  for (const row of db
    .prepare(
      "SELECT * FROM engineering_memory WHERE origin_session_id=? AND status='approved'",
    )
    .all(sessionId)) {
    db.prepare(
      "UPDATE engineering_memory SET status='needs_review',updated_at=? WHERE id=?",
    ).run(now(), row.id);
    audit(row, actor, "handoff_reopened", {
      reason:
        "The original question was reopened. Review the linked knowledge before reuse.",
    });
  }
}
// Preserve already approved, authenticated handoff answers during the additive migration.
transaction(() => {
  for (const row of db
    .prepare(
      `SELECT s.*,r.id AS resolution_id,r.approved_by AS approver FROM handoff_resolutions r JOIN handoff_sessions s ON s.id=r.session_id WHERE r.approved_for_knowledge=1 AND r.confirmed_at IS NOT NULL AND s.resolved_at IS NOT NULL AND s.status IN ('RESOLVED','CLOSED') AND r.approved_by IS NOT NULL`,
    )
    .all()) {
    if (
      !db
        .prepare(
          "SELECT 1 FROM engineering_memory WHERE origin_resolution_id=?",
        )
        .get(row.resolution_id)
    )
      promoteApprovedHandoff(
        row,
        row.resolution_id,
        row.approver,
        "decision",
        true,
      );
  }
});
