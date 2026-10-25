import { answerEventQuestion, savedJourney } from "./journeyService.js";
import { containsCredential, redactCredentials } from "./handoffSafety.js";
import { db } from "./journeyStorage.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  sourceWalkthrough,
  walkthroughEvidence,
} from "./journeyWalkthrough.js";

const successSchema = z.object({
  sentences: z.array(z.string().trim().min(1).max(280)).length(3),
  steps: z.array(z.object({
    title: z.string().trim().min(1).max(80), explanation: z.string().trim().min(1).max(600),
    sourceRefId: z.string().min(1).max(500),
  }).strict()).min(3).max(7),
  sourceReferences: z.array(z.object({
    sourceRefId: z.string().min(1).max(500), title: z.string().min(1).max(500),
    file: z.string().min(1).max(1000), startLine: z.number().int().positive(), endLine: z.number().int().positive(),
  }).passthrough()).min(1).max(4),
  generated: z.literal(true), notice: z.literal(""),
  expression: z.enum(["explaining", "thinking", "questioning", "encouraging"]).optional(),
}).strict();

function artifactContext(trace, event, level, index) {
  const journey = savedJourney(trace.snapshotId, trace.journeyId);
  if (!journey || journey.sourceHash !== trace.sourceHash || index < 0 || trace.events[index].key !== event.key)
    return null;
  const selected = journey.events.find((item) => item.key === event.key && item.sourceRefId === event.sourceRefId);
  const sourceFacts = (item) => [item.key, item.title, item.kind, item.sourceRefId, item.source,
    item.sourceExcerpt, item.inputs, item.outputs, item.condition, item.connections, item.explanations];
  if (!selected || JSON.stringify(sourceFacts(selected)) !== JSON.stringify(sourceFacts(event))) return null;
  let observed;
  if (trace.mode === "observed_replay") {
    // HTTP callers have already passed traceFor(owner). Bind private artifacts
    // to the immutable recorded trace as well as its ID, never another learner.
    observed = db.prepare("SELECT data FROM runtime_traces WHERE id=? AND snapshot_id=?").get(trace.id, trace.snapshotId)?.data;
    if (!observed) return null;
  }
  const evidence = walkthroughEvidence(journey, selected);
  const references = evidence.map((item) => ({ sourceRefId: item.sourceRefId, title: item.title, ...item.source }));
  const neighbor = (item) => item && [item.key, item.title, item.sourceRefId, item.source];
  const key = createHash("sha256").update(JSON.stringify([
    "walkthrough-v3:prompt-v1:schema-v1:evidence-v1", trace.snapshotId, trace.sourceHash,
    trace.journeyId, event.key, event.sourceRefId, level, trace.mode,
    neighbor(trace.events[index - 1]), neighbor(trace.events[index + 1]), trace.coverage,
    trace.mode === "observed_replay" ? [trace.id, observed] : null,
    journey.source, evidence,
  ])).digest("hex");
  return { key, references };
}

function validSuccess(value, context) {
  if (!context || !successSchema.safeParse(value).success ||
    JSON.stringify(value.sourceReferences) !== JSON.stringify(context.references)) return false;
  const ids = new Set(context.references.map((ref) => ref.sourceRefId));
  const text = [...value.sentences, ...value.steps.flatMap((step) => [step.title, step.explanation])];
  return value.steps.every((step) => ids.has(step.sourceRefId)) &&
    text.every((item) => !containsCredential(item) && !/https?:\/\//i.test(item));
}

function readArtifact(context) {
  if (!context) return null;
  const row = db.prepare("SELECT data FROM journey_explanation_artifacts WHERE cache_key=?").get(context.key);
  if (!row) return null;
  try {
    const saved = JSON.parse(row.data);
    return saved.key === context.key && validSuccess(saved.value, context) ? saved.value : null;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return null;
    throw error;
  }
}

function saveArtifact(context, value) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT OR REPLACE INTO journey_explanation_artifacts VALUES (?,?,?)")
      .run(context.key, JSON.stringify({ key: context.key, value }), Date.now());
    // Bound only this derived cache; source, traces and progress are untouched.
    db.exec("DELETE FROM journey_explanation_artifacts WHERE cache_key IN (SELECT cache_key FROM journey_explanation_artifacts ORDER BY created_at DESC,rowid DESC LIMIT -1 OFFSET 200)");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function sourceSentences(trace, event, index) {
  const concise = (value) =>
    redactCredentials(value || "")
      .replace(/\s+/g, " ")
      .slice(0, 210);
  const parameters = event.inputs?.match(
    /^Declared parameters: (.*?)\. Runtime values:/,
  )?.[1];
  const returns = event.outputs?.match(
    /^Source return expressions: (.*?)\. Runtime result:/,
  )?.[1];
  const condition = event.condition?.startsWith(
    "Source conditions (not evaluated): ",
  )
    ? event.condition.slice("Source conditions (not evaluated): ".length)
    : null;
  const next = trace.events[index + 1];
  const connection =
    next && event.connections?.find((item) => item.target === next.key);
  return [
    event.kind === "http_request"
      ? `${event.title} defines an HTTP entry point in the saved source.`
      : parameters
        ? `${event.title} declares these inputs: ${concise(parameters)}.`
        : `${event.title} is the selected source operation; its input contract is not established by the available evidence.`,
    condition
      ? `The code checks ${concise(condition)}; the result of this condition is unknown until execution.`
      : returns
        ? `The code contains this return expression: ${concise(returns)}; its runtime value is unknown.`
        : event.kind === "http_request" && connection?.type === "handles_route"
          ? `The route registration connects this endpoint to ${next.title}, its source-linked request handler.`
          : "No detailed condition or return expression was extracted for this step; inspect the highlighted source for its implementation.",
    next
      ? trace.mode === "observed_replay"
        ? `The captured scenario records ${next.title} as the next available event; missing execution spans remain unknown.`
        : connection?.type === "calls"
          ? `Its source contains a resolved call to ${next.title}, the next component in this possible path; this does not prove execution order.`
          : `The selected source path continues to ${next.title}; runtime execution order is not observed.`
      : "This is the last linked component in the selected path; playback completion does not establish the runtime outcome.",
  ];
}

export function createExplanationCache(generate = answerEventQuestion) {
  const cache = new Map(),
    pending = new Map();
  return async function explain(trace, event, level = "beginner") {
    const index = trace.events.findIndex((e) => e.id === event.id);
    const artifact = artifactContext(trace, event, level, index);
    const key = JSON.stringify([
      "walkthrough-v2",
      trace.snapshotId,
      event.key,
      trace.sourceHash,
      level,
      trace.mode,
      trace.events[index - 1]?.key,
      trace.events[index + 1]?.key,
      trace.mode === "observed_replay" ? trace.id : null,
      artifact?.key,
    ]);
    const cached = cache.get(key);
    // Rebind the same component explanation to the requesting event/trace.
    const anchor = {
      eventId: event.id,
      traceId: trace.id,
      snapshotId: trace.snapshotId,
      sourceRefId: event.sourceRefId,
      sourceHash: trace.sourceHash,
      componentId: event.key,
    };
    if (cached && cached.expires > Date.now() && (!cached.validated || validSuccess(cached.value, artifact)))
      return { ...cached.value, ...anchor };
    const persisted = readArtifact(artifact);
    if (persisted) {
      if (cache.size >= 200) cache.delete(cache.keys().next().value);
      cache.set(key, { value: persisted, expires: Date.now() + 3600000, validated: true });
      return { ...persisted, ...anchor };
    }
    if (pending.has(key)) return { ...(await pending.get(key)), ...anchor };
    if (pending.size >= 3)
      throw Object.assign(
        new Error("The explanation is busy. Retry shortly."),
        { status: 429 },
      );
    const task = (async () => {
      const result = await generate(
        trace,
        event,
        "Explain this component in detail using the supplied source and linked request handler. Include the three-sentence overview plus 3 to 7 distinct walkthrough steps for actual inputs, validation, calls, return/response and error paths where evidence exists. Explain code behavior instead of repeating the path arrows. Do not invent missing behavior.",
        level,
        { brief: true, walkthrough: true },
      );
      const value = {
        sentences: result.sentences || sourceSentences(trace, event, index),
        steps:
          result.steps ||
          sourceWalkthrough(trace, event, { events: trace.events }),
        sourceReferences:
          result.sourceReferences ||
          walkthroughEvidence({ events: trace.events }, event).map((item) => ({
            sourceRefId: item.sourceRefId,
            title: item.title,
            ...item.source,
          })),
        generated: result.generated,
        expression: result.expression,
        notice: result.generated
          ? ""
          : "A generated explanation is unavailable; showing source context.",
      };
      // Never promote a source fallback composed above into an AI artifact.
      const validated = Boolean(result.sentences && result.steps && result.sourceReferences && validSuccess(value, artifact));
      if (validated) {
        try { saveArtifact(artifact, value); }
        catch {
          // Persistence is optional: keep the validated answer and memory cache
          // usable when SQLite cannot write this derived artifact.
        }
      }
      if (cache.size >= 200) cache.delete(cache.keys().next().value);
      cache.set(key, {
        value,
        expires: Date.now() + (result.generated ? 3600000 : 20000),
        validated,
      });
      return value;
    })();
    pending.set(key, task);
    try {
      return { ...(await task), ...anchor };
    } finally {
      pending.delete(key);
    }
  };
}
export const explainJourneyEvent = createExplanationCache();
