import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { downloadRepository } from "../src/github.js";
import { analyze } from "../src/analyzer.js";
import { documentGraph, markdown } from "../src/documentation.js";
const input = await downloadRepository(
  "https://github.com/heroku/node-js-getting-started",
  "main",
  (p, message) => console.log(`${p}% ${message}`),
);
const graph = analyze(input);
const docs = await documentGraph(graph);
assert.match(graph.commit, /^[a-f0-9]{40}$/);
assert(graph.report.supported);
assert(graph.components.some((c) => c.role === "route"));
assert(graph.relationships.some((e) => e.type === "handles_route"));
assert.equal(docs.snapshotId, graph.snapshotId);
assert(
  graph.references.every(
    (r) =>
      r.url.includes(`/blob/${graph.commit}/`) &&
      r.startLine > 0 &&
      r.endLine >= r.startLine,
  ),
);
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../data/public-verification.json", import.meta.url),
  JSON.stringify(
    {
      repository: input.repository,
      commit: graph.commit,
      snapshotId: graph.snapshotId,
      components: graph.components.length,
      relationships: graph.relationships.length,
      routes: graph.components.filter((c) => c.role === "route").length,
      unresolved: graph.report.unresolved.length,
      exclusions: graph.report.exclusions.length,
    },
    null,
    2,
  ),
);
writeFileSync(
  new URL("../data/public-verification.md", import.meta.url),
  markdown(graph, docs),
);
console.log(
  JSON.stringify({
    commit: graph.commit,
    components: graph.components.length,
    routes: graph.components.filter((c) => c.role === "route").length,
    relationships: graph.relationships.length,
  }),
);
