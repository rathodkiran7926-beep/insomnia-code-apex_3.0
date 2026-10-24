import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "./handoffStorage.js";
import { authenticate, membership, fail } from "./collaborationAuth.js";
import { readSource } from "./workspace.js";
import {
  collectHandoffContext,
  generateHandoffBriefing,
} from "./handoffContext.js";
import { containsCredential } from "./handoffSafety.js";
import {
  promoteHandoffMemory,
  reopenHandoffMemory,
} from "./engineeringMemory.js";
import {
  captureHandoffRepository,
  handoffRepository,
  handoffRepositorySource,
} from "./handoffRepository.js";

export const handoffRoutes = Router();
handoffRoutes.use(authenticate);
const text = (n) =>
  z
    .string()
    .trim()
    .max(n)
    .refine(
      (value) => !containsCredential(value),
      "Remove credentials before sharing.",
    );
const optionalNote = text(2500).default("");
const uuid = z.string().uuid();
const page = (v, max = 10000) =>
  z.coerce.number().int().min(0).max(max).default(0).parse(v);
const now = () => new Date().toISOString();
function activity(id, actor, event, metadata = {}) {
  const timestamp = now();
  db.prepare("INSERT INTO handoff_activity VALUES (?,?,?,?,?,?)").run(
    randomUUID(),
    id,
    actor,
    event,
    JSON.stringify(metadata),
    timestamp,
  );
  db.prepare("UPDATE handoff_sessions SET updated_at=? WHERE id=?").run(
    timestamp,
    id,
  );
}
function access(req) {
  uuid.parse(req.params.id);
  const session = db
    .prepare(
      `SELECT s.* FROM handoff_sessions s JOIN collaboration_members m ON m.workspace_id=s.workspace_id
    JOIN collaboration_repositories r ON r.workspace_id=s.workspace_id AND r.repository_id=s.repository_id
    WHERE s.id=? AND m.user_id=?`,
    )
    .get(req.params.id, req.collaborator.id);
  if (!session) throw fail(404, "Handoff not found or access is unavailable.");
  return {
    session,
    member: membership(req.collaborator.id, session.workspace_id),
  };
}
function reviewer(member) {
  if (!["maintainer", "reviewer"].includes(member.role))
    throw fail(403, "A reviewer or maintainer is required.");
}
function writable(session) {
  if (["RESOLVED", "CLOSED"].includes(session.status))
    throw fail(409, "Reopen this session before adding review content.");
}
function snapshot(id) {
  const row = db
    .prepare("SELECT * FROM handoff_snapshots WHERE session_id=?")
    .get(id);
  return {
    ...row,
    context: JSON.parse(row.context_json),
    briefing: row.ai_summary ? JSON.parse(row.ai_summary) : null,
    context_json: undefined,
    ai_summary: undefined,
  };
}
function comments(id, offset = 0) {
  return db
    .prepare(
      `SELECT c.*, u.name AS author_name FROM handoff_comments c JOIN collaboration_users u ON u.id=c.author_id
    WHERE c.session_id=? ORDER BY c.created_at,c.rowid LIMIT 50 OFFSET ?`,
    )
    .all(id, offset);
}
function detail(id) {
  const session = db
    .prepare(
      `SELECT s.*,u.name AS author_name,a.name AS assignee_name FROM handoff_sessions s
    JOIN collaboration_users u ON u.id=s.created_by LEFT JOIN collaboration_users a ON a.id=s.assigned_to WHERE s.id=?`,
    )
    .get(id);
  return {
    session,
    snapshot: snapshot(id),
    comments: comments(id),
    commentCount: db
      .prepare("SELECT count(*) AS n FROM handoff_comments WHERE session_id=?")
      .get(id).n,
    resolutions: db
      .prepare(
        `SELECT r.*,u.name AS author_name FROM handoff_resolutions r JOIN collaboration_users u ON u.id=r.proposed_by WHERE r.session_id=? ORDER BY r.created_at DESC,r.rowid DESC`,
      )
      .all(id),
    activity: db
      .prepare(
        `SELECT a.*,u.name AS actor_name FROM handoff_activity a JOIN collaboration_users u ON u.id=a.actor_id WHERE session_id=? ORDER BY a.created_at DESC,a.rowid DESC LIMIT 50`,
      )
      .all(id),
    memoryRecords: db
      .prepare(
        "SELECT id,type,status,revision,origin_resolution_id FROM engineering_memory WHERE origin_session_id=? ORDER BY created_at DESC",
      )
      .all(id),
  };
}
const generating = new Map();
function briefing(id) {
  if (generating.has(id)) return generating.get(id);
  if (generating.size >= 3)
    return Promise.resolve({
      state: "busy",
      notice:
        "Three briefings are running. Retry shortly; your snapshot is saved.",
    });
  const work = (async () => {
    const saved = snapshot(id);
    if (saved.briefing?.state === "complete") return saved.briefing;
    const session = db
      .prepare(
        "SELECT question,expected_behavior,actual_behavior,attempted_solutions FROM handoff_sessions WHERE id=?",
      )
      .get(id);
    const output = await generateHandoffBriefing(saved.context, session);
    db.prepare(
      "UPDATE handoff_snapshots SET ai_summary=? WHERE session_id=?",
    ).run(JSON.stringify(output), id);
    return output;
  })().finally(() => generating.delete(id));
  generating.set(id, work);
  return work;
}

handoffRoutes.post("/", async (req, res) => {
  const body = z
    .object({
      workspaceId: uuid,
      snapshotId: text(200).min(1),
      referenceId: text(200).min(1),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      title: text(160).min(1),
      question: text(2500).min(1),
      expectedBehavior: optionalNote,
      actualBehavior: optionalNote,
      attemptedSolutions: optionalNote,
      assignedTo: uuid.nullable().optional(),
      requestId: uuid,
    })
    .strict()
    .parse(req.body);
  membership(req.collaborator.id, body.workspaceId);
  // Client-generated request UUID is also the session ID, so a network retry is idempotent.
  const existing = db
    .prepare("SELECT created_by,workspace_id FROM handoff_sessions WHERE id=?")
    .get(body.requestId);
  if (existing) {
    if (
      existing.created_by !== req.collaborator.id ||
      existing.workspace_id !== body.workspaceId
    )
      throw fail(409, "Request ID is already in use.");
    return res.json(detail(body.requestId));
  }
  const stored = db
    .prepare("SELECT graph_json FROM snapshots WHERE id=?")
    .get(body.snapshotId);
  if (!stored)
    throw fail(404, "Analyze this repository before creating a handoff.");
  const graph = JSON.parse(stored.graph_json);
  // Existing analysis accepts public GitHub repositories only. Private-repository ingestion is not enabled here.
  const ref = graph.references.find(
    (r) => r.id === body.referenceId && r.snapshotId === graph.snapshotId,
  );
  if (
    !ref ||
    /(?:^|\/)\.env(?:\.|$)|secret|credential|private.?key|(?:^|\/)(?:\.git|node_modules)\//i.test(
      ref.file,
    )
  )
    throw fail(400, "Invalid source reference.");
  if (!/^[a-f0-9]{40}$/i.test(graph.commit))
    throw fail(400, "The source must be pinned to a full commit SHA.");
  const full = await readSource(graph, body.referenceId);
  if (
    body.endLine < body.startLine ||
    body.endLine > full.endLine ||
    body.endLine - body.startLine >= 300
  )
    throw fail(400, "Select between 1 and 300 lines within the file.");
  const code = full.excerpt
    .split("\n")
    .slice(body.startLine - 1, body.endLine)
    .join("\n");
  if (code.length > 18000 || !code.trim())
    throw fail(
      400,
      "Select a smaller, non-empty code range (up to 18,000 characters).",
    );
  if (containsCredential(code))
    throw fail(
      400,
      "The selection appears to contain credentials. Choose code without secret values.",
    );
  if (body.assignedTo) {
    const member = membership(body.assignedTo, body.workspaceId);
    reviewer(member);
  }
  const component = graph.components
    .filter((c) => {
      const r = graph.references.find((r) => r.id === c.referenceId);
      return (
        r?.file === ref.file &&
        r.startLine <= body.startLine &&
        r.endLine >= body.endLine
      );
    })
    .sort((a, b) => {
      const span = (c) => {
        const r = graph.references.find((r) => r.id === c.referenceId);
        return r.endLine - r.startLine;
      };
      return span(a) - span(b);
    })[0];
  const sourceUrl = `${graph.repository}/blob/${graph.commit}/${ref.file.split("/").map(encodeURIComponent).join("/")}#L${body.startLine}-L${body.endLine}`;
  const context = collectHandoffContext(graph, component, {
    file: ref.file,
    startLine: body.startLine,
    endLine: body.endLine,
    excerpt: code,
    url: sourceUrl,
  });
  captureHandoffRepository(graph);
  const id = body.requestId,
    timestamp = now();
  // Recheck after the optional source fetch: simultaneous retries must not insert twice.
  const raced = db
    .prepare("SELECT created_by,workspace_id FROM handoff_sessions WHERE id=?")
    .get(id);
  if (raced) {
    if (
      raced.created_by !== req.collaborator.id ||
      raced.workspace_id !== body.workspaceId
    )
      throw fail(409, "Request ID is already in use.");
    return res.json(detail(id));
  }
  transaction(() => {
    db.prepare(
      "INSERT OR IGNORE INTO collaboration_repositories VALUES (?,?)",
    ).run(body.workspaceId, graph.repository);
    db.prepare(
      "INSERT INTO handoff_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      body.workspaceId,
      graph.repository,
      req.collaborator.id,
      body.assignedTo || null,
      body.title,
      body.question,
      body.expectedBehavior,
      body.actualBehavior,
      body.attemptedSolutions,
      "OPEN",
      timestamp,
      timestamp,
      null,
    );
    db.prepare(
      "INSERT INTO handoff_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      id,
      graph.snapshotId,
      component?.id || null,
      ref.id,
      ref.file,
      component?.role === "module" ? null : component?.name || null,
      body.startLine,
      body.endLine,
      code,
      graph.commit,
      graph.branch || null,
      sourceUrl,
      JSON.stringify(context),
      null,
      timestamp,
    );
    activity(id, req.collaborator.id, "created");
  });
  // Persist first. Provider failure cannot lose the question or prevent human review.
  void briefing(id).catch(() => {});
  res.status(201).json(detail(id));
});
handoffRoutes.get("/", (req, res) => {
  const workspaceId = uuid.parse(req.query.workspaceId);
  membership(req.collaborator.id, workspaceId);
  const offset = page(req.query.offset),
    search = text(160).default("").parse(req.query.search);
  const filter = z
    .enum(["all", "mine", "assigned", "open", "resolved"])
    .default("all")
    .parse(req.query.filter);
  const repository = text(300).default("").parse(req.query.repository);
  const statuses = z
    .enum(["", "OPEN", "IN_REVIEW", "NEEDS_CONTEXT", "RESOLVED", "CLOSED"])
    .default("")
    .parse(req.query.status);
  const where = `s.workspace_id=? AND EXISTS (SELECT 1 FROM collaboration_repositories r WHERE r.workspace_id=s.workspace_id AND r.repository_id=s.repository_id)
    AND (?='' OR s.repository_id=?) AND (?='' OR s.status=?) AND (instr(lower(s.title),lower(?))>0 OR instr(lower(s.question),lower(?))>0)
    AND (?<>'mine' OR s.created_by=?) AND (?<>'assigned' OR s.assigned_to=?)
    AND (?<>'open' OR s.status IN ('OPEN','IN_REVIEW','NEEDS_CONTEXT')) AND (?<>'resolved' OR s.status IN ('RESOLVED','CLOSED'))`;
  const args = [
    workspaceId,
    repository,
    repository,
    statuses,
    statuses,
    search,
    search,
    filter,
    req.collaborator.id,
    filter,
    req.collaborator.id,
    filter,
    filter,
  ];
  const sessions = db
    .prepare(
      `SELECT s.*,u.name AS author_name,p.file_path,p.commit_sha FROM handoff_sessions s JOIN collaboration_users u ON u.id=s.created_by JOIN handoff_snapshots p ON p.session_id=s.id WHERE ${where} ORDER BY s.updated_at DESC,s.rowid DESC LIMIT 30 OFFSET ?`,
    )
    .all(...args, offset);
  res.json({
    sessions,
    total: db
      .prepare(`SELECT count(*) AS n FROM handoff_sessions s WHERE ${where}`)
      .get(...args).n,
    repositories: db
      .prepare(
        "SELECT repository_id FROM collaboration_repositories WHERE workspace_id=? ORDER BY repository_id",
      )
      .all(workspaceId)
      .map((r) => r.repository_id),
  });
});
handoffRoutes.get("/knowledge", (req, res) => {
  const workspaceId = uuid.parse(req.query.workspaceId);
  membership(req.collaborator.id, workspaceId);
  const search = text(160).default("").parse(req.query.search),
    offset = page(req.query.offset);
  const rows = db
    .prepare(
      `SELECT s.id,s.title,s.repository_id,s.updated_at,p.file_path,p.commit_sha,p.source_url,p.start_line,p.end_line,
    r.solution,r.explanation,r.confirmed_at,u.name AS approved_by FROM handoff_resolutions r JOIN handoff_sessions s ON s.id=r.session_id
    JOIN handoff_snapshots p ON p.session_id=s.id JOIN collaboration_users u ON u.id=r.approved_by
    WHERE s.workspace_id=? AND r.approved_for_knowledge=1 AND NOT EXISTS (SELECT 1 FROM engineering_memory m WHERE m.origin_resolution_id=r.id AND m.status<>'approved') AND (instr(lower(s.title),lower(?))>0 OR instr(lower(r.explanation),lower(?))>0)
    ORDER BY r.confirmed_at DESC LIMIT 30 OFFSET ?`,
    )
    .all(workspaceId, search, search, offset);
  res.json({ entries: rows });
});
handoffRoutes.get("/:id/repository", (req, res) => {
  access(req);
  res.json(handoffRepository(snapshot(req.params.id)));
});
handoffRoutes.get("/:id/repository/source", (req, res) => {
  access(req);
  const path = z.string().min(1).max(500).parse(req.query.path);
  res.json(handoffRepositorySource(snapshot(req.params.id), path));
});
handoffRoutes.get("/:id", (req, res) => {
  const { member } = access(req);
  res.json({ ...detail(req.params.id), role: member.role });
});
handoffRoutes.patch("/:id", (req, res) => {
  const { session, member } = access(req);
  writable(session);
  if (
    session.created_by !== req.collaborator.id &&
    member.role !== "maintainer"
  )
    throw fail(403, "Only the author or a maintainer can change assignment.");
  const body = z
    .object({
      title: text(160).min(1).optional(),
      assignedTo: uuid.nullable().optional(),
    })
    .strict()
    .parse(req.body);
  if (body.assignedTo)
    reviewer(membership(body.assignedTo, session.workspace_id));
  transaction(() => {
    db.prepare(
      "UPDATE handoff_sessions SET title=?,assigned_to=? WHERE id=?",
    ).run(
      body.title || session.title,
      body.assignedTo === undefined ? session.assigned_to : body.assignedTo,
      session.id,
    );
    activity(session.id, req.collaborator.id, "updated", body);
  });
  res.json(detail(session.id));
});
handoffRoutes.get("/:id/comments", (req, res) => {
  access(req);
  res.json({ comments: comments(req.params.id, page(req.query.offset)) });
});
handoffRoutes.post("/:id/comments", (req, res) => {
  const { session, member } = access(req);
  writable(session);
  const body = z
    .object({
      content: text(5000).min(1),
      lineStart: z.number().int().positive().optional(),
      lineEnd: z.number().int().positive().optional(),
      kind: z.enum(["comment", "context_request"]).default("comment"),
    })
    .strict()
    .parse(req.body);
  if (body.kind === "context_request") reviewer(member);
  const snap = snapshot(session.id);
  if (body.lineEnd !== undefined && body.lineStart === undefined)
    throw fail(400, "A starting line is required.");
  if (
    body.lineStart !== undefined &&
    (body.lineStart < snap.start_line ||
      body.lineStart > snap.end_line ||
      (body.lineEnd ?? body.lineStart) > snap.end_line ||
      (body.lineEnd ?? body.lineStart) < body.lineStart)
  )
    throw fail(400, "Annotation must be inside the original selected code.");
  transaction(() => {
    db.prepare("INSERT INTO handoff_comments VALUES (?,?,?,?,?,?,?,?,?)").run(
      randomUUID(),
      session.id,
      snap.id,
      req.collaborator.id,
      body.content,
      body.lineStart || null,
      body.lineEnd || body.lineStart || null,
      body.kind,
      now(),
    );
    if (body.kind === "context_request")
      db.prepare(
        "UPDATE handoff_sessions SET status='NEEDS_CONTEXT' WHERE id=?",
      ).run(session.id);
    activity(
      session.id,
      req.collaborator.id,
      body.kind === "context_request" ? "context_requested" : "commented",
      { line: body.lineStart || null },
    );
  });
  res.status(201).json(detail(session.id));
});
handoffRoutes.post("/:id/context", async (req, res) => {
  access(req);
  res.json({ briefing: await briefing(req.params.id) });
});
handoffRoutes.patch("/:id/status", (req, res) => {
  const { session, member } = access(req);
  const { status } = z
    .object({
      status: z.enum(["OPEN", "IN_REVIEW", "NEEDS_CONTEXT", "CLOSED"]),
    })
    .strict()
    .parse(req.body);
  if (!(
    session.created_by === req.collaborator.id &&
    ["OPEN", "CLOSED"].includes(status)
  ))
    reviewer(member);
  if (
    status === "CLOSED" &&
    session.status !== "RESOLVED" &&
    session.created_by !== req.collaborator.id &&
    member.role !== "maintainer"
  )
    throw fail(
      403,
      "Only the author or maintainer can close an unresolved session.",
    );
  transaction(() => {
    db.prepare(
      "UPDATE handoff_sessions SET status=?,resolved_at=? WHERE id=?",
    ).run(status, status === "CLOSED" ? session.resolved_at : null, session.id);
    if (
      ["RESOLVED", "CLOSED"].includes(session.status) &&
      status !== "CLOSED"
    ) {
      db.prepare(
        "UPDATE handoff_resolutions SET approved_for_knowledge=0 WHERE session_id=?",
      ).run(session.id);
      reopenHandoffMemory(session.id, req.collaborator.id);
    }
    activity(session.id, req.collaborator.id, "status_changed", {
      from: session.status,
      to: status,
    });
  });
  res.json(detail(session.id));
});
handoffRoutes.post("/:id/resolution", (req, res) => {
  const { session, member } = access(req);
  reviewer(member);
  writable(session);
  if (session.created_by === req.collaborator.id)
    throw fail(
      403,
      "Ask another reviewer to propose a solution for your question.",
    );
  const body = z
    .object({ solution: text(5000).min(1), explanation: text(5000).min(1) })
    .strict()
    .parse(req.body);
  transaction(() => {
    db.prepare(
      "INSERT INTO handoff_resolutions VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      session.id,
      req.collaborator.id,
      null,
      body.solution,
      body.explanation,
      0,
      null,
      now(),
      null,
    );
    db.prepare("UPDATE handoff_sessions SET status='IN_REVIEW' WHERE id=?").run(
      session.id,
    );
    activity(session.id, req.collaborator.id, "solution_proposed");
  });
  res.status(201).json(detail(session.id));
});
handoffRoutes.post("/:id/confirm-resolution", (req, res) => {
  const { session } = access(req);
  writable(session);
  if (session.created_by !== req.collaborator.id)
    throw fail(
      403,
      "Only the question author can confirm that the solution worked.",
    );
  const { resolutionId } = z
    .object({ resolutionId: uuid })
    .strict()
    .parse(req.body);
  const resolution = db
    .prepare("SELECT * FROM handoff_resolutions WHERE id=? AND session_id=?")
    .get(resolutionId, session.id);
  if (!resolution || resolution.proposed_by === req.collaborator.id)
    throw fail(400, "Choose a solution from a teammate in this session.");
  if (resolution.confirmed_at)
    throw fail(
      409,
      "Ask for a new proposal after reopening a resolved question.",
    );
  const latest = db
    .prepare(
      "SELECT id FROM handoff_resolutions WHERE session_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
    )
    .get(session.id);
  if (latest.id !== resolutionId)
    throw fail(409, "Review the most recent proposed solution.");
  transaction(() => {
    db.prepare(
      "UPDATE handoff_resolutions SET confirmed_by=?,confirmed_at=? WHERE id=?",
    ).run(req.collaborator.id, now(), resolutionId);
    db.prepare(
      "UPDATE handoff_sessions SET status='RESOLVED',resolved_at=? WHERE id=?",
    ).run(now(), session.id);
    activity(session.id, req.collaborator.id, "solution_confirmed");
  });
  res.json(detail(session.id));
});
handoffRoutes.post("/:id/approve-knowledge", (req, res) => {
  const { type } = z
    .object({
      type: z.enum(["decision", "failure_lesson"]).default("decision"),
    })
    .strict()
    .parse(req.body);
  const { session, member } = access(req);
  if (member.role !== "maintainer")
    throw fail(403, "Only maintainers can approve team knowledge.");
  if (!["RESOLVED", "CLOSED"].includes(session.status) || !session.resolved_at)
    throw fail(409, "Confirm a solution before approving knowledge.");
  const row = db
    .prepare(
      "SELECT id FROM handoff_resolutions WHERE session_id=? AND confirmed_at IS NOT NULL ORDER BY confirmed_at DESC,rowid DESC LIMIT 1",
    )
    .get(session.id);
  if (!row) throw fail(409, "No confirmed solution is available.");
  transaction(() => {
    db.prepare(
      "UPDATE handoff_resolutions SET approved_for_knowledge=1,approved_by=? WHERE id=?",
    ).run(req.collaborator.id, row.id);
    promoteHandoffMemory(session, row.id, req.collaborator.id, type);
    activity(session.id, req.collaborator.id, "knowledge_approved");
  });
  res.json(detail(session.id));
});
handoffRoutes.post("/:id/share", (req, res) => {
  access(req);
  res.json({
    path: `/#/handoffs/${req.params.id}`,
    access:
      "Workspace members only. Invite teammates separately; this link grants no access.",
  });
});
