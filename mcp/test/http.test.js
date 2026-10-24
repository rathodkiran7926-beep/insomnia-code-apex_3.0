import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startFakeBackend } from "./fakeBackend.js";

const mcpRoot = fileURLToPath(new URL("../", import.meta.url));
const entrypoint = fileURLToPath(new URL("../src/http.js", import.meta.url));

function childEnv(overrides = {}) {
  return {
    ...process.env,
    MCP_HTTP_HOST: "127.0.0.1",
    MCP_HTTP_PORT: "0",
    ...overrides,
  };
}

async function startServer(env) {
  const child = spawn(process.execPath, [entrypoint], {
    cwd: mcpRoot,
    env: childEnv(env),
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
  return { child, endpoint, stderr: () => stderr, stdout: () => stdout };
}

async function stopServer(server) {
  server.child.kill();
  await once(server.child, "exit").catch(() => {});
}

test("Streamable HTTP exposes the same four read-only tools and rejects unsafe requests", async () => {
  const backend = await startFakeBackend({ token: "backend-secret" });
  const token = randomBytes(24).toString("hex");
  const server = await startServer({
    CODEBASE_MENTOR_API_URL: backend.url,
    CODEBASE_MENTOR_API_TOKEN: "backend-secret",
    MCP_HTTP_TOKEN: token,
  });
  const client = new Client({ name: "codebase-mentor-http-test", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(server.endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((tool) => tool.name), [
      "get_task_context",
      "inspect_symbol",
      "explore_dependencies",
      "check_context_drift",
    ]);
    for (const tool of tools) assert.equal(tool.annotations?.readOnlyHint, true);

    const context = await client.callTool({
      name: "get_task_context",
      arguments: { snapshotId: "snapshot-one", task: "trace handleRequest into loadAccount", targetTokens: 800, maxTokens: 1200 },
    });
    assert.equal(context.isError, false);
    assert.equal(context.structuredContent.identity.snapshotId, "snapshot-one");
    assert.equal(JSON.parse(context.content[0].text).identity.snapshotId, "snapshot-one");

    const inspected = await client.callTool({ name: "inspect_symbol", arguments: { snapshotId: "snapshot-one", symbol: "handleRequest" } });
    assert.equal(inspected.isError, false);
    assert.equal(inspected.structuredContent.nodes[0].match, "exact");

    const dependencies = await client.callTool({
      name: "explore_dependencies",
      arguments: { snapshotId: "snapshot-one", symbol: "handleRequest", depth: 2, maxNodes: 2, maxEdges: 1 },
    });
    assert.equal(dependencies.isError, false);
    assert.equal(dependencies.structuredContent.relationships[0].type, "calls");

    const referenceIds = context.structuredContent.evidence.flatMap((item) => item.referenceIds || [item.referenceId]);
    const drift = await client.callTool({ name: "check_context_drift", arguments: { snapshotId: "snapshot-one", referenceIds } });
    assert.equal(drift.isError, false);
    assert.equal(drift.structuredContent.status, "snapshot_consistent_live_unverified");

    const missing = await client.callTool({ name: "get_task_context", arguments: { snapshotId: "missing", task: "find entry point" } });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /Snapshot not found/);

    assert.equal(backend.requests.length, 5);
    for (const request of backend.requests) assert.equal(request.headers.authorization, "Bearer backend-secret");

    const initialize = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "http-test-probe", version: "1.0.0" } },
    };
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    const unauthorized = await fetch(server.endpoint, { method: "POST", headers, body: JSON.stringify(initialize) });
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get("www-authenticate") || "", /Bearer/);

    const badOrigin = await fetch(server.endpoint, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${token}`, Origin: "http://evil.example" },
      body: JSON.stringify(initialize),
    });
    assert.equal(badOrigin.status, 403);

    const allowedOrigin = await fetch(server.endpoint, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${token}`, Origin: new URL(server.endpoint).origin },
      body: JSON.stringify(initialize),
    });
    assert.equal(allowedOrigin.status, 200);

    const wrongToken = await fetch(server.endpoint, {
      method: "POST",
      headers: { ...headers, Authorization: "Bearer wrong-token", Origin: new URL(server.endpoint).origin },
      body: JSON.stringify(initialize),
    });
    assert.equal(wrongToken.status, 401);

    const getNotAllowed = await fetch(server.endpoint, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(getNotAllowed.status, 405);

    const wrongContentType = await fetch(server.endpoint, {
      method: "POST",
      headers: { "content-type": "text/plain", Authorization: `Bearer ${token}` },
      body: "{}",
    });
    assert.equal(wrongContentType.status, 415);

    const tooLarge = await fetch(server.endpoint, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...initialize, padding: "x".repeat(1024 * 1024 + 10) }),
    });
    assert.equal(tooLarge.status, 413);

    const health = await fetch(new URL("/healthz", server.endpoint));
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    assert.equal(server.stdout(), "");
    assert.doesNotMatch(server.stderr(), /(?:uncaught|syntaxerror|referenceerror|typeerror)/i);
  } finally {
    await client.close().catch(() => {});
    await stopServer(server);
    await backend.close();
  }
});

test("Streamable HTTP refuses to start without a sufficiently long token", async () => {
  const env = childEnv();
  delete env.MCP_HTTP_TOKEN;
  const child = spawn(process.execPath, [entrypoint], {
    cwd: mcpRoot,
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.match(stderr, /MCP_HTTP_TOKEN is required/);
});
