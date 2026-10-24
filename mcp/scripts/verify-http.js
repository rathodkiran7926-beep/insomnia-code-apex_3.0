import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const mcpRoot = fileURLToPath(new URL("../", import.meta.url));
const apiUrl = (process.env.CODEBASE_MENTOR_API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const snapshotId = process.env.SNAPSHOT_ID || process.env.CODEBASE_MENTOR_SNAPSHOT_ID || process.argv[2];

if (!snapshotId) {
  throw new Error(
    "Set SNAPSHOT_ID (or pass it as the first argument) to a completed snapshot in the running backend.",
  );
}

const health = await fetch(`${apiUrl}/api/health`).catch(() => null);
if (!health?.ok) throw new Error(`Codebase Mentor backend is not reachable at ${apiUrl}. Start it first.`);

const token = randomBytes(24).toString("hex");
const child = spawn(process.execPath, [fileURLToPath(new URL("../src/http.js", import.meta.url))], {
  cwd: mcpRoot,
  env: {
    ...process.env,
    CODEBASE_MENTOR_API_URL: apiUrl,
    MCP_HTTP_HOST: "127.0.0.1",
    MCP_HTTP_PORT: "0",
    MCP_HTTP_TOKEN: token,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
let stdout = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; });
const endpoint = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Timed out waiting for the HTTP server.\n${stderr}`)), 10_000);
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    const match = stderr.match(/listening on (http:\/\/[^\s]+)/);
    if (match) {
      clearTimeout(timeout);
      resolve(match[1]);
    }
  });
  child.once("exit", (code) => {
    clearTimeout(timeout);
    reject(new Error(`HTTP server exited with code ${code}.\n${stderr}`));
  });
});

const client = new Client({ name: "codebase-mentor-http-verifier", version: "1.0.0" }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});

try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  const expected = ["get_task_context", "inspect_symbol", "explore_dependencies", "check_context_drift"];
  assert.deepEqual(tools.map((tool) => tool.name), expected);
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }

  const task = "Understand the request flow and identify the relevant files, symbols, dependencies, and source evidence.";
  const context = await client.callTool({ name: "get_task_context", arguments: { snapshotId, task } });
  assert.equal(context.isError, false);
  assert.equal(context.structuredContent.identity.snapshotId, snapshotId);
  assert.ok(context.structuredContent.tokenEstimate > 0);

  const symbol = context.structuredContent.nodes[0]?.name;
  if (!symbol) throw new Error("The saved snapshot has no source-backed symbol for the verification task.");
  const inspected = await client.callTool({ name: "inspect_symbol", arguments: { snapshotId, symbol } });
  const dependencies = await client.callTool({
    name: "explore_dependencies",
    arguments: { snapshotId, symbol, depth: 2, maxNodes: 12, maxEdges: 16 },
  });
  assert.equal(inspected.isError, false);
  assert.equal(dependencies.isError, false);

  const evidenceIds = context.structuredContent.evidence.flatMap((item) => item.referenceIds || [item.referenceId]);
  assert.ok(evidenceIds.length > 0, "The context response did not include source citations.");
  const drift = await client.callTool({ name: "check_context_drift", arguments: { snapshotId, referenceIds: evidenceIds } });
  assert.equal(drift.isError, false);
  assert.equal(drift.structuredContent.identity.snapshotId, snapshotId);
  assert.equal(drift.structuredContent.status, "snapshot_consistent_live_unverified");

  const repeated = await client.callTool({ name: "get_task_context", arguments: { snapshotId, task } });
  assert.equal(repeated.structuredContent.cache.hit, true);

  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "http-probe", version: "1.0.0" } },
  };
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const unauthorized = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(initialize) });
  assert.equal(unauthorized.status, 401);
  const badOrigin = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${token}`, Origin: "http://evil.example" },
    body: JSON.stringify(initialize),
  });
  assert.equal(badOrigin.status, 403);
  const getNotAllowed = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(getNotAllowed.status, 405);
  const wrongContentType = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "text/plain", Authorization: `Bearer ${token}` },
    body: "{}",
  });
  assert.equal(wrongContentType.status, 415);
  const tooLarge = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...initialize, padding: "x".repeat(1024 * 1024 + 10) }),
  });
  assert.equal(tooLarge.status, 413);
  const healthResponse = await fetch(new URL("/healthz", endpoint));
  assert.equal(healthResponse.status, 200);
  assert.equal((await healthResponse.json()).ok, true);

  assert.equal(stdout, "");
  assert.doesNotMatch(stderr, /(?:uncaught|syntaxerror|referenceerror|typeerror)/i);
  console.log(JSON.stringify({
    transport: "streamable-http",
    endpoint,
    apiUrl,
    snapshotId,
    tools: expected,
    symbol,
    citations: evidenceIds.length,
    cacheHit: true,
    protections: { auth: 401, origin: 403, get: 405, contentType: 415, bodyLimit: 413 },
    readOnlyTools: true,
  }));
} finally {
  await client.close().catch(() => {});
  child.kill();
  await once(child, "exit").catch(() => {});
}
