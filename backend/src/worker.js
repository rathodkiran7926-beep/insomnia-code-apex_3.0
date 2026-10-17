import { parentPort, workerData } from "node:worker_threads";
import { downloadRepository } from "./github.js";
import { analyze } from "./analyzer.js";
import { documentGraph, markdown } from "./documentation.js";
try {
  const progress = (progress, message) =>
    parentPort.postMessage({ type: "progress", progress, message });
  progress(3, "Resolving public repository and revision");
  const input = await downloadRepository(
    workerData.url,
    workerData.revision,
    progress,
  );
  progress(60, "Parsing sources and resolving compiler symbols");
  const graph = analyze(input);
  progress(85, "Generating source-grounded documentation");
  const docs = await documentGraph(graph);
  parentPort.postMessage({
    type: "complete",
    graph,
    docs,
    files: input.files,
    markdown: markdown(graph, docs),
  });
} catch (error) {
  parentPort.postMessage({ type: "failed", message: error.message });
}
