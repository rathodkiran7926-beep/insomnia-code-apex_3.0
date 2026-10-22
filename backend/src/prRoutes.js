import express from "express";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, saveSnapshot } from "./storage.js";
import { parsePullRequest, listPullRequests } from "./prGithub.js";
import { simulateFile } from "./mergeSimulator.js";
export const prRoutes = express.Router();
db.exec(`CREATE TABLE IF NOT EXISTS pr_jobs(id TEXT PRIMARY KEY,status TEXT NOT NULL,progress INTEGER NOT NULL,message TEXT,comparison_id TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pr_comparisons(id TEXT PRIMARY KEY,base_snapshot_id TEXT NOT NULL,head_snapshot_id TEXT NOT NULL,data TEXT NOT NULL);`);
if (
  !db
    .prepare("PRAGMA table_info(pr_jobs)")
    .all()
    .some((column) => column.name === "url")
)
  db.exec("ALTER TABLE pr_jobs ADD COLUMN url TEXT");
db.prepare(
  "UPDATE pr_jobs SET status='failed',message='Server restarted. Retry this comparison.' WHERE status='running'",
).run();
let active = 0;
prRoutes.get("/pulls", async (req, res, next) => {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const query = z
      .object({
        snapshotId: z.string().min(1).max(150),
        state: z.enum(["open", "closed", "all"]).default("open"),
        page: z.coerce.number().int().min(1).max(100).default(1),
      })
      .strict()
      .parse(req.query);
    const snapshot = db
      .prepare("SELECT graph_json FROM snapshots WHERE id=?")
      .get(query.snapshotId);
    if (!snapshot)
      return res.status(404).json({
        error: "Analyze a repository first to load its pull requests.",
      });
    res.json(
      await listPullRequests(
        JSON.parse(snapshot.graph_json).repository,
        query.state,
        query.page,
        controller.signal,
      ),
    );
  } catch (error) {
    next(error);
  }
});
prRoutes.post("/analyses", (req, res, next) => {
  try {
    const { url } = z
      .object({ url: z.string().trim().max(400) })
      .strict()
      .parse(req.body);
    parsePullRequest(url);
    if (active >= 2)
      return res.status(429).json({
        error: "Two PR comparisons are running. Retry after one finishes.",
      });
    const id = randomUUID();
    db.prepare(
      "INSERT INTO pr_jobs(id,status,progress,message,comparison_id,created_at,url) VALUES (?,?,?,?,?,?,?)",
    ).run(id, "running", 0, "Queued", null, new Date().toISOString(), url);
    const worker = new Worker(new URL("./prWorker.js", import.meta.url), {
      workerData: { url },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    active++;
    let done = false;
    const finish = (status, message, comparison = null) => {
      if (done) return;
      done = true;
      active--;
      clearTimeout(timer);
      db.prepare(
        "UPDATE pr_jobs SET status=?,progress=?,message=?,comparison_id=? WHERE id=?",
      ).run(status, status === "complete" ? 100 : 0, message, comparison, id);
    };
    const timer = setTimeout(() => {
      finish("failed", "PR comparison exceeded five minutes");
      void worker.terminate();
    }, 300000);
    worker.on("message", (event) => {
      if (done) return;
      if (event.type === "progress")
        db.prepare("UPDATE pr_jobs SET progress=?,message=? WHERE id=?").run(
          event.progress,
          event.message,
          id,
        );
      if (event.type === "failed") finish("failed", event.message);
      if (event.type === "complete") {
        try {
          for (const snapshot of event.snapshots)
            saveSnapshot(
              snapshot.graph,
              snapshot.docs,
              snapshot.markdown,
              snapshot.files,
            );
          const r = event.result;
          db.prepare("INSERT INTO pr_comparisons VALUES (?,?,?,?)").run(
            r.id,
            r.beforeSnapshotId,
            r.afterSnapshotId,
            JSON.stringify(r),
          );
          finish("complete", "Comparison complete", r.id);
        } catch {
          finish("failed", "Could not store the PR comparison");
        }
      }
    });
    worker.on("error", (error) => finish("failed", error.message));
    worker.on("exit", () => {
      if (!done) finish("failed", "PR worker stopped unexpectedly");
    });
    res.status(202).json({ id });
  } catch (error) {
    next(error);
  }
});
prRoutes.get("/analyses/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM pr_jobs WHERE id=?").get(req.params.id);
  row
    ? res.json(row)
    : res.status(404).json({ error: "PR analysis job not found" });
});
prRoutes.get("/comparisons/:id", (req, res) => {
  const row = db
    .prepare("SELECT data FROM pr_comparisons WHERE id=?")
    .get(req.params.id);
  row
    ? res.json(JSON.parse(row.data))
    : res.status(404).json({ error: "PR comparison not found" });
});
let simulations = 0;
prRoutes.post("/comparisons/:id/simulate", async (req, res, next) => {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  let acquired = false;
  try {
    const { path } = z
      .object({ path: z.string().min(1).max(1000) })
      .strict()
      .parse(req.body);
    const row = db
      .prepare("SELECT data FROM pr_comparisons WHERE id=?")
      .get(req.params.id);
    if (!row) return res.status(404).json({ error: "PR comparison not found" });
    if (simulations >= 2)
      return res
        .status(429)
        .json({ error: "Two merge simulations are running. Retry shortly." });
    simulations++;
    acquired = true;
    res.json(await simulateFile(JSON.parse(row.data), path, controller.signal));
  } catch (error) {
    next(error);
  } finally {
    if (acquired) simulations--;
  }
});
