import express from "express";
import { z } from "zod";
import { db } from "./storage.js";
import {
  discussion,
  startDiscussion,
  sessionView,
  discussionTurn,
  scopedEvidence,
  draftDecision,
  saveDecision,
} from "./discussion.js";
import {
  availableVoices,
  createSpeech,
  transcribe,
} from "./discussionVoice.js";

export const discussionRoutes = express.Router();
const buckets = new Map();
discussionRoutes.use((req, res, next) => {
  const now = Date.now(),
    identity = req.ip || "local";
  let bucket = buckets.get(identity);
  if (!bucket || bucket.until < now) {
    bucket = { until: now + 60000, count: 0 };
    buckets.set(identity, bucket);
  }
  if (++bucket.count > 45)
    return res
      .status(429)
      .json({ error: "Discussion request limit reached. Retry in a minute." });
  if (buckets.size > 1000)
    for (const [id, value] of buckets)
      if (value.until < now) buckets.delete(id);
  next();
});
const handler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    next(error);
  }
};
function requestSignal(res) {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}
discussionRoutes.get("/config", (_req, res) =>
  res.json({
    textConfigured: !!(process.env.LLM_API_KEY && process.env.LLM_MODEL),
    voiceConfigured: !!process.env.ELEVENLABS_API_KEY,
    maxRecordingSeconds: 60,
  }),
);
discussionRoutes.get(
  "/voices",
  handler(async (_req, res) => res.json(await availableVoices())),
);
discussionRoutes.post(
  "/",
  handler(async (req, res) => {
    const body = z
      .object({
        snapshotId: z.string().max(150),
        componentId: z.string().max(200),
      })
      .strict()
      .parse(req.body);
    const row = db
      .prepare("SELECT graph_json FROM snapshots WHERE id=?")
      .get(body.snapshotId);
    if (!row) return res.status(404).json({ error: "Snapshot not found" });
    res
      .status(201)
      .json(startDiscussion(JSON.parse(row.graph_json), body.componentId));
  }),
);
discussionRoutes.get(
  "/:id",
  handler((req, res) => res.json(sessionView(discussion(req.params.id)))),
);
discussionRoutes.post(
  "/:id/messages",
  handler(async (req, res) => {
    const { question } = z
      .object({ question: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(req.body);
    res.json(await discussionTurn(req.params.id, question, requestSignal(res)));
  }),
);
discussionRoutes.get(
  "/:id/evidence/:referenceId",
  handler(async (req, res) =>
    res.json(
      await scopedEvidence(discussion(req.params.id), req.params.referenceId),
    ),
  ),
);
discussionRoutes.post(
  "/:id/draft",
  handler(async (req, res) => {
    const body = z
      .object({ chosenOption: z.string().trim().max(300).optional() })
      .strict()
      .parse(req.body);
    res.json(
      await draftDecision(req.params.id, body.chosenOption, requestSignal(res)),
    );
  }),
);
discussionRoutes.post(
  "/:id/decisions",
  express.json({ limit: "24kb" }),
  handler((req, res) => {
    const { draftId, content } = z
      .object({
        draftId: z.string().max(150),
        content: z.string().trim().min(1).max(20000),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(saveDecision(req.params.id, draftId, content));
  }),
);
discussionRoutes.post(
  "/:id/transcription",
  express.raw({ type: () => true, limit: "5mb" }),
  handler(async (req, res) => {
    discussion(req.params.id);
    res.json(
      await transcribe(
        req.body,
        req.headers["content-type"] || "",
        Number(req.headers["x-recording-duration"]),
        requestSignal(res),
      ),
    );
  }),
);
discussionRoutes.post(
  "/:id/speech",
  handler(async (req, res) => {
    const body = z
      .object({
        voiceId: z.string().max(150),
        messageId: z.string().max(150).optional(),
        preview: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    discussion(req.params.id);
    const message = body.messageId
      ? db
          .prepare(
            "SELECT data FROM discussion_messages WHERE id=? AND session_id=? AND role='assistant'",
          )
          .get(body.messageId, req.params.id)
      : null;
    if (!body.preview && !message)
      return res.status(404).json({ error: "Discussion answer not found" });
    const text = body.preview
      ? "Hello, I'm your Codebase Mentor. Let's explore this component together."
      : JSON.parse(message.data).answer.spokenText;
    const audio = await createSpeech(body.voiceId, text, requestSignal(res));
    res.type("audio/mpeg").send(audio);
  }),
);
