import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticate } from "./collaborationAuth.js";
import { containsCredential } from "./handoffSafety.js";
import { journeyCatalog, journeyById } from "./journeyCatalog.js";
import { db } from "./journeyStorage.js";
import {
  explainedTrace,
  traceFor,
  answerEventQuestion,
  saveObservedRun,
  savedJourney,
} from "./journeyService.js";
import { runnerStatus, runApprovedScenario } from "./journeyRunner.js";
import { repositoryJourneys, repositoryGraph } from "./repositoryJourneys.js";
import { readSource } from "./workspace.js";
import { explainJourneyEvent } from "./journeyExplanations.js";
export const journeyRoutes = Router();
const level = z.enum(["beginner", "intermediate", "advanced"]);
const missing = () =>
  Object.assign(new Error("Journey or event not found"), { status: 404 });
journeyRoutes.get("/codejourneys", (req, res) => {
  if (req.query.snapshotId) {
    const snapshotId = z.string().max(100).parse(req.query.snapshotId);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .parse(req.query.page || 1);
    const journeys = repositoryJourneys(snapshotId, { page });
    const graph = repositoryGraph(snapshotId),
      refs = new Set(graph.references.map((r) => r.id));
    const total = graph.components.filter(
      (c) =>
        refs.has(c.referenceId) &&
        !["module", "application", "router"].includes(c.role),
    ).length;
    return res.json({
      journeys: journeys.map((j) => ({
        ...j,
        events: j.events.map(({ sourceExcerpt, excerpt, ...event }) => event),
      })),
      origin: "repository",
      snapshotId,
      total,
      page,
      hasMore: page * 60 < total,
    });
  }
  res.json({
    journeys: req.query.examples === "true" ? journeyCatalog : [],
    notice: "Analyze a repository to see its actual source paths.",
  });
});
journeyRoutes.get("/codejourneys/runner", async (_req, res) =>
  res.json(await runnerStatus()),
);
journeyRoutes.get("/codejourneys/progress", authenticate, (req, res) =>
  res.json({
    checkpoints: db
      .prepare("SELECT data FROM playback_checkpoints WHERE user_id=?")
      .all(req.collaborator.id)
      .map((r) => JSON.parse(r.data)),
  }),
);
journeyRoutes.get("/codejourneys/:id", (req, res) => {
  const journey = req.query.sourceSnapshot
    ? savedJourney(
        z.string().max(100).parse(req.query.sourceSnapshot),
        req.params.id,
      )
    : journeyById(req.params.id);
  if (!journey) throw missing();
  res.json({ journey });
});
journeyRoutes.get("/snapshots/:id/scenarios", (req, res) => {
  const journey = journeyCatalog.find((j) => j.snapshotId === req.params.id);
  if (!journey)
    return res.json({
      scenarios: [],
      notice:
        "No approved instrumentation recipe is registered for this repository snapshot. Reviewed learning recipes are available in CodeJourney.",
    });
  res.json({ scenarios: journey.scenarios, snapshotId: journey.snapshotId });
});
journeyRoutes.get("/journey-snapshots/:id/source", async (req, res) => {
  if (!req.params.id.startsWith("lesson-"))
    return res.json(
      await readSource(
        repositoryGraph(req.params.id),
        z.string().max(200).parse(req.query.referenceId),
      ),
    );
  const row = db
    .prepare("SELECT data FROM runtime_recipe_sources WHERE snapshot_id=?")
    .get(req.params.id);
  const journey = row ? JSON.parse(row.data) : null;
  const event = journey?.events.find(
    (e) => e.sourceRefId === req.query.referenceId,
  );
  if (!journey || !event) throw missing();
  res.json({
    file: event.source.file,
    excerpt: journey.source,
    startLine: 1,
    endLine: journey.source.split("\n").length,
    complete: true,
    snapshotId: journey.snapshotId,
    sourceHash: journey.sourceHash,
    url: `/api/journey-snapshots/${journey.snapshotId}/source?referenceId=${encodeURIComponent(event.sourceRefId)}`,
  });
});
journeyRoutes.get("/codejourneys/:id/scenarios/:scenario", (req, res) =>
  res.json(explainedTrace(req.params.id, req.params.scenario)),
);
journeyRoutes.get("/traces/:id", (req, res, next) => {
  if (req.params.id.startsWith("explained:"))
    return res.json(traceFor(req.params.id));
  authenticate(req, res, (error) => {
    if (error) return next(error);
    try {
      res.json(traceFor(req.params.id, req.collaborator.id));
    } catch (e) {
      next(e);
    }
  });
});
journeyRoutes.get("/codejourneys/:id/runs", authenticate, (req, res) => {
  if (!journeyById(req.params.id)) throw missing();
  const rows = db
    .prepare(
      "SELECT data FROM runtime_traces WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
    )
    .all(req.collaborator.id)
    .map((r) => JSON.parse(r.data))
    .filter((r) => r.journeyId === req.params.id);
  res.json({ traces: rows });
});
let running = 0,
  questions = 0;
journeyRoutes.post("/scenarios/:id/runs", authenticate, async (req, res) => {
  z.object({ approved: z.literal(true) })
    .strict()
    .parse(req.body);
  const recipe = journeyCatalog
    .flatMap((j) => j.scenarios.map((s) => ({ j, s })))
    .find(({ s }) => s.runRecipe === req.params.id);
  if (!recipe)
    throw Object.assign(
      new Error("Only fixed reviewed execution recipes can run."),
      { status: 400 },
    );
  if (running)
    throw Object.assign(
      new Error("An isolated scenario is running. Retry shortly."),
      { status: 429 },
    );
  running++;
  try {
    const result = await runApprovedScenario(req.params.id);
    res
      .status(201)
      .json(saveObservedRun(recipe.j, recipe.s, result, req.collaborator.id));
  } finally {
    running--;
  }
});
journeyRoutes.put("/codejourneys/:id/checkpoint", authenticate, (req, res) => {
  const body = z
    .object({
      traceId: z.string().max(250),
      eventId: z.string().max(300),
      snapshotId: z.string().max(100),
      level,
      visited: z.array(z.string().max(300)).max(100),
      predictions: z.record(
        z.string(),
        z.object({ answer: z.string().max(30), correct: z.boolean() }).strict(),
      ),
      completed: z.boolean(),
    })
    .strict()
    .parse(req.body);
  const trace = traceFor(body.traceId, req.collaborator.id),
    journey = journeyById(trace.journeyId);
  if (
    req.params.id !== trace.journeyId ||
    trace.snapshotId !== body.snapshotId ||
    !trace.events.some((e) => e.id === body.eventId) ||
    body.visited.some((id) => !trace.events.some((e) => e.id === id))
  )
    throw Object.assign(new Error("Checkpoint does not match this trace."), {
      status: 400,
    });
  for (const [id, prediction] of Object.entries(body.predictions)) {
    const event = trace.events.find((e) => e.id === id);
    if (
      !event?.prediction ||
      !event.prediction.options.some((o) => o.id === prediction.answer) ||
      prediction.correct !== (prediction.answer === event.prediction.correct)
    )
      throw Object.assign(new Error("Invalid prediction evidence."), {
        status: 400,
      });
  }
  const allViewed = trace.events.every((e) => body.visited.includes(e.id)),
    allAnswered = trace.events.every(
      (e) => !e.prediction || body.predictions[e.id],
    );
  if (
    body.completed &&
    (!allViewed || !allAnswered || body.eventId !== trace.events.at(-1).id)
  )
    throw Object.assign(
      new Error(
        "Visit the whole path and answer its checkpoints before completion.",
      ),
      { status: 400 },
    );
  const previousRow = db
    .prepare(
      "SELECT data FROM playback_checkpoints WHERE user_id=? AND journey_id=?",
    )
    .get(req.collaborator.id, journey.id);
  const previous = previousRow ? JSON.parse(previousRow.data) : null;
  const completedScenarios = new Set(
    previous?.snapshotId === trace.snapshotId
      ? [
          ...(previous.completedScenarios || []),
          ...(previous.completed ? [previous.scenarioId] : []),
        ]
      : [],
  );
  if (body.completed) completedScenarios.add(trace.scenarioId);
  const data = {
    ...body,
    journeyId: journey.id,
    scenarioId: trace.scenarioId,
    completedScenarios: [...completedScenarios],
    updatedAt: new Date().toISOString(),
  };
  db.prepare(
    "INSERT OR REPLACE INTO playback_checkpoints VALUES (?,?,?,?)",
  ).run(req.collaborator.id, journey.id, JSON.stringify(data), data.updatedAt);
  res.json(data);
});
journeyRoutes.post("/traces/:id/questions", authenticate, async (req, res) => {
  const body = z
    .object({
      eventId: z.string().max(300),
      snapshotId: z.string().max(100),
      question: z
        .string()
        .trim()
        .min(1)
        .max(1500)
        .refine((s) => !containsCredential(s)),
      level,
    })
    .strict()
    .parse(req.body);
  const trace = traceFor(req.params.id, req.collaborator.id),
    event = trace.events.find((e) => e.id === body.eventId);
  if (!event || body.snapshotId !== trace.snapshotId) throw missing();
  if (questions >= 3)
    throw Object.assign(new Error("Mentor is busy. Retry shortly."), {
      status: 429,
    });
  questions++;
  try {
    const answer = await answerEventQuestion(
      trace,
      event,
      body.question,
      body.level,
    );
    db.prepare("INSERT INTO journey_questions VALUES (?,?,?,?,?,?,?,?)").run(
      randomUUID(),
      req.collaborator.id,
      trace.id,
      event.id,
      trace.snapshotId,
      body.question,
      JSON.stringify(answer),
      new Date().toISOString(),
    );
    res.json(answer);
  } finally {
    questions--;
  }
});
journeyRoutes.get(
  "/traces/:id/events/:eventId/explanation",
  (req, res, next) => {
    const explain = async () => {
      const trace = traceFor(req.params.id, req.collaborator?.id);
      const event = trace.events.find((item) => item.id === req.params.eventId);
      if (!event) throw missing();
      const result = await explainJourneyEvent(
        trace,
        event,
        level.parse(req.query.level || "beginner"),
      );
      res.set("Cache-Control", "no-store").json(result);
    };
    if (req.params.id.startsWith("explained:")) void explain().catch(next);
    else
      authenticate(req, res, (error) => {
        if (error) return next(error);
        void explain().catch(next);
      });
  },
);
