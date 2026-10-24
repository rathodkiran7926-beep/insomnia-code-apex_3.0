import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/analyzer.js";
import {
  documentGraph,
  markdown,
  validateExplanations,
} from "../src/documentation.js";
import { boundedFetch, parseRepository } from "../src/github.js";

test("network permission errors explain how to restart the backend", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed", { cause: { code: "EACCES" } });
  };
  try {
    await assert.rejects(
      boundedFetch("https://api.github.com/repos/example/api"),
      (error) =>
        error.message.includes("normal terminal") &&
        error.message.includes("A GitHub token cannot fix"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const files = {
  "package.json": '{"dependencies":{"express":"5"}}',
  "app.ts": `import express from 'express';
import { router as api } from './routes';
const app = express();
app.use('/api', api);`,
  "routes.ts": `import express from 'express';
import { handle as renamedHandler } from './barrel';
export const router = express.Router();
router.get('/users', renamedHandler);
router.get(dynamicPath, renamedHandler);`,
  "barrel.ts": `export { handle } from './handler';`,
  "handler.ts": `import { lookup as aliasedLookup } from './service';
export function handle(req, res) {
  const result = aliasedLookup(req.id);
  dynamic[req.action]();
  res.json(result);
}`,
  "service.ts": `export function lookup(id: string) { if (!id) throw new Error('id'); return id; }`,
  "unrelated.ts": `export function lookup() { return 'unrelated'; }`,
};
const input = {
  repository: "https://github.com/example/api",
  commit: "a".repeat(40),
  files,
};
test("maps literal routes, aliases, re-exports, mounts and source lines without name matching", () => {
  const g = analyze(input);
  assert.equal(g.report.supported, true);
  const route = g.components.find((c) => c.role === "route");
  const handler = g.components.find((c) => c.name === "handle");
  const lookup = g.components.filter((c) => c.name === "lookup");
  assert.deepEqual(route.fullPaths, ["/api/users"]);
  assert(
    g.relationships.some(
      (e) =>
        e.type === "handles_route" &&
        e.source === route.id &&
        e.target === handler.id,
    ),
  );
  assert.equal(
    g.relationships.filter(
      (e) =>
        e.type === "calls" &&
        e.source === handler.id &&
        lookup.some((c) => c.id === e.target),
    ).length,
    1,
  );
  const call = g.relationships.find(
    (e) =>
      e.type === "calls" &&
      e.source === handler.id &&
      lookup.some((c) => c.id === e.target),
  );
  const target = g.components.find((c) => c.id === call.target);
  assert.equal(
    g.references.find((r) => r.id === target.referenceId).file,
    "service.ts",
  );
  assert.equal(target.inferred, true);
  const ref = g.references.find((r) => r.id === call.referenceId);
  assert.equal(ref.startLine, 3);
  assert.equal(ref.endLine, 3);
  assert.equal(
    ref.url,
    `${input.repository}/blob/${input.commit}/handler.ts#L3-L3`,
  );
  assert(g.report.unresolved.some((u) => u.text === "dynamic[req.action]"));
  assert(g.report.unresolved.some((u) => u.reason === "Dynamic route path"));
  assert(
    g.relationships.every((e) =>
      g.references.some(
        (r) => r.id === e.referenceId && r.snapshotId === g.snapshotId,
      ),
    ),
  );
});
test("dependency names alone do not establish Express support", () => {
  assert.equal(
    analyze({
      ...input,
      files: {
        "package.json": files["package.json"],
        "index.js": "export const x = 1;",
      },
    }).report.supported,
    false,
  );
});
test("CommonJS Express construction and inline handlers are supported", () => {
  const g = analyze({
    ...input,
    files: {
      "app.js": `const express = require('express'); const app = express(); const router = express.Router(); app.use('/v1', router); router.post('/x', (req, res) => res.end());`,
    },
  });
  assert(g.components.some((c) => c.role === "router"));
  assert.deepEqual(g.components.find((c) => c.role === "route").fullPaths, [
    "/v1/x",
  ]);
});
test("documentation uses same snapshot and rejects fabricated or unrelated citations", async () => {
  const g = analyze(input);
  const d = await documentGraph(g);
  assert.equal(d.snapshotId, g.snapshotId);
  const md = markdown(g, d);
  assert(md.includes("```mermaid"));
  assert(md.includes(g.commit));
  assert(md.includes(g.snapshotId));
  const c = g.components.find((c) => c.name === "handle");
  const value = {
    explanations: [
      {
        componentId: c.id,
        explanation: "Processes a request.",
        referenceIds: [c.referenceId],
        inferred: true,
      },
    ],
  };
  assert.doesNotThrow(() => validateExplanations(value, g));
  assert.throws(() =>
    validateExplanations(
      {
        explanations: [
          { ...value.explanations[0], referenceIds: ["invented"] },
        ],
      },
      g,
    ),
  );
  assert.throws(() =>
    validateExplanations(value, { ...g, snapshotId: "another-snapshot" }),
  );
});
test("public GitHub URL validation rejects alternate hosts and credentials", () => {
  assert.equal(
    parseRepository("https://github.com/expressjs/express.git").name,
    "express",
  );
  for (const url of [
    "http://github.com/a/b",
    "https://evil.com/a/b",
    "https://user@github.com/a/b",
    "https://github.com/../b",
  ])
    assert.throws(() => parseRepository(url));
});
test("database operation recognition requires pg constructor provenance", () => {
  const g = analyze({
    ...input,
    files: {
      "db.ts": `import { Pool as PgPool } from 'pg'; const pool = new PgPool(); function load() { return pool.query('SELECT 1'); } const other = { query() {} }; other.query();`,
    },
  });
  assert.equal(
    g.components.filter((c) => c.role === "database_operation").length,
    1,
  );
  assert(g.relationships.some((e) => e.type === "queries_database"));
});
test("named Router import is a router and dependency-only methods are not routes", () => {
  const g = analyze({
    ...input,
    files: {
      "app.ts": `import { Router as R, unknownFactory } from 'express'; const router = R(); const fake = unknownFactory(); fake.get('/fake', () => {}); router.get('/real', () => {});`,
    },
  });
  assert.equal(g.components.filter((c) => c.role === "router").length, 1);
  assert.equal(g.components.filter((c) => c.role === "route").length, 1);
});
test("CommonJS default-exported routers mount across files", () => {
  const g = analyze({
    ...input,
    files: {
      "app.js": `const express = require('express'); const router = require('./router'); const app = express(); app.use('/api', router);`,
      "router.js": `const express = require('express'); const router = express.Router(); router.get('/x', (req, res) => res.end()); module.exports = router;`,
    },
  });
  assert.deepEqual(g.components.find((c) => c.role === "route").fullPaths, [
    "/api/x",
  ]);
});
test("compiler resolves tsconfig path aliases without reading outside snapshot", () => {
  const g = analyze({
    ...input,
    files: {
      ...files,
      "tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@svc/*":["./*"]}}}',
      "handler.ts": `import { lookup as load } from '@svc/service'; export function handle(req,res) { return load(req.id); }`,
    },
  });
  const handler = g.components.find((c) => c.name === "handle");
  assert(
    g.relationships.some(
      (e) =>
        e.type === "calls" &&
        e.source === handler.id &&
        g.components.find((c) => c.id === e.target)?.name === "lookup",
    ),
  );
});
