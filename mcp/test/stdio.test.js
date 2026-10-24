import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startFakeBackend } from "./fakeBackend.js";

const mcpRoot = fileURLToPath(new URL("../", import.meta.url));
const entrypoint = fileURLToPath(new URL("../src/stdio.js", import.meta.url));

async function connect(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint],
    cwd: mcpRoot,
    env: { ...getDefaultEnvironment(), ...env },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.setEncoding("utf8");
  transport.stderr?.on("data", (chunk) => { stderr += chunk; });
  const client = new Client({ name: "codebase-mentor-test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, stderr: () => stderr };
}

test("STDIO discovers all four tools and returns backend responses", async () => {
  const backend = await startFakeBackend({ token: "backend-secret" });
  const { client, stderr } = await connect({
    CODEBASE_MENTOR_API_URL: backend.url,
    CODEBASE_MENTOR_API_TOKEN: "backend-secret",
  });
  try {
    const resources = await client.listResources();
    assert.deepEqual(resources.resources, []);

    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((tool) => tool.name), [
      "get_task_context",
      "inspect_symbol",
      "explore_dependencies",
      "check_context_drift",
    ]);
    for (const tool of tools) {
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.annotations?.destructiveHint, false);
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.ok(tool.inputSchema.required.includes("snapshotId"));
      assert.ok(tool.description.length > 40);
    }

    const context = await client.callTool({
      name: "get_task_context",
      arguments: { snapshotId: "snapshot-one", task: "trace handleRequest into loadAccount", targetTokens: 800, maxTokens: 1200 },
    });
    assert.equal(context.isError, false);
    assert.equal(context.structuredContent.identity.snapshotId, "snapshot-one");
    assert.equal(JSON.parse(context.content[0].text).identity.snapshotId, "snapshot-one");
    assert.equal(context.structuredContent.nodes[0].name, "handleRequest");
    assert.equal(context.structuredContent.evidence[0].file, "src/handler.js");

    const inspected = await client.callTool({ name: "inspect_symbol", arguments: { snapshotId: "snapshot-one", symbol: "handleRequest" } });
    assert.equal(inspected.isError, false);
    assert.equal(inspected.structuredContent.nodes[0].match, "exact");

    const dependencies = await client.callTool({
      name: "explore_dependencies",
      arguments: { snapshotId: "snapshot-one", symbol: "handleRequest", depth: 2, maxNodes: 2, maxEdges: 1 },
    });
    assert.equal(dependencies.isError, false);
    assert.equal(dependencies.structuredContent.relationships.length, 1);
    assert.equal(dependencies.structuredContent.relationships[0].type, "calls");

    const referenceIds = context.structuredContent.evidence.flatMap((item) => item.referenceIds || [item.referenceId]);
    const drift = await client.callTool({ name: "check_context_drift", arguments: { snapshotId: "snapshot-one", referenceIds } });
    assert.equal(drift.isError, false);
    assert.equal(drift.structuredContent.status, "snapshot_consistent_live_unverified");

    assert.equal(backend.requests.length, 4);
    for (const request of backend.requests) {
      assert.equal(request.method, "POST");
      assert.equal(request.headers.authorization, "Bearer backend-secret");
    }
    assert.deepEqual(backend.requests[0].body, {
      task: "trace handleRequest into loadAccount",
      targetTokens: 800,
      maxTokens: 1200,
    });
    assert.deepEqual(backend.requests[1].body, { symbol: "handleRequest" });
    assert.deepEqual(backend.requests[2].body, { symbol: "handleRequest", depth: 2, maxNodes: 2, maxEdges: 1 });
    assert.deepEqual(backend.requests[3].body, { referenceIds });

    assert.doesNotMatch(stderr(), /(?:uncaught|syntaxerror|referenceerror|typeerror)/i);
  } finally {
    await client.close();
    await backend.close();
  }
});

test("STDIO validates locally, reports backend errors safely, and does not forward invalid calls", async () => {
  const backend = await startFakeBackend();
  const { client } = await connect({ CODEBASE_MENTOR_API_URL: backend.url });
  try {
    const missing = await client.callTool({ name: "get_task_context", arguments: { snapshotId: "missing", task: "find entry point" } });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /Snapshot not found/);
    assert.equal(backend.requests.length, 1);

    const invalid = await client.callTool({ name: "inspect_symbol", arguments: { snapshotId: "snapshot-one", symbol: "" } });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /Invalid symbol/);

    const invalidBudget = await client.callTool({
      name: "get_task_context",
      arguments: { snapshotId: "snapshot-one", task: "find entry point", maxTokens: 10 },
    });
    assert.equal(invalidBudget.isError, true);
    assert.match(invalidBudget.content[0].text, /Invalid maxTokens/);

    const unknownArgument = await client.callTool({
      name: "get_task_context",
      arguments: { snapshotId: "snapshot-one", task: "find entry point", databasePath: "elsewhere.sqlite" },
    });
    assert.equal(unknownArgument.isError, true);
    assert.match(unknownArgument.content[0].text, /Invalid tool arguments/);
    assert.equal(backend.requests.length, 1);

    const invalidReference = await client.callTool({
      name: "check_context_drift",
      arguments: { snapshotId: "snapshot-one", referenceIds: ["missing-reference"] },
    });
    assert.equal(invalidReference.isError, false);
    assert.equal(invalidReference.structuredContent.status, "stale_or_invalid_evidence");
  } finally {
    await client.close();
    await backend.close();
  }
});

test("STDIO reports an unreachable backend without exposing internals", async () => {
  const { client } = await connect({ CODEBASE_MENTOR_API_URL: "http://127.0.0.1:1" });
  try {
    const result = await client.callTool({ name: "get_task_context", arguments: { snapshotId: "snapshot-one", task: "find entry point" } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /unreachable/);
    assert.doesNotMatch(result.content[0].text, /ECONNREFUSED|ECONNRESET|fetch failed/);
  } finally {
    await client.close();
  }
});
