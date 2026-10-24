// Loaded only by the real PR worker through inherited --import execArgv.
// Fail closed: these tests must never send a request to a public service.
import { isMainThread } from "node:worker_threads";
import { gzipSync } from "node:zlib";
import { setTimeout } from "node:timers/promises";
import { existsSync } from "node:fs";
import tar from "tar-stream";

if (!isMainThread) {
  const base = "c".repeat(40);
  const head = "b".repeat(40);
  const target = "a".repeat(40);
  const json = (value) => new Response(JSON.stringify(value));
  const files = (commit) => ({
    "main.ts": `export function value(){return ${commit === base ? 1 : 2}}\nexport function caller(){return value()}`,
    "package.json": JSON.stringify({ name: "worker-fixture", scripts: { start: "node main.js" } }),
  });
  const archive = async (commit) => {
    const pack = tar.pack();
    const chunks = [];
    const collecting = (async () => {
      for await (const chunk of pack) chunks.push(chunk);
      return gzipSync(Buffer.concat(chunks));
    })();
    for (const [name, content] of Object.entries(files(commit)))
      pack.entry({ name: `fixture/${name}`, type: "file" }, content);
    pack.finalize();
    return collecting;
  };
  let first = true;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    // The scenario releases this barrier after observing running status/capacity.
    if (first) {
      first = false;
      const gate = process.env.CODEBASE_MENTOR_PR_TEST_GATE;
      if (!gate) throw new Error("Missing PR test worker gate");
      const deadline = Date.now() + 10000;
      while (!existsSync(gate)) {
        if (Date.now() >= deadline) throw new Error("PR test worker gate timed out");
        await setTimeout(10);
      }
    }
    if (url.origin === "https://api.github.com") {
      if (url.pathname === "/repos/example/project/pulls/2")
        return new Response("{}", { status: 403 });
      if (/^\/repos\/example\/project\/pulls\/(1|3)$/.test(url.pathname))
        return json({
          title: "Change value", state: "open", changed_files: 1,
          base: { sha: target, ref: "main", repo: { full_name: "example/project", private: false, owner: { login: "example" } } },
          head: { sha: head, ref: "feature", repo: { full_name: "contributor/project", private: false, owner: { login: "contributor" } } },
        });
      if (url.pathname === `/repos/example/project/compare/${target}...contributor%3A${head}`)
        return json({ merge_base_commit: { sha: base }, files: [{ filename: "main.ts", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-return 1\n+return 2" }] });
      if (["/repos/example/project", "/repos/contributor/project"].includes(url.pathname))
        return json({ private: false, default_branch: "main" });
      const commit = /\/commits\/([bc]{40})$/.exec(url.pathname)?.[1];
      if (commit) return json({ sha: commit });
      const tree = /\/git\/trees\/([bc]{40})$/.exec(url.pathname)?.[1];
      if (tree)
        return json({ truncated: false, tree: Object.entries(files(tree)).map(([path, content]) => ({ path, type: "blob", mode: "100644", size: Buffer.byteLength(content) })) });
    }
    if (url.origin === "https://codeload.github.com") {
      const commit = /^\/(?:example|contributor)\/project\/tar\.gz\/([bc]{40})$/.exec(url.pathname)?.[1];
      if (commit) return new Response(await archive(commit));
    }
    throw new Error(`Unexpected PR test provider request: ${url.origin}${url.pathname}`);
  };
}
