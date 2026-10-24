import { redactCredentials } from "./handoffSafety.js";

// Extracted syntax can support a factual fallback, but cannot answer design intent.
export function sourceQuestionGuidance(trace, event, journey, question) {
  const clean = (text) =>
    redactCredentials(text || "")
      .replace(/\s+/g, " ")
      .trim();
  const inputs = clean(event.inputs || "Declared inputs were not extracted.");
  const outputs = clean(
    event.outputs || "Return expressions were not extracted.",
  );
  const conditions = clean(event.condition || "No condition was extracted.");
  const connections = (event.connections || [])
    .map((connection) => {
      const target = journey.events.find(
        (item) => item.key === connection.target,
      );
      return target
        ? `${connection.type.replaceAll("_", " ")} → ${target.title}`
        : null;
    })
    .filter(Boolean)
    .slice(0, 6);
  const next =
    trace.events[trace.events.findIndex((item) => item.id === event.id) + 1];
  const connected = connections.length
    ? connections.join("; ")
    : next
      ? `Next linked component in this path: ${next.title}.`
      : "No next component is linked in this selected path.";
  const sections = {
    purpose: `${event.title} is the selected ${event.kind === "http_request" ? "HTTP entry point" : "source component"}. Its business purpose is not established by these extracted facts alone.`,
    inputsOutputs: `${inputs}\n${outputs}`,
    conditions,
    sideEffects: clean(
      event.sideEffects ||
        "Side effects are not established by the available evidence.",
    ),
    nextConnections: connected,
  };
  const query = question.toLowerCase();
  let facts;
  if (/validat|condition|branch|error|throw|fail|check|chang/.test(query))
    facts = `${conditions}\n\n${outputs}`;
  else if (/call|connect|depend|use|next|flow/.test(query))
    facts = `${connected}\n\n${inputs}`;
  else if (/input|param|argument|return|output|result/.test(query))
    facts = sections.inputsOutputs;
  else facts = `${inputs}\n\n${conditions}\n${outputs}`;
  const limitation =
    trace.mode === "observed_replay"
      ? "Only explicitly captured events establish runtime behavior; missing observations remain unknown."
      : "These are source facts; runtime values and branch outcomes have not been observed.";
  const intent = /\bwhy\b|trade.?off|design|reason/.test(query)
    ? "The source does not establish the author’s design reason. Here is the implementation evidence available."
    : `Here is what the saved code establishes about ${event.title}.`;
  return { answer: `${intent}\n\n${facts}\n\n${limitation}`, sections };
}
