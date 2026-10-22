import { parentPort, workerData } from "node:worker_threads";
import { fetchPullRequest } from "./prGithub.js";
import { downloadRepository } from "./github.js";
import { analyze } from "./analyzer.js";
import { documentGraph, markdown } from "./documentation.js";
import { compareEvidence } from "./prComparison.js";
try {
  const progress = (progress, message) =>
    parentPort.postMessage({ type: "progress", progress, message });
  progress(3, "Reading PR and pinning comparison commits");
  const pr = await fetchPullRequest(workerData.url);
  const snapshots = [];
  for (const [index, side] of ["before", "after"].entries()) {
    const input = await downloadRepository(
      side === "before" ? pr.baseRepository : pr.headRepository,
      side === "before" ? pr.baseCommit : pr.headCommit,
      (p, m) =>
        progress(10 + index * 40 + Math.round(p * 0.35), `${side}: ${m}`),
    );
    if (input.commit !== (side === "before" ? pr.baseCommit : pr.headCommit))
      throw new Error("Resolved commit does not match pinned PR evidence.");
    const graph = analyze(input);
    const docs = await documentGraph(graph, { generateAI: false });
    snapshots.push({
      graph,
      files: input.files,
      docs,
      markdown: markdown(graph, docs),
    });
  }
  progress(
    94,
    "Comparing components, connections, manifests and setup evidence",
  );
  parentPort.postMessage({
    type: "complete",
    result: compareEvidence(pr, ...snapshots),
    snapshots,
  });
} catch (error) {
  parentPort.postMessage({ type: "failed", message: error.message });
}
