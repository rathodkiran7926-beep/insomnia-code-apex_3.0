import express from "express";
import { ideRoutes } from "./ideRoutes.js";
import { componentNamesMiddleware } from "./componentPresentation.js";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { z } from "zod";
import { db, saveSnapshot, reusableSnapshot } from "./storage.js";
import { parseRepository, resolveRepository, EXTRACTION_POLICY_VERSION } from "./github.js";
import { ANALYZER_VERSION } from "./analyzer.js";
import { readSource, answerQuestion } from "./workspace.js";
import { generateGuide } from "./generatedGuides.js";
import { discussionRoutes } from "./discussionRoutes.js";
import { prRoutes } from "./prRoutes.js";
import { collaborationRoutes } from "./collaborationAuth.js";
import { handoffRoutes } from "./handoffRoutes.js";
import { journeyRoutes } from "./journeyRoutes.js";
import { engineeringMemoryRoutes } from "./engineeringMemoryRoutes.js";
import { practiceRoutes } from "./practiceRoutes.js";
import { agentContextRouter } from "./agentContextRoutes.js";
import { impactPreviewRoutes } from "./impactPreviewRoutes.js";
import { contributionRoutes } from "./contributionRoutes.js";
const app = express();
app.disable("x-powered-by");
app.use("/api", componentNamesMiddleware(db));
app.use("/api/practice", express.json({ limit: "128kb" }));
app.use(express.json({ limit: "24kb" }));
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin &&
    ![
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      `http://127.0.0.1:${process.env.PORT || 3001}`,
      `http://localhost:${process.env.PORT || 3001}`,
      ...(process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : []),
    ].includes(req.headers.origin)
  )
    return res.status(403).json({ error: "Origin not allowed" });
  next();
});
db.prepare(
  "UPDATE analysis_jobs SET status='failed', message='Server restarted; please retry analysis' WHERE status='running'",
).run();
app.use("/api/discussions", discussionRoutes);
app.use("/api/pr", prRoutes);
app.use("/api/ide", ideRoutes);
app.use("/api/collaboration", collaborationRoutes);
app.use("/api/handoffs", handoffRoutes);
app.use("/api", journeyRoutes);
app.use("/api/memory", engineeringMemoryRoutes);
app.use("/api/practice", practiceRoutes);
app.use("/api/snapshots", agentContextRouter);
app.use("/api/contributions", contributionRoutes);
let active = 0;
const analysesInFlight = new Map();
const analysisVersions = { analyzerVersion: ANALYZER_VERSION, extractionPolicy: EXTRACTION_POLICY_VERSION };
function analysisJob(status = "running", message = "Queued for worker", snapshot = null) {
  const id = randomUUID();
  db.prepare("INSERT INTO analysis_jobs VALUES (?,?,?,?,?,?)").run(
    id, status, status === "complete" ? 100 : 0, message, snapshot, new Date().toISOString(),
  );
  return id;
}
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.post("/api/analyses", async (req, res, next) => {
  try {
    const startedAt = Date.now();
    const body = z
      .object({
        url: z.string().max(300),
        revision: z.string().max(200).optional(),
      })
      .strict()
      .parse(req.body);
    parseRepository(body.url);
    let resolved;
    try {
      // Always verify public access and the current remote SHA, including hits.
      resolved = await resolveRepository(body.url, body.revision);
    } catch (error) {
      return res.status(202).json({ id: analysisJob("failed", error.message) });
    }
    const identity = JSON.stringify([resolved.repository, resolved.commit, analysisVersions]);
    const pending = analysesInFlight.get(identity);
    if (pending) return res.status(202).json({ id: pending });
    const cached = reusableSnapshot(resolved.repository, resolved.commit, analysisVersions);
    if (cached) return res.status(202).json({ id: analysisJob("complete", "Analysis complete", cached.snapshotId) });
    if (active >= 2)
      return res.status(429).json({
        error: "Two analyses are already running. Retry when one finishes.",
      });
    const id = analysisJob();
    analysesInFlight.set(identity, id);
    active++;
    let worker;
    let timeout;
    let finished = false;
    const finish = (status, message, snapshot = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      active--;
      if (analysesInFlight.get(identity) === id) analysesInFlight.delete(identity);
      db.prepare(
        "UPDATE analysis_jobs SET status=?, progress=?, message=?, snapshot_id=? WHERE id=?",
      ).run(status, status === "complete" ? 100 : 0, message, snapshot, id);
      if (status === "failed" && worker) void worker.terminate().catch(() => {});
    };
    try {
      // Only the verified immutable resolution crosses into the worker.
      worker = new Worker(new URL("./worker.js", import.meta.url), {
        workerData: { ...body, resolved },
        resourceLimits: { maxOldGenerationSizeMb: 384 },
      });
    } catch (error) {
      finish("failed", error.message);
      throw error;
    }
    timeout = setTimeout(() => {
      finish("failed", "Analysis exceeded the five minute limit");
    }, Math.max(1, 300000 - (Date.now() - startedAt)));
    worker.on("message", (event) => {
      if (finished) return;
      if (event.type === "progress")
        db.prepare(
          "UPDATE analysis_jobs SET progress=?,message=? WHERE id=?",
        ).run(event.progress, event.message, id);
      if (event.type === "failed") finish("failed", event.message);
      if (event.type === "complete") {
        try {
          if (event.graph.repository !== resolved.repository || event.graph.commit !== resolved.commit ||
            event.analysis?.analyzerVersion !== analysisVersions.analyzerVersion ||
            event.analysis?.extractionPolicy !== analysisVersions.extractionPolicy)
            throw new Error("Worker returned incompatible analysis evidence");
          saveSnapshot(
            event.graph,
            event.docs,
            event.markdown,
            event.files,
            event.setupMetadata,
            event.analysis,
          );
          finish("complete", "Analysis complete", event.graph.snapshotId);
        } catch (error) {
          finish("failed", error.code === "SNAPSHOT_EVIDENCE_CONFLICT" ? error.message : "Could not persist analysis");
        }
      }
    });
    worker.on("error", (error) => finish("failed", error.message));
    worker.on("exit", () => {
      if (!finished) finish("failed", "Analysis worker stopped unexpectedly");
    });
    res.status(202).json({ id });
  } catch (error) {
    next(error);
  }
});
app.get("/api/snapshots/latest", (req, res, next) => {
  try {
    let repository;
    if (req.query.repository !== undefined)
      repository = parseRepository(
        z.string().max(300).parse(req.query.repository),
      ).url;
    if (!repository) {
      const repositories = db
        .prepare("SELECT DISTINCT repository_id FROM snapshots")
        .all();
      if (!repositories.length)
        return res
          .status(404)
          .json({ error: "No analyzed repository snapshot exists yet." });
      if (repositories.length > 1)
        return res
          .status(400)
          .json({
            error:
              "Multiple repositories are analyzed. Supply the current repository URL.",
          });
      repository = repositories[0].repository_id;
    }
    const row = db
      .prepare(
        "SELECT id, repository_id, commit_sha FROM snapshots WHERE repository_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(repository);
    if (!row)
      return res
        .status(404)
        .json({
          error: "No analyzed snapshot exists for this repository yet.",
        });
    res.json({
      snapshotId: row.id,
      repository: row.repository_id,
      commit: row.commit_sha,
    });
  } catch (error) {
    next(error);
  }
});
app.get("/api/analyses/:id", (req, res) => {
  const job = db
    .prepare("SELECT * FROM analysis_jobs WHERE id=?")
    .get(req.params.id);
  return job
    ? res.json(job)
    : res.status(404).json({ error: "Analysis job not found" });
});
app.get("/api/snapshots/:id", (req, res) => {
  const row = db
    .prepare("SELECT graph_json FROM snapshots WHERE id=?")
    .get(req.params.id);
  const doc = db
    .prepare("SELECT data FROM documentation WHERE snapshot_id=?")
    .get(req.params.id);
  return row && doc
    ? res.json({
        ...JSON.parse(row.graph_json),
        documentation: JSON.parse(doc.data),
      })
    : res.status(404).json({ error: "Snapshot not found" });
});
function workspaceGraph(id) {
  const row = db.prepare("SELECT graph_json FROM snapshots WHERE id=?").get(id);
  if (!row)
    throw Object.assign(new Error("Snapshot not found"), { status: 404 });
  return JSON.parse(row.graph_json);
}
app.use(
  "/api/snapshots",
  impactPreviewRoutes({ loadSnapshot: workspaceGraph, readSource }),
);
app.get("/api/snapshots/:id/source", async (req, res, next) => {
  try {
    const graph = workspaceGraph(req.params.id);
    const referenceId = z.string().max(200).parse(req.query.referenceId);
    const source = await readSource(graph, referenceId);
    res.json(source);
  } catch (error) {
    next(error);
  }
});
let mentorRequests = 0;
app.post("/api/snapshots/:id/questions", async (req, res, next) => {
  try {
    const body = z
      .object({
        componentId: z.string().max(200),
        question: z.string().trim().min(1).max(1500),
      })
      .strict()
      .parse(req.body);
    const graph = workspaceGraph(req.params.id);
    if (mentorRequests >= 3)
      return res
        .status(429)
        .json({ error: "Mentor is busy. Try again shortly." });
    mentorRequests++;
    try {
      res.json(await answerQuestion(graph, body.componentId, body.question));
    } finally {
      mentorRequests--;
    }
  } catch (error) {
    next(error);
  }
});
app.post(
  "/api/snapshots/:id/generated-documentation",
  async (req, res, next) => {
    try {
      res.json(await generateGuide(workspaceGraph(req.params.id), req.body));
    } catch (error) {
      next(error);
    }
  },
);
app.get("/api/snapshots/:id/documentation", (req, res) => {
  const row = db
    .prepare("SELECT markdown FROM documentation WHERE snapshot_id=?")
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: "Documentation not found" });
  if (req.query.download === "1")
    res.attachment(`codebase-${req.params.id}.md`);
  res.type("text/markdown").send(row.markdown);
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "API route not found" }),
);
const dist = fileURLToPath(new URL("../../frontend/dist/", import.meta.url));
if (existsSync(dist)) app.use(express.static(dist));
app.use((error, _req, res, _next) =>
  res
    .status(
      error instanceof z.ZodError || /Enter a public/.test(error.message)
        ? 400
        : error.status || 500,
    )
    .json({
      error:
        error instanceof z.ZodError
          ? "Invalid request data"
          : error.type === "entity.parse.failed"
            ? "Invalid JSON request"
            : error.message,
    }),
);
export const server = app.listen(Number(process.env.PORT || 3001), "127.0.0.1", () =>
  console.log(
    `Codebase Mentor API: http://127.0.0.1:${process.env.PORT || 3001}`,
  ),
);
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${process.env.PORT || 3001} is already in use. Stop the older Codebase Mentor backend before restarting this server; otherwise the UI will keep connecting to the older process.`,
    );
  } else {
    console.error(`Backend could not start: ${error.message}`);
  }
  process.exit(1);
});
