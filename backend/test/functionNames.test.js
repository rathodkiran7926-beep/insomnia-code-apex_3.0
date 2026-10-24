import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_PATH = ":memory:";
const { analyze } = await import("../src/analyzer.js");
const { functionLabelIndex } = await import("../src/functionNames.js");
const { componentNamePresentation } =
  await import("../src/componentPresentation.js");
const { db, saveSnapshot } = await import("../src/storage.js");
test("function labels retain declared names and recover variable, property and assignment bindings", () => {
  const source =
    "export function named(){};const assigned=()=>{};const options={save:()=>{},nested:{read:function(){}}};exports.run=()=>{};const typed=(()=>{}) as Function;";
  const labels = functionLabelIndex("functions.ts", source);
  for (const name of [
    "named",
    "assigned",
    "options.save",
    "options.nested.read",
    "exports.run",
    "typed",
  ])
    assert(
      labels.some((label) => label.name === name),
      name,
    );
  assert(labels.every((label) => !label.name.includes("anonymous:")));
});
test("inline route callbacks get source-confirmed handler and middleware labels", () => {
  const graph = analyze({
    repository: "https://github.com/test/names",
    commit: "a".repeat(40),
    files: {
      "routes.ts":
        "import express from 'express';const app=express();app.get('/health',(req,res,next)=>next(),(req,res)=>res.json({ok:true}));",
    },
  });
  assert(
    graph.components.some(
      (c) => c.name === "GET /health handler" && c.role === "handler",
    ),
  );
  assert(
    graph.components.some(
      (c) => c.name === "GET /health middleware 1" && c.role === "middleware",
    ),
  );
});
test("callbacks use their actual enclosing function and callee without inventing function declarations", () => {
  const labels = functionLabelIndex(
    "Account.tsx",
    "export function Account(){useEffect(()=>{items.map(item=>item.id)},[]);const click=useCallback(()=>{},[]);}",
  );
  assert(
    labels.some(
      (label) =>
        label.name === "Account / useEffect callback" &&
        label.nameKind === "callback_context",
    ),
  );
  assert(labels.some((label) => label.name === "click / useCallback callback"));
  assert(labels.some((label) => label.name.includes("items.map callback")));
});
test("unnamed default exports have source context and callback labels do not copy argument values", () => {
  const labels = functionLabelIndex(
    "worker.ts",
    "export default ()=>{};fetch('secret-value').then(()=>{});",
  );
  assert(labels.some((label) => label.name === "worker.ts default export"));
  assert(labels.every((label) => !label.name.includes("secret-value")));
});
function legacyFixture(repository, route) {
  const files = {
    "routes.ts":
      "import express from 'express';const app=express();app.get('" +
      route +
      "',(req,res)=>res.json({ok:true}));",
  };
  const graph = analyze({ repository, commit: "b".repeat(40), files });
  const component = graph.components.find((c) => c.role === "handler");
  const ref = graph.references.find((r) => r.id === component.referenceId);
  component.name = "anonymous:" + ref.startLine;
  delete component.nameKind;
  saveSnapshot(graph, { snapshotId: graph.snapshotId }, "", files);
  return { graph, component, ref };
}
test("old snapshots and replay events display meaningful names without changing saved evidence or IDs", () => {
  const { graph, component, ref } = legacyFixture(
    "https://github.com/test/old-labels",
    "/health",
  );
  const original = db
    .prepare("SELECT graph_json FROM snapshots WHERE id=?")
    .get(graph.snapshotId).graph_json;
  const response = {
    ...graph,
    journey: {
      id: "repo-" + graph.snapshotId + "-" + component.id,
      title: "Explore " + component.name,
      snapshotId: graph.snapshotId,
      sourceHash: "keep-hash",
      events: [
        {
          id: "saved-event",
          key: component.id,
          title: component.name,
          sourceRefId: ref.id,
          snapshotId: graph.snapshotId,
        },
      ],
      scenarios: [
        {
          id: "path-1",
          path: [component.id],
          label: "Connection 1: " + component.name,
        },
      ],
    },
  };
  const output = componentNamePresentation(db)(response);
  assert.equal(
    output.components.find((c) => c.id === component.id).name,
    "GET /health handler",
  );
  assert.equal(output.journey.events[0].title, "GET /health handler");
  assert.equal(output.journey.title, "Explore GET /health handler");
  assert.equal(
    output.journey.scenarios[0].label,
    "Connection 1: GET /health handler",
  );
  assert.equal(output.journey.sourceHash, "keep-hash");
  assert.equal(output.journey.events[0].id, "saved-event");
  assert.equal(
    response.components.find((c) => c.id === component.id).name,
    component.name,
  );
  assert.equal(
    db
      .prepare("SELECT graph_json FROM snapshots WHERE id=?")
      .get(graph.snapshotId).graph_json,
    original,
  );
});
test("legacy labels stay scoped to their repository snapshot", () => {
  const a = legacyFixture("https://github.com/test/a-label", "/one");
  const b = legacyFixture("https://github.com/test/b-label", "/two");
  const output = componentNamePresentation(db)({ items: [a.graph, b.graph] });
  assert.equal(
    output.items[0].components.find((c) => c.id === a.component.id).name,
    "GET /one handler",
  );
  assert.equal(
    output.items[1].components.find((c) => c.id === b.component.id).name,
    "GET /two handler",
  );
});

test("inline Express use callbacks retain middleware context without affecting mount analysis", () => {
  const graph = analyze({
    repository: "https://github.com/test/use-label",
    commit: "c",
    files: {
      "app.ts":
        "import express from 'express';const app=express();app.use('/api',(req,res,next)=>next());",
    },
  });
  assert(
    graph.components.some(
      (c) => c.role === "middleware" && c.name.includes(".use("),
    ),
  );
});
