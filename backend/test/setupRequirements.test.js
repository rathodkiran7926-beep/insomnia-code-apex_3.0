import test from "node:test";
import assert from "node:assert/strict";
import { deriveSetupPlan, isSetupPath } from "../src/setupRequirements.js";
const graph = {
  snapshotId: "snapshot",
  repository: "https://github.com/example/repo",
  commit: "a".repeat(40),
};
const derive = (files, paths = []) =>
  deriveSetupPlan({ graph, files, metadata: { paths, limited: false } });
const pkg = (scripts = { dev: "tsx src/index.ts" }, extra = {}) =>
  JSON.stringify({ name: "example", scripts, ...extra });
test("detects actual environment reads, not comments or strings; never includes fallback secrets", () => {
  const plan = derive({
    "backend/package.json": pkg(),
    "backend/src/index.ts": `// process.env.COMMENT
 const text = 'process.env.STRING';
 const token = process.env.API_KEY || 'must-not-appear';
 const database = process.env['DATABASE_URL'];
 const { REGION } = process.env;
 if (!process.env.REQUIRED) throw new Error('missing');`,
  });
  assert.deepEqual(
    new Set(plan.environment.map((e) => e.name)),
    new Set(["API_KEY", "DATABASE_URL", "REGION", "REQUIRED"]),
  );
  assert.equal(
    plan.environment.find((e) => e.name === "REQUIRED").status,
    "checked",
  );
  assert.equal(
    plan.environment.find((e) => e.name === "API_KEY").status,
    "fallback",
  );
  assert(!JSON.stringify(plan).includes("must-not-appear"));
  assert(
    plan.environment.every((e) => e.evidence[0].url.includes("a".repeat(40))),
  );
});
test("frontend built-ins are excluded and public configuration is scoped to its own app", () => {
  const p = derive({
    "backend/package.json": pkg(),
    "frontend/package.json": pkg(
      { dev: "vite" },
      { devDependencies: { vite: "1" } },
    ),
    "frontend/src/main.ts":
      "const url=import.meta.env.VITE_API_URL; if(import.meta.env.DEV) console.log(import.meta.env.MODE);",
    "backend/src/index.ts": "process.env.API_KEY;",
  });
  assert.equal(p.environment.length, 2);
  assert(
    p.projects.find((p) => p.directory === "frontend").environment[0]
      .clientExposed,
  );
  assert.equal(
    p.projects.find((p) => p.directory === "frontend").environmentFile,
    "frontend/.env.local",
  );
  assert.equal(
    p.projects.find((p) => p.directory === "backend").environmentFile,
    null,
  );
});
test("lockfiles and manifest declarations ground install/start instructions and runtime constraints", () => {
  const p = derive(
    {
      "backend/package.json": pkg(
        { start: "node dist/index.js", build: "tsc" },
        { engines: { node: ">=22" }, packageManager: "npm@11.0.0" },
      ),
      "frontend/package.json": pkg(
        { dev: "vite" },
        { packageManager: "pnpm@10.0.0" },
      ),
    },
    ["backend/package-lock.json", "frontend/pnpm-lock.yaml"],
  );
  const backend = p.projects.find((p) => p.directory === "backend"),
    front = p.projects.find((p) => p.directory === "frontend");
  assert.equal(backend.node, ">=22");
  assert(backend.commands.some((c) => c.command === "npm ci"));
  assert(
    backend.commands.findIndex((c) => c.command === "npm run build") <
      backend.commands.findIndex((c) => c.command === "npm run start"),
  );
  assert(
    front.commands.some((c) => c.command === "pnpm install --frozen-lockfile"),
  );
  assert.equal(front.recommendedScript, "dev");
});
test("missing manager and startup evidence remain unknown; unused dependencies do not invent services", () => {
  const p = derive({
    "package.json": pkg(
      { build: "tsc" },
      { dependencies: { pg: "8", dockerode: "4" } },
    ),
    "x.ts": `import Fake from './pg'; new Fake(); import dotenv from 'dotenv'; process.env.KEY;`,
  });
  assert.equal(p.projects[0].manager, null);
  assert.equal(p.projects[0].recommendedScript, null);
  assert(!p.projects[0].commands.some((c) => c.command.includes("install")));
  assert.equal(p.services.length, 0);
  assert.equal(p.projects[0].environmentFile, null);
});
test("supported service construction and ports are source-linked; AWS SDK setup is explicit", () => {
  const p = derive({
    "backend/package.json": pkg(),
    "backend/src/index.ts": `import dotenv from 'dotenv';import {CodeBuildClient as CloudBuild} from '@aws-sdk/client-codebuild';import {Pool} from 'pg';
 dotenv.config(); new CloudBuild({}); new Pool(); const port=process.env.PORT||8000; app.listen(port);`,
  });
  assert.deepEqual(
    new Set(p.services.map((s) => s.name)),
    new Set(["AWS CodeBuild", "PostgreSQL"]),
  );
  assert(
    p.services
      .find((s) => s.name === "AWS CodeBuild")
      .setup.some((s) => s.includes("IAM role")),
  );
  assert.equal(p.projects[0].ports[0].port, 8000);
  assert.equal(p.projects[0].ports[0].environment, "PORT");
  assert.equal(p.projects[0].environmentFile, "backend/.env");
});
test("metadata selection excludes real environment files and dependency lockfiles", () => {
  assert(isSetupPath("app/.env.example"));
  assert(isSetupPath("app/pnpm-lock.yaml"));
  assert(!isSetupPath("app/.env"));
  assert(!isSetupPath("app/.env.production"));
  assert(!isSetupPath("node_modules/dependency/package-lock.json"));
});
test("custom or dynamic dotenv locations do not get replaced with an invented default path", () => {
  const base = { "package.json": pkg() };
  const custom = derive({
    ...base,
    "index.ts": `import dotenv from 'dotenv';dotenv.config({path:'config/.env.local'});process.env.API_KEY;`,
  });
  assert.equal(custom.projects[0].environmentFile, "config/.env.local");
  const dynamic = derive({
    ...base,
    "index.ts": `import dotenv from 'dotenv';dotenv.config({path:choosePath()});process.env.API_KEY;`,
  });
  assert.equal(dynamic.projects[0].environmentFile, null);
});
test("ambiguous lockfiles and invalid manifests are reported", () => {
  const p = derive({ "package.json": pkg(), "bad/package.json": "null" }, [
    "package-lock.json",
    "yarn.lock",
  ]);
  assert(p.projects[0].managerConflict);
  assert.equal(p.projects[0].manager, null);
  assert(p.warnings.some((w) => w.includes("bad/package.json")));
});
test("only safe loopback defaults are exposed, never credential or nonlocal fallback values", () => {
  const p = derive({
    "package.json": pkg(),
    "index.ts": `const a=process.env.API_URL||'http://localhost:5000/api';const b=process.env.TOKEN||'do-not-expose';const c=process.env.OTHER||'https://service.example/private?key=value';`,
  });
  assert.equal(
    p.environment.find((e) => e.name === "API_URL").localDefault,
    "http://localhost:5000/api",
  );
  assert.equal(
    p.environment.find((e) => e.name === "TOKEN").localDefault,
    undefined,
  );
  assert(!JSON.stringify(p).includes("do-not-expose"));
  assert(!JSON.stringify(p).includes("key=value"));
});
