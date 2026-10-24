import { answerEventQuestion } from "./journeyService.js";
import { redactCredentials } from "./handoffSafety.js";
import {
  sourceWalkthrough,
  walkthroughEvidence,
} from "./journeyWalkthrough.js";

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
    if (cached && cached.expires > Date.now())
      return { ...cached.value, ...anchor };
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
      if (cache.size >= 200) cache.delete(cache.keys().next().value);
      cache.set(key, {
        value,
        expires: Date.now() + (result.generated ? 3600000 : 20000),
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
