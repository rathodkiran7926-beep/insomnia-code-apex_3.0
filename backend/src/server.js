import express from "express";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { z } from "zod";
import { db, saveSnapshot } from "./storage.js";
import { parseRepository } from "./github.js";
import { readSource, answerQuestion } from "./workspace.js";
import { generateGuide } from "./generatedGuides.js";
import { discussionRoutes } from "./discussionRoutes.js";
import { prRoutes } from "./prRoutes.js";
import { collaborationRoutes } from "./collaborationAuth.js";
import { handoffRoutes } from "./handoffRoutes.js";
import { journeyRoutes } from "./journeyRoutes.js";
import { engineeringMemoryRoutes } from "./engineeringMemoryRoutes.js";
import { practiceRoutes } from "./practiceRoutes.js";
const app = express();
app.disable("x-powered-by");
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
app.use("/api/collaboration", collaborationRoutes);
app.use("/api/handoffs", handoffRoutes);
app.use("/api", journeyRoutes);
app.use("/api/memory", engineeringMemoryRoutes);
app.use("/api/practice", practiceRoutes);
let active = 0;
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.post("/api/analyses", (req, res, next) => {
  try {
    const body = z
      .object({
        url: z.string().max(300),
        revision: z.string().max(200).optional(),
      })
      .strict()
      .parse(req.body);
    parseRepository(body.url);
    if (active >= 2)
      return res.status(429).json({
        error: "Two analyses are already running. Retry when one finishes.",
      });
    const id = randomUUID();
    db.prepare("INSERT INTO analysis_jobs VALUES (?,?,?,?,?,?)").run(
      id,
      "running",
      0,
      "Queued for worker",
      null,
      new Date().toISOString(),
    );
    // One dedicated thread per bounded job keeps parsing away from HTTP requests.
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      workerData: body,
      resourceLimits: { maxOldGenerationSizeMb: 384 },
    });
    active++;
    let finished = false;
    const finish = (status, message, snapshot = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      active--;
      db.prepare(
        "UPDATE analysis_jobs SET status=?, progress=?, message=?, snapshot_id=? WHERE id=?",
      ).run(status, status === "complete" ? 100 : 0, message, snapshot, id);
    };
    const timeout = setTimeout(() => {
      finish("failed", "Analysis exceeded the five minute limit");
      void worker.terminate();
    }, 300000);
    worker.on("message", (event) => {
      if (finished) return;
      if (event.type === "progress")
        db.prepare(
          "UPDATE analysis_jobs SET progress=?,message=? WHERE id=?",
        ).run(event.progress, event.message, id);
      if (event.type === "failed") finish("failed", event.message);
      if (event.type === "complete") {
        try {
          saveSnapshot(
            event.graph,
            event.docs,
            event.markdown,
            event.files,
            event.setupMetadata,
          );
          finish("complete", "Analysis complete", event.graph.snapshotId);
        } catch {
          finish("failed", "Could not persist analysis");
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
const server = app.listen(Number(process.env.PORT || 3001), "127.0.0.1", () =>
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
