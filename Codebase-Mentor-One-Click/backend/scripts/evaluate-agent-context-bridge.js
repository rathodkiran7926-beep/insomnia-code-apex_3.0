import { db } from "../src/storage.js";
import { clearAgentContextCache, getTaskContext } from "../src/agentContextBridge.js";

const [snapshotId, ...taskParts] = process.argv.slice(2);
const task = taskParts.join(" ").trim();
if (!snapshotId || !task) {
  console.error('Usage: node scripts/evaluate-agent-context-bridge.js <snapshot-id> "<task description>"');
  process.exit(2);
}
const stored = db.prepare("SELECT repository_id,commit_sha,graph_json FROM snapshots WHERE id=?").get(snapshotId);
if (!stored) { console.error("Snapshot not found"); process.exit(1); }
const graph = JSON.parse(stored.graph_json);
const tokenize = (value) => Math.ceil(Buffer.byteLength(value, "utf8") / 3);
const uniqueSpans = (refs) => new Set(refs.map((ref) => `${ref.file}:${ref.startLine}:${ref.endLine}`)).size;
const refs = graph.references || [];
const unfilteredStarted = performance.now();
const baselineJson = JSON.stringify(graph);
const baseline = {
  tokenEstimate: tokenize(baselineJson),
  serializationLatencyMs: Math.round(performance.now() - unfilteredStarted),
  nodes: graph.components?.length || 0,
  edges: graph.relationships?.length || 0,
  excerpts: refs.length,
  duplicateExcerpts: refs.length - uniqueSpans(refs),
};
clearAgentContextCache();
const started = performance.now();
const result = getTaskContext(snapshotId, task);
const elapsedMs = Math.round(performance.now() - started);
const references = new Map(refs.map((ref) => [ref.id, ref]));
const selectedRefs = result.evidence.flatMap((item) => item.referenceIds).map((id) => references.get(id)).filter(Boolean);
const terms = (task.toLowerCase().match(/[\p{L}\p{N}_./-]{2,}/gu) || []);
const relevantNodeCount = result.nodes.filter((node) => terms.some((term) => node.name.toLowerCase().includes(term))).length;
const bridgeSpanCount = uniqueSpans(result.evidence);
const cached = getTaskContext(snapshotId, task);
console.log(JSON.stringify({
  identity: { repository: stored.repository_id, snapshotId, commit: stored.commit_sha },
  query: task,
  baselineUnfiltered: baseline,
  bridge: {
    tokenEstimate: result.tokenEstimate,
    nodes: result.nodes.length,
    edges: result.relationships.length,
    excerpts: result.evidence.length,
    duplicateExcerpts: result.evidence.length - bridgeSpanCount,
    duplicateEvidenceEliminated: selectedRefs.length - result.evidence.length,
    snapshotReferenceIdsValid: result.evidence.every((item) => item.referenceIds.every((id) => references.has(id))),
    lexicalNodeMatches: relevantNodeCount,
    latencyMs: elapsedMs,
    truncated: result.truncated,
    cacheHitOnRepeat: cached.cache.hit,
  },
  note: "Token counts use the same conservative UTF-8 bytes/3 estimate. Relevance is a reproducible lexical overlap indicator, not a human relevance judgment.",
}, null, 2));
