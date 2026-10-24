import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/analyzer.js";
import { compareEvidence } from "../src/prComparison.js";
import {
  parsePullRequest,
  fetchPullRequest,
  listPullRequests,
} from "../src/prGithub.js";

test("repository PR discovery supports filters and pagination without accepting provider URLs", async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(
      JSON.stringify(
        String(url).includes("/pulls?")
          ? [
              {
                number: 7,
                title: "Real change",
                html_url: "https://evil.example/",
                state: "closed",
                merged_at: "2026-01-01",
                user: { login: "contributor" },
                head: { ref: "feature" },
                base: { ref: "main" },
              },
            ]
          : { private: false },
      ),
    );
  };
  try {
    const list = await listPullRequests(
      "https://github.com/example/project",
      "closed",
      2,
    );
    assert.equal(
      list.pullRequests[0].url,
      "https://github.com/example/project/pull/7",
    );
    assert.equal(list.pullRequests[0].merged, true);
    assert.equal(list.pullRequests[0].author, "contributor");
    assert(!Number.isNaN(Date.parse(list.fetchedAt)));
    assert.equal(list.hasMore, false);
    assert(
      urls.some(
        (url) => url.includes("state=closed") && url.includes("page=2"),
      ),
    );
    await assert.rejects(listPullRequests("https://evil.example/x/y"));
    await assert.rejects(
      listPullRequests("https://github.com/example/project", "bad"),
    );
    await assert.rejects(
      listPullRequests("https://github.com/example/project", "open", 0),
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("PR discovery rejects private repositories and preserves GitHub errors", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ private: true }));
    await assert.rejects(
      listPullRequests("https://github.com/example/project"),
      /public repositories/,
    );
    globalThis.fetch = async () => new Response("{}", { status: 403 });
    await assert.rejects(
      listPullRequests("https://github.com/example/project"),
      (error) => error.remoteStatus === 403,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("PR discovery defaults to all PRs and preserves an empty GitHub result", async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return new Response(JSON.stringify(String(url).includes('/pulls?') ? [] : { private: false }));
  };
  try {
    const result = await listPullRequests('https://github.com/example/project');
    assert.equal(result.state, 'all');
    assert.deepEqual(result.pullRequests, []);
    assert.equal(result.hasMore, false);
    assert(urls.some(url => url.includes('state=all')));
  } finally { globalThis.fetch = original; }
});
const repository = "https://github.com/example/project";
const input = (files, commit) => ({
  files,
  graph: analyze({
    files,
    commit: commit.repeat(40),
    repository,
    exclusions: [],
  }),
});
const pr = (files) => ({
  files: files.map((path) => ({ path, envNames: [] })),
  limited: false,
});

test("PR URLs are restricted to public GitHub pull request paths", () => {
  assert.equal(parsePullRequest(repository + "/pull/12").number, 12);
  for (const url of [
    "http://github.com/x/y/pull/1",
    "https://github.com.evil/x/y/pull/1",
    "https://user:pass@github.com/x/y/pull/1",
    "https://github.com/../x/pull/1",
    "https://github.com/x/y/pull/0",
  ])
    assert.throws(() => parsePullRequest(url));
});
test("comparison detects modifications beyond excerpt limits, graph changes and incoming impact", () => {
  const long = "  const unused = 0;\n".repeat(120);
  const a = input(
    {
      "main.ts": `export function helper(){\n${long}return 1;\n}\nexport function caller(){return helper();}`,
    },
    "a",
  );
  const b = input(
    {
      "main.ts": `export function helper(){\n${long}return 2;\n}\nexport function caller(){return helper();}\nexport function added(){return helper();}`,
    },
    "b",
  );
  const r = compareEvidence(pr(["main.ts"]), a, b);
  const helper = r.components.find((c) => c.after?.name === "helper");
  assert.equal(helper.status, "modified");
  assert(helper.before.reference.url.includes("a".repeat(40)));
  assert(helper.after.reference.url.includes("b".repeat(40)));
  assert(
    r.components.some((c) => c.status === "added" && c.after.name === "added"),
  );
  assert(r.edges.added.length > 0);
  assert(r.impact.after.some((c) => c.name === "caller" && c.depth === 1));
  const caller = r.impact.after.find((component) => component.name === "caller");
  assert(
    !r.components.some(
      (component) => component.before?.id === caller.id || component.after?.id === caller.id,
    ),
  );
});
test("file renames preserve named component identity without relying on sequential IDs", () => {
  const a = input({ "old.ts": "export function same(){return 1}" }, "a");
  const b = input({ "new.ts": "export function same(){return 1}" }, "b");
  const p = pr(["new.ts"]);
  p.files[0].previousPath = "old.ts";
  assert.equal(compareEvidence(p, a, b).components.length, 0);
});
test("functions sharing one source line are compared by exact AST spans", () => {
  const a = input(
    { "x.ts": "export function a(){return 1} export function b(){return 1}" },
    "a",
  );
  const b = input(
    { "x.ts": "export function a(){return 2} export function b(){return 1}" },
    "b",
  );
  const r = compareEvidence(pr(["x.ts"]), a, b);
  assert(r.components.some((c) => c.after?.name === "a"));
  assert(!r.components.some((c) => c.after?.name === "b"));
});
test("removed components and package/script changes are grounded in both manifests", () => {
  const a = input(
    {
      "old.ts": "export function removed(){return 1}",
      "package.json": JSON.stringify({
        name: "x",
        dependencies: { express: "4" },
        scripts: { start: "node old.js" },
      }),
    },
    "a",
  );
  const b = input(
    {
      "package.json": JSON.stringify({
        name: "x",
        dependencies: { express: "5", mail: "1" },
        scripts: { start: "node new.js" },
        engines: { node: ">=24" },
      }),
    },
    "b",
  );
  const p = pr(["old.ts", "package.json", "db/migrations/001.sql"]);
  const r = compareEvidence(p, a, b);
  assert(
    r.components.some(
      (c) => c.before?.name === "removed" && c.status === "removed",
    ),
  );
  assert.deepEqual(
    r.setup.dependencies.find((d) => d.name === "express"),
    {
      path: "package.json",
      section: "dependencies",
      name: "express",
      before: "4",
      after: "5",
    },
  );
  assert.equal(r.setup.scripts[0].after, "node new.js");
  assert.equal(r.setup.guides.after[0].engines.node, ">=24");
  assert.equal(r.setup.migrations.length, 1);
});
test("invalid manifests are reported rather than inventing recipes", () => {
  const r = compareEvidence(
    pr(["package.json"]),
    input({ "package.json": "null" }, "a"),
    input({ "package.json": "[]" }, "b"),
  );
  assert(r.warnings.some((w) => w.includes("Could not parse")));
  assert.equal(r.setup.guides.after.length, 0);
});
test("PR fetch pins merge-base and head; secret template values are not retained", async () => {
  const original = globalThis.fetch;
  const metadata = {
    title: "Email verification",
    state: "open",
    changed_files: 1,
    base: {
      sha: "a".repeat(40),
      ref: "main",
      repo: { full_name: "example/project", private: false },
    },
    head: {
      sha: "b".repeat(40),
      ref: "feature",
      repo: {
        full_name: "friend/project",
        owner: { login: "friend" },
        private: false,
      },
    },
  };
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(
      JSON.stringify(
        String(url).includes("/compare/")
          ? {
              merge_base_commit: { sha: "c".repeat(40) },
              files: [
                {
                  filename: ".env.example",
                  status: "modified",
                  patch:
                    "@@ -1 +1 @@\n-OLD=private-before\n+MAIL_KEY=private-after",
                  additions: 1,
                  deletions: 1,
                },
              ],
            }
          : metadata,
      ),
    );
  };
  try {
    const r = await fetchPullRequest(repository + "/pull/12");
    assert.equal(r.baseCommit, "c".repeat(40));
    assert.equal(r.headRepository, "https://github.com/friend/project");
    assert.equal(r.files[0].patch, null);
    assert.equal(r.files[0].envNames[1].name, "MAIL_KEY");
    assert(!JSON.stringify(r).includes("private-after"));
    assert(requests.some((url) => url.includes("friend%3A")));
  } finally {
    globalThis.fetch = original;
  }
});
test("PR updated during metadata fetch is rejected", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  const repo = {
    full_name: "example/project",
    owner: { login: "example" },
    private: false,
  };
  globalThis.fetch = async (url) => {
    if (String(url).includes("/compare/"))
      return new Response(
        JSON.stringify({
          merge_base_commit: { sha: "c".repeat(40) },
          files: [],
        }),
      );
    calls++;
    return new Response(
      JSON.stringify({
        base: { repo, sha: "a".repeat(40) },
        head: { repo, sha: (calls === 1 ? "b" : "d").repeat(40) },
      }),
    );
  };
  try {
    await assert.rejects(
      fetchPullRequest(repository + "/pull/1"),
      /changed during analysis/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
