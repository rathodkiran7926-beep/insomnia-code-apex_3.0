import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const apiUrl = (process.env.CODEBASE_MENTOR_API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const health = await fetch(`${apiUrl}/api/health`).catch(() => null);
if (!health?.ok) throw new Error(`Codebase Mentor backend is not reachable at ${apiUrl}. Run Install-Codebase-Mentor.bat or Start-Codebase-Mentor.bat first.`);

const env = getDefaultEnvironment();
env.CODEBASE_MENTOR_API_URL = apiUrl;
if (process.env.CODEBASE_MENTOR_API_TOKEN) env.CODEBASE_MENTOR_API_TOKEN = process.env.CODEBASE_MENTOR_API_TOKEN;
if (process.env.CODEBASE_MENTOR_REPOSITORY_URL) env.CODEBASE_MENTOR_REPOSITORY_URL = process.env.CODEBASE_MENTOR_REPOSITORY_URL;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--env-file-if-exists=.env", fileURLToPath(new URL("../src/stdio.js", import.meta.url))],
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env,
  stderr: "pipe",
});
const client = new Client({ name: "codebase-mentor-auto-context-verifier", version: "1.0.0" }, { capabilities: {} });
try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map((tool) => tool.name), ["get_task_context", "inspect_symbol", "explore_dependencies", "check_context_drift"]);
  const result = await client.callTool({
    name: "get_task_context",
    arguments: { task: "Understand the request flow and identify relevant files, symbols, dependencies, and source evidence." },
  });
  if (result.isError) throw new Error(result.content?.[0]?.text || "Automatic context retrieval failed.");
  const value = result.structuredContent || JSON.parse(result.content?.[0]?.text || "{}");
  assert.ok(value.identity?.snapshotId, "No snapshot identity was returned; workspace auto-resolution was not verified.");
  assert.ok(Number.isFinite(value.tokenEstimate), "No token estimate was returned.");
  assert.ok(Array.isArray(value.evidence), "No evidence array was returned.");
  console.log(JSON.stringify({
    ok: true,
    repository: value.identity.repository,
    snapshotId: value.identity.snapshotId,
    commit: value.identity.commit,
    evidenceItems: value.evidence.length,
    tokenEstimate: value.tokenEstimate,
    freshness: value.freshness,
  }, null, 2));
} finally {
  await client.close();
}
