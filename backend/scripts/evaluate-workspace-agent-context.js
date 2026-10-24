import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");
const task = process.argv.slice(2).join(" ").trim() || "Trace Agent Context Bridge retrieval, source evidence, and token budgeting";
const includedRoots = ["backend/src", "frontend/src"];
const includeFiles = ["backend/package.json", "frontend/package.json", "frontend/tsconfig.json"];
const extensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
function sourcePaths(relative, output = []) {
  const absolute = path.join(root, relative);
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) sourcePaths(child, output);
    else if (extensions.has(path.extname(entry.name))) output.push(child.replaceAll("\\", "/"));
  }
  return output;
}
const paths = [...new Set([...includeFiles, ...includedRoots.flatMap((directory) => sourcePaths(directory))])].sort();
const files = Object.fromEntries(paths.map((file) => [file, readFileSync(path.join(root, file), "utf8")]));
const digest = createHash("sha256");
for (const file of paths) digest.update(file).update("\0").update(files[file]).update("\0");
const repository = "local://current-workspace";
const commit = `working-tree:${digest.digest("hex")}`;

// Use the project's real analyzer and storage adapters, but isolate this measurement in SQLite memory.
process.env.DATABASE_PATH = ":memory:";
const [{ analyze }, { db, saveSnapshot }, bridge] = await Promise.all([
  import("../src/analyzer.js"),
  import("../src/storage.js"),
  import("../src/agentContextBridge.js"),
]);
const graph = analyze({ files, commit, repository });
saveSnapshot(graph, { snapshotId: graph.snapshotId }, "", files);

const tokenEstimate = (value) => Math.ceil(Buffer.byteLength(value, "utf8") / 3);
const uniqueSpans = (refs) => new Set(refs.map((ref) => `${ref.file}:${ref.startLine}:${ref.endLine}`)).size;
const serializeStarted = performance.now();
const unfiltered = JSON.stringify({ task, graph });
const baseline = {
  tokenEstimate: tokenEstimate(unfiltered),
  serializationLatencyMs: Math.round(performance.now() - serializeStarted),
  nodes: graph.components.length,
  edges: graph.relationships.length,
  excerpts: graph.references.length,
  duplicateExcerpts: graph.references.length - uniqueSpans(graph.references),
};
bridge.clearAgentContextCache();
const retrievalStarted = performance.now();
const context = bridge.getTaskContext(graph.snapshotId, task);
const retrievalLatencyMs = Math.round(performance.now() - retrievalStarted);
const refs = new Map(graph.references.map((ref) => [ref.id, ref]));
const selectedRefs = context.evidence.flatMap((item) => item.referenceIds).map((id) => refs.get(id)).filter(Boolean);
const terms = task.toLowerCase().match(/[\p{L}\p{N}_./-]{2,}/gu) || [];
const repeated = bridge.getTaskContext(graph.snapshotId, task);
console.log(JSON.stringify({
  identity: { repository, snapshotId: graph.snapshotId, sourceFingerprint: commit.slice("working-tree:".length) },
  task,
  analyzedFiles: paths.length,
  baselineUnfiltered: baseline,
  bridge: {
    tokenEstimate: context.tokenEstimate,
    nodes: context.nodes.length,
    edges: context.relationships.length,
    excerpts: context.evidence.length,
    duplicateEvidenceEliminated: selectedRefs.length - context.evidence.length,
    sourceReferenceIdsValid: context.evidence.every((item) => item.referenceIds.every((id) => refs.has(id))),
    lexicalNodeMatches: context.nodes.filter((node) => terms.some((term) => node.name.toLowerCase().includes(term))).length,
    retrievalLatencyMs,
    truncated: context.truncated,
    cacheHitOnRepeat: repeated.cache.hit,
  },
  estimator: "Both paths use UTF-8 bytes/3. LexicalNodeMatches is a reproducible overlap proxy, not a human relevance judgment. The source fingerprint identifies the current working tree; it is not a Git commit SHA.",
}, null, 2));
db.close();
