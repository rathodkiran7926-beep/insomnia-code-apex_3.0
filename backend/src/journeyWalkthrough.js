import { redactCredentials } from "./handoffSafety.js";

export function walkthroughEvidence(journey, event) {
  const handlerIds = new Set(
    (event.connections || [])
      .filter((edge) => edge.type === "handles_route")
      .map((edge) => edge.target),
  );
  return [
    event,
    ...journey.events.filter((candidate) => handlerIds.has(candidate.key)),
  ].slice(0, 4);
}

export function sourceWalkthrough(trace, event, journey) {
  const clean = (text) => {
    const value = redactCredentials(text || "")
      .replace(/\s+/g, " ")
      .trim();
    return value.length > 450 ? value.slice(0, 447) + "…" : value;
  };
  const evidence = walkthroughEvidence(journey, event);
  const operation = evidence[1] || event;
  const steps = [];
  const add = (title, explanation, source = operation) =>
    steps.push({ title, explanation, sourceRefId: source.sourceRefId });
  add(
    event.kind === "http_request"
      ? "Request entry point"
      : "Selected operation",
    event.kind === "http_request"
      ? `${event.title} defines this HTTP entry point in the saved source.`
      : `This step explores ${event.title} and the operations extracted from its source.`,
    event,
  );
  if (operation !== event)
    add(
      "Request handler",
      `The route is connected to ${operation.title}, its resolved request handler; the following details describe that handler's code.`,
    );
  const inputs = operation.inputs?.match(
    /^Declared parameters: (.*?)\. Runtime values:/,
  )?.[1];
  if (inputs)
    add(
      "Declared inputs",
      `${operation.title} declares ${clean(inputs)} as parameters; these names describe its input interface, not captured runtime values.`,
    );
  if (operation.condition?.startsWith("Source conditions (not evaluated): "))
    add(
      "Validation and decisions",
      `Conditions extracted from ${operation.title}: ${clean(operation.condition.slice("Source conditions (not evaluated): ".length))}; their outcomes have not been evaluated here.`,
    );
  const calls = (operation.connections || [])
    .filter((edge) => edge.type === "calls")
    .map(
      (edge) =>
        journey.events.find((candidate) => candidate.key === edge.target)
          ?.title,
    )
    .filter(Boolean);
  if (calls.length)
    add(
      "Calls and delegation",
      `The source contains resolved calls to ${clean([...new Set(calls)].slice(0, 5).join(", "))}; listing these calls does not establish their runtime order or success.`,
    );
  const returns = operation.outputs?.match(
    /^Source return expressions: (.*?)\. Runtime result:/,
  )?.[1];
  if (returns)
    add(
      "Return or response",
      `Return expressions found in ${operation.title}: ${clean(returns)}; actual returned data and response status are not execution-verified.`,
    );
  if (steps.length < 3)
    add(
      "Available source evidence",
      `${clean(operation.inputs || "Inputs were not extracted.")} ${clean(operation.outputs || "Returns were not extracted.")}`,
    );
  add(
    "Evidence boundary",
    trace.mode === "observed_replay"
      ? "Only explicitly captured events establish runtime behavior; missing spans and uncaptured values remain unknown."
      : "This walkthrough follows saved source connections; it is not a captured request, and branch outcomes, side effects and runtime values remain unverified.",
    event,
  );
  return steps.slice(0, 7);
}
