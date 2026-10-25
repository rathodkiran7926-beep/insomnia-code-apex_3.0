import { llmConfig } from "./llmConfig.js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { db } from "./storage.js";
import { boundedFetch } from "./github.js";
import { setTimeout as retryDelay } from "node:timers/promises";
import { questionContext, readSource } from "./workspace.js";

db.exec(`CREATE TABLE IF NOT EXISTS discussions(id TEXT PRIMARY KEY,snapshot_id TEXT NOT NULL,component_id TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS discussion_messages(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,role TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS discussion_decisions(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,draft_id TEXT NOT NULL UNIQUE,content TEXT NOT NULL,created_at TEXT NOT NULL);`);
const baseInstruction = readFileSync(
  new URL("./discussion-system.txt", import.meta.url),
  "utf8",
);
const texts = z.array(z.string().max(600)).max(12);
const claim = z
  .object({
    text: z.string().max(800),
    evidenceIds: z.array(z.string()).min(1).max(6),
  })
  .strict();
const option = z
  .object({
    name: z.string().max(160),
    pros: texts,
    cons: texts,
    assumptions: texts,
  })
  .strict();
const memory = z
  .object({
    summary: z.string().max(2000),
    requirements: texts,
    rejectedAlternatives: texts,
    openQuestions: texts,
  })
  .strict();
const replySchema = z
  .object({
    spokenText: z.string().min(1).max(1200),
    displayText: z.string().min(1).max(6000),
    claims: z.array(claim).max(10),
    alternatives: z.array(option).max(3),
    followUpQuestion: z.string().max(400).nullable(),
    uncertainties: texts,
    memory,
  })
  .strict();
const replyJSONSchema = z.toJSONSchema(replySchema);
const decisionSchema = z
  .object({
    problem: z.string().max(2000),
    requirements: texts,
    currentImplementation: z.string().max(2000),
    options: z.array(option).max(3),
    reason: z.string().max(2000),
    risks: texts,
    verification: texts,
    evidenceIds: z.array(z.string()).min(1).max(12),
  })
  .strict();
export function validateReply(value, references) {
  const result = replySchema.parse(value),
    ids = new Set(references.map((r) => r.id));
  if (result.claims.some((c) => c.evidenceIds.some((id) => !ids.has(id))))
    throw new Error("Unknown source evidence");
  return result;
}
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export function discussion(id) {
  const row = db.prepare("SELECT * FROM discussions WHERE id=?").get(id);
  if (!row) throw fail("Discussion not found", 404);
  const graphRow = db
    .prepare("SELECT graph_json FROM snapshots WHERE id=?")
    .get(row.snapshot_id);
  if (!graphRow) throw fail("The discussion snapshot is unavailable", 404);
  return {
    id,
    snapshotId: row.snapshot_id,
    componentId: row.component_id,
    ...JSON.parse(row.data),
    graph: JSON.parse(graphRow.graph_json),
  };
}
function store(session) {
  const { id, graph, snapshotId, componentId, ...data } = session;
  db.prepare("UPDATE discussions SET data=? WHERE id=?").run(
    JSON.stringify(data),
    id,
  );
}
export function sessionView(session) {
  const messages = db
    .prepare(
      "SELECT id,role,data,created_at FROM discussion_messages WHERE session_id=? ORDER BY rowid",
    )
    .all(session.id)
    .map((r) => ({
      id: r.id,
      role: r.role,
      ...JSON.parse(r.data),
      createdAt: r.created_at,
    }));
  return {
    id: session.id,
    snapshotId: session.snapshotId,
    componentId: session.componentId,
    repository: session.graph.repository,
    commit: session.graph.commit,
    componentName: session.graph.components.find(
      (c) => c.id === session.componentId,
    )?.name,
    messages,
    draft: session.draft || null,
    savedDecisions: db
      .prepare(
        "SELECT id,draft_id AS draftId,content,created_at AS createdAt FROM discussion_decisions WHERE session_id=?",
      )
      .all(session.id),
  };
}
export function startDiscussion(graph, componentId) {
  const context = questionContext(graph, componentId);
  const id = randomUUID();
  db.prepare("INSERT INTO discussions VALUES (?,?,?,?)").run(
    id,
    graph.snapshotId,
    componentId,
    JSON.stringify({
      memory: {
        summary: "",
        requirements: [],
        rejectedAlternatives: [],
        openQuestions: [],
      },
      evidenceIds: [context.component.referenceId],
      draft: null,
    }),
  );
  return sessionView(discussion(id));
}
export async function discussionContext(session) {
  const graph = session.graph,
    context = questionContext(graph, session.componentId);
  const own = graph.references.find(
    (r) => r.id === context.component.referenceId,
  );
  let selected = context.selectedSource;
  let fileContext = { content: own.excerpt.slice(0, 12000), partial: true };
  try {
    const source = await readSource(graph, own.id);
    const text = source.excerpt
      .split("\n")
      .slice(own.startLine - 1, own.endLine)
      .join("\n");
    selected = {
      excerpt: text.slice(0, 16000),
      truncated: text.length > 16000,
      referenceId: own.id,
    };
    const around =
      source.excerpt.length <= 12000
        ? source.excerpt
        : source.excerpt
            .split("\n")
            .slice(Math.max(0, own.startLine - 81), own.endLine + 40)
            .join("\n");
    fileContext = {
      content: around.slice(0, 12000),
      partial: source.excerpt.length > 12000,
    };
  } catch {
    /* Saved evidence remains explicitly partial. */
  }
  const modules = graph.components.filter(
    (c) =>
      c.role === "module" &&
      graph.references.find((r) => r.id === c.referenceId)?.file === own.file,
  );
  const imports = graph.relationships
    .filter(
      (e) => e.type === "imports" && modules.some((m) => m.id === e.source),
    )
    .slice(0, 5);
  const tests = graph.references
    .filter(
      (r) =>
        /\.(test|spec)\.[cm]?[jt]sx?$|(?:^|\/)__tests__\//.test(r.file) &&
        r.file
          .split("/")
          .pop()
          ?.includes(own.file.split("/").pop()?.split(".")[0] || "___"),
    )
    .slice(0, 2);
  const ids = [
    own.id,
    ...modules.map((m) => m.referenceId),
    ...context.references.map((r) => r.id),
    ...context.connected.slice(0, 6).map((c) => c.referenceId),
    ...imports.map((e) => e.referenceId),
    ...tests.map((r) => r.id),
  ];
  const references = [...new Set(ids)]
    .slice(0, 28)
    .map((id) =>
      graph.references.find(
        (r) => r.id === id && r.snapshotId === graph.snapshotId,
      ),
    )
    .filter(Boolean)
    .map((r) => ({ ...r, excerpt: r.excerpt.slice(0, 1000) }));
  const configs = db
    .prepare("SELECT path,content FROM source_files WHERE snapshot_id=?")
    .all(graph.snapshotId)
    .filter((f) => /(?:^|\/)(?:package|tsconfig)\.json$/.test(f.path))
    .slice(0, 3)
    .map((f) => ({
      file: f.path,
      content: f.content.slice(0, 1400),
      kind: "configuration data; no test execution established",
    }));
  return {
    repository: graph.repository,
    snapshotId: graph.snapshotId,
    commit: graph.commit,
    component: context.component,
    selectedSource: selected,
    containingFileContext: fileContext,
    relationships: context.relationships.slice(0, 24),
    connected: context.connected.slice(0, 8),
    imports,
    references,
    configs,
    limitations: graph.report.limitations.slice(0, 6),
    unresolved: graph.report.unresolved
      .filter((u) => references.some((r) => r.id === u.referenceId))
      .slice(0, 8),
    testEvidence: tests.map((t) => t.id),
    contextLimited: context.relationships.length > 24 || selected.truncated,
  };
}
export async function scopedEvidence(session, referenceId) {
  const context = await discussionContext(session);
  const reference = context.references.find((r) => r.id === referenceId);
  if (!reference)
    throw fail("Evidence is outside this component discussion", 403);
  const source = await readSource(session.graph, referenceId);
  return {
    ...reference,
    excerpt: source.excerpt
      .split("\n")
      .slice(reference.startLine - 1, reference.endLine)
      .join("\n")
      .slice(0, 12000),
  };
}
// Local OpenAI-compatible servers may fail grammar compilation on length/item
// constraints generated by Zod. Enforce those limits here after generation;
// constrain the wire shape and citation choices at the provider.
function generationSchema(value) {
  if (Array.isArray(value)) return value.map(generationSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          ![
            "$schema",
            "minLength",
            "maxLength",
            "minItems",
            "maxItems",
          ].includes(key),
      )
      .map(([key, item]) => [key, generationSchema(item)]),
  );
}
function parseModelReply(raw) {
  const envelope = JSON.parse(raw);
  const choice = envelope.choices?.[0];
  if (choice?.finish_reason === "length") {
    const error = new SyntaxError("Model reply was truncated");
    error.validationCode = "truncated_reply";
    throw error;
  }
  const content = choice?.message?.content;
  if (typeof content !== "string")
    throw new SyntaxError("Model did not return a JSON text reply");
  // Accept a single fenced JSON document, never extract arbitrary fragments
  // from prose or replace missing / unknown evidence IDs.
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(content.trim());
  return JSON.parse(fenced ? fenced[1].trim() : content.trim());
}
async function reason(messages, signal, schema) {
  if (!llmConfig().apiKey)
    throw fail(
      "Text discussion requires LLM_API_KEY and LLM_MODEL in backend/.env.",
      503,
    );
  try {
    let raw;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        raw = await boundedFetch(llmConfig().endpoint, {
          method: "POST",
          signal,
          limit: 64000,
          headers: {
            Authorization: `Bearer ${llmConfig().apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: llmConfig().model,
            temperature: 0,
            max_tokens: 4096,
            ...(process.env.LLM_JSON_MODE === "0"
              ? {}
              : {
                  response_format:
                    schema && process.env.LLM_JSON_MODE !== "json_object"
                      ? {
                          type: "json_schema",
                          json_schema: {
                            name: "component_discussion",
                            strict: true,
                            schema: generationSchema(schema),
                          },
                        }
                      : { type: "json_object" },
                }),
            messages,
          }),
        });
        break;
      } catch (error) {
        if (
          attempt ||
          signal?.aborted ||
          ![500, 502, 503, 504].includes(error.remoteStatus)
        )
          throw error;
        await retryDelay(800, undefined, { signal });
      }
    }
    return parseModelReply(raw);
  } catch (error) {
    if (signal?.aborted) throw fail("Discussion request cancelled", 499);
    if (error instanceof SyntaxError) throw error;
    const message = [500, 502, 503, 504].includes(error.remoteStatus)
      ? `AI provider is temporarily unavailable (HTTP ${error.remoteStatus}) after an automatic retry. Your question has not been answered; retry shortly.`
      : error.remoteStatus === 429
        ? "AI provider rate limit or quota reached. Wait and retry, or check your provider quota."
        : error.remoteStatus === 401
          ? "AI provider rejected LLM_API_KEY (HTTP 401). Obtain a replacement key from your configured endpoint administrator, update backend/.env, and restart the backend. Run npm.cmd run check:llm in backend to verify it."
          : error.remoteStatus === 403
            ? "AI provider denied access (HTTP 403). Check the endpoint's API restrictions, model permissions, and server access policy. Run npm.cmd run check:llm in backend for the provider's details."
            : ["EACCES", "EPERM"].includes(error.code)
              ? "Network access to AI provider was blocked. Restart the backend from a normal terminal and check firewall or proxy settings."
              : "AI provider could not answer. Check your configured model, credentials, quota, or network and retry.";
    throw Object.assign(fail(message, 502), { cause: error });
  }
}
const busy = new Set();
export async function discussionTurn(id, question, signal) {
  if (!llmConfig().apiKey)
    throw fail(
      "Text discussion requires LLM_API_KEY and LLM_MODEL in backend/.env.",
      503,
    );
  const session = discussion(id);
  if (busy.has(id)) throw fail("A discussion turn is already running", 409);
  if (busy.size >= 3) throw fail("The mentor is busy. Retry shortly.", 429);
  const count = db
    .prepare("SELECT count(*) AS n FROM discussion_messages WHERE session_id=?")
    .get(id).n;
  if (count >= 200)
    throw fail(
      "This discussion reached its 100-turn limit. Start a new discussion.",
      429,
    );
  busy.add(id);
  try {
    const context = await discussionContext(session);
    const history = db
      .prepare(
        "SELECT role,data FROM discussion_messages WHERE session_id=? ORDER BY rowid DESC LIMIT 12",
      )
      .all(id)
      .reverse()
      .map((r) => ({
        role: r.role,
        content:
          r.role === "user"
            ? JSON.parse(r.data).text
            : JSON.stringify(JSON.parse(r.data).answer),
      }));
    const schema = structuredClone(replyJSONSchema);
    schema.properties.claims.items.properties.evidenceIds.items.enum =
      context.references.map((reference) => reference.id);
    const format =
      "Return exactly one JSON object matching this schema, without Markdown fences or extra fields: " +
      JSON.stringify(schema) +
      " All required fields must be present. spokenText and displayText are nonempty strings. Every source claim needs at least one evidence ID copied exactly from allowedEvidenceIds; do not use file paths, component names or invented IDs. For general advice without source claims, claims may be an empty array. alternatives, uncertainties and memory list fields must be arrays, not strings or objects. followUpQuestion must be a string or null. General engineering alternatives are not source facts. Use at most three options; ask one requirements question before a recommendation when requirements are unknown. Maintain a concise rolling summary including explicit requirements, rejections, and unresolved questions. Never infer that the developer selected an option.";
    const messages = [
      {
        role: "system",
        content:
          baseInstruction +
          "\n" +
          format +
          "\nA periodically reset request counter is not automatically a classic token bucket. Process-memory counters are not evidence of a global multi-instance quota. Ask about burst allowance, identity scope, deployment topology, fairness, consistency and infrastructure when relevant to a rate-limiter recommendation.",
      },
      {
        role: "user",
        content: JSON.stringify({
          untrustedEvidence: context,
          allowedEvidenceIds: context.references.map(
            (reference) => reference.id,
          ),
          rollingMemory: session.memory,
        }),
      },
      ...history,
      { role: "user", content: question },
    ];
    let answer, candidate;
    try {
      try {
        candidate = await reason(messages, signal, schema);
        answer = validateReply(candidate, context.references);
      } catch (validationError) {
        if (validationError.status) throw validationError;
        if (signal?.aborted) throw fail("Discussion request cancelled", 499);
        // Regenerate once from the same pinned evidence. Never invent or replace citation IDs.
        const issues = validationError.issues?.slice(0, 12).map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
          message: issue.message,
        })) || [
          validationError instanceof SyntaxError
            ? {
                path: "response",
                code: validationError.validationCode || "invalid_json",
              }
            : { path: "claims.evidenceIds", code: "unknown_source_reference" },
        ];
        answer = validateReply(
          await reason(
            [
              ...messages.slice(0, -1),
              {
                role: "user",
                content: JSON.stringify({
                  question,
                  request:
                    "Answer this question again. The prior response failed validation; obey the exact schema and cite only allowedEvidenceIds. Do not repeat an invalid response or invent missing evidence.",
                  validationIssues: issues,
                  // The model can repair the actual rejected shape. This is
                  // untrusted provider output, not a saved assistant message.
                  rejectedReply: candidate
                    ? JSON.stringify(candidate).slice(0, 16000)
                    : null,
                  allowedEvidenceIds: context.references.map(
                    (reference) => reference.id,
                  ),
                }),
              },
            ],
            signal,
            schema,
          ),
          context.references,
        );
      }
    } catch (error) {
      if (error.status) throw error;
      throw fail(
        "The model could not return a valid source-linked reply after an automatic retry. Your question was not saved; please try again.",
        502,
      );
    }
    if (signal?.aborted) throw fail("Discussion request cancelled", 499);
    const evidenceIds = [
      ...new Set(answer.claims.flatMap((c) => c.evidenceIds)),
    ];
    const citations = context.references
      .filter((r) => evidenceIds.includes(r.id))
      .map(({ excerpt, ...r }) => r);
    const { memory: nextMemory, ...publicAnswer } = answer;
    const messageId = randomUUID(),
      now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO discussion_messages VALUES (?,?,?,?,?)").run(
        randomUUID(),
        id,
        "user",
        JSON.stringify({ text: question }),
        now,
      );
      db.prepare("INSERT INTO discussion_messages VALUES (?,?,?,?,?)").run(
        messageId,
        id,
        "assistant",
        JSON.stringify({ answer: { ...publicAnswer, citations } }),
        now,
      );
      session.memory = {
        ...nextMemory,
        requirements: [
          ...new Set([
            ...session.memory.requirements,
            ...nextMemory.requirements,
          ]),
        ].slice(-12),
        rejectedAlternatives: [
          ...new Set([
            ...session.memory.rejectedAlternatives,
            ...nextMemory.rejectedAlternatives,
          ]),
        ].slice(-12),
      };
      session.evidenceIds = [
        ...new Set([...session.evidenceIds, ...evidenceIds]),
      ].slice(-80);
      store(session);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return {
      id: messageId,
      answer: { ...publicAnswer, citations },
      snapshotId: session.snapshotId,
      componentId: session.componentId,
    };
  } finally {
    busy.delete(id);
  }
}
export async function draftDecision(id, chosenOption, signal) {
  if (!llmConfig().apiKey)
    throw fail(
      "Text discussion requires LLM_API_KEY and LLM_MODEL in backend/.env.",
      503,
    );
  const session = discussion(id);
  if (busy.has(id)) throw fail("Wait for the current discussion turn.", 409);
  if (busy.size >= 3) throw fail("The mentor is busy. Retry shortly.", 429);
  busy.add(id);
  try {
    const context = await discussionContext(session);
    const history = db
      .prepare(
        "SELECT role,data FROM discussion_messages WHERE session_id=? ORDER BY rowid DESC LIMIT 8",
      )
      .all(id)
      .reverse();
    if (!history.length)
      throw fail("Discuss the component before drafting a decision.");
    const result = decisionSchema.parse(
      await reason(
        [
          {
            role: "system",
            content:
              baseInstruction +
              "\nDraft a NEW discussion decision, never historical maintainer intent. Return JSON {problem,requirements:[],currentImplementation,options:[{name,pros:[],cons:[],assumptions:[]}],reason,risks:[],verification:[],evidenceIds:[]}. Cite only supplied evidence. The chosen option, if any, is supplied explicitly by the user.",
          },
          {
            role: "user",
            content: JSON.stringify({
              untrustedEvidence: context,
              memory: session.memory,
              history,
              explicitUserChoice: chosenOption || null,
            }),
          },
        ],
        signal,
      ),
    );
    if (
      result.evidenceIds.some(
        (id) => !context.references.some((r) => r.id === id),
      )
    )
      throw new Error("Unknown source evidence");
    const citations = context.references
      .filter((r) => result.evidenceIds.includes(r.id))
      .map(({ excerpt, ...r }) => r);
    const content = [
      `# Decision discussion: ${context.component.name}`,
      `Commit: ${context.commit}`,
      "New developer discussion; not historical maintainer intent.",
      "\n## Problem",
      result.problem,
      "\n## Requirements",
      ...result.requirements.map((r) => "- " + r),
      "\n## Current implementation",
      result.currentImplementation,
      "\n## Options",
      ...result.options.flatMap((o) => [
        o.name,
        "Pros: " + o.pros.join("; "),
        "Cons: " + o.cons.join("; "),
        "Assumptions: " + o.assumptions.join("; "),
      ]),
      "\n## Chosen option",
      chosenOption || "Decision pending.",
      "\n## Reason",
      chosenOption ? result.reason : "No option has been explicitly chosen.",
      "\n## Risks",
      ...result.risks.map((r) => "- " + r),
      "\n## Verification",
      ...result.verification.map((r) => "- " + r),
      "\n## Supporting source",
      ...citations.map((r) => `${r.file}:${r.startLine}-${r.endLine} ${r.url}`),
    ].join("\n");
    session.draft = {
      id: randomUUID(),
      content,
      citations,
      createdAt: new Date().toISOString(),
      chosenOption: chosenOption || null,
    };
    if (signal?.aborted) throw fail("Request cancelled", 499);
    store(session);
    return session.draft;
  } catch (error) {
    if (error.status) throw error;
    throw fail(
      "AI provider returned an invalid decision draft. Please retry.",
      502,
    );
  } finally {
    busy.delete(id);
  }
}
export function saveDecision(id, draftId, content) {
  const session = discussion(id);
  if (session.draft?.id !== draftId)
    throw fail("Draft does not belong to this discussion", 409);
  const existing = db
    .prepare("SELECT id FROM discussion_decisions WHERE draft_id=?")
    .get(draftId);
  if (existing) {
    db.prepare(
      "UPDATE discussion_decisions SET content=? WHERE id=? AND session_id=?",
    ).run(content, existing.id, id);
    return existing;
  }
  const decisionId = randomUUID();
  db.prepare("INSERT INTO discussion_decisions VALUES (?,?,?,?,?)").run(
    decisionId,
    id,
    draftId,
    content,
    new Date().toISOString(),
  );
  return { id: decisionId };
}
