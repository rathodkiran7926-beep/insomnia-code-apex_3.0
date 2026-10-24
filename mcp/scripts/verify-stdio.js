import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

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

const env = getDefaultEnvironment();
env.CODEBASE_MENTOR_API_URL = apiUrl;
if (process.env.CODEBASE_MENTOR_API_TOKEN) env.CODEBASE_MENTOR_API_TOKEN = process.env.CODEBASE_MENTOR_API_TOKEN;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../src/stdio.js", import.meta.url))],
  cwd: mcpRoot,
  env,
  stderr: "pipe",
});
let stderr = "";
transport.stderr?.setEncoding("utf8");
transport.stderr?.on("data", (chunk) => { stderr += chunk; });

const client = new Client({ name: "codebase-mentor-verifier", version: "1.0.0" }, { capabilities: {} });

try {
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.name, "codebase-mentor-agent-context-bridge");
  assert.ok(client.getServerCapabilities()?.tools);
  assert.ok(client.getServerCapabilities()?.resources);

  const resources = await client.listResources();
  assert.deepEqual(resources.resources, []);

  const tools = (await client.listTools()).tools;
  const expected = ["get_task_context", "inspect_symbol", "explore_dependencies", "check_context_drift"];
  assert.deepEqual(tools.map((tool) => tool.name), expected);
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.inputSchema.required.includes("snapshotId"));
    assert.ok(tool.description.length > 40);
  }

  const task = "Understand the request flow and identify the relevant files, symbols, dependencies, and source evidence.";
  const context = await client.callTool({ name: "get_task_context", arguments: { snapshotId, task } });
  assert.equal(context.isError, false);
  const contextValue = context.structuredContent;
  assert.equal(contextValue.identity.snapshotId, snapshotId);
  assert.equal(JSON.parse(context.content[0].text).identity.snapshotId, snapshotId);
  assert.ok(contextValue.tokenEstimate > 0);
  assert.match(contextValue.freshness, /snapshot_|evidence_/);

  const symbol = contextValue.nodes[0]?.name;
  if (!symbol) throw new Error("The saved snapshot has no source-backed symbol for the verification task.");
  const inspected = await client.callTool({ name: "inspect_symbol", arguments: { snapshotId, symbol } });
  const dependencies = await client.callTool({
    name: "explore_dependencies",
    arguments: { snapshotId, symbol, depth: 2, maxNodes: 12, maxEdges: 16 },
  });
  assert.equal(inspected.isError, false);
  assert.equal(dependencies.isError, false);
  assert.equal(inspected.structuredContent.identity.snapshotId, snapshotId);
  assert.equal(dependencies.structuredContent.identity.snapshotId, snapshotId);

  const evidenceIds = contextValue.evidence.flatMap((item) => item.referenceIds || [item.referenceId]);
  assert.ok(evidenceIds.length > 0, "The context response did not include source citations.");
  const drift = await client.callTool({ name: "check_context_drift", arguments: { snapshotId, referenceIds: evidenceIds } });
  assert.equal(drift.isError, false);
  assert.equal(drift.structuredContent.identity.snapshotId, snapshotId);
  assert.equal(drift.structuredContent.status, "snapshot_consistent_live_unverified");

  const invalid = await client.callTool({ name: "get_task_context", arguments: { snapshotId: "missing-snapshot", task } });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /Snapshot not found/);

  const invalidParameters = await client.callTool({ name: "inspect_symbol", arguments: { snapshotId, symbol: "" } });
  assert.equal(invalidParameters.isError, true);
  assert.match(invalidParameters.content[0].text, /Invalid symbol/);

  const unknownTool = await client.callTool({ name: "write_files", arguments: { snapshotId } });
  assert.equal(unknownTool.isError, true);
  assert.match(unknownTool.content[0].text, /Invalid tool arguments|Unknown tool/);

  const missingEvidence = await client.callTool({
    name: "check_context_drift",
    arguments: { snapshotId, referenceIds: ["missing-reference"] },
  });
  assert.equal(missingEvidence.isError, false);
  assert.equal(missingEvidence.structuredContent.status, "stale_or_invalid_evidence");

  const repeated = await client.callTool({ name: "get_task_context", arguments: { snapshotId, task } });
  assert.equal(repeated.structuredContent.cache.hit, true);

  assert.doesNotMatch(stderr, /(?:uncaught|syntaxerror|referenceerror|typeerror)/i);
  console.log(JSON.stringify({
    transport: "stdio",
    apiUrl,
    snapshotId,
    tools: expected,
    symbol,
    citations: evidenceIds.length,
    cacheHit: true,
    readOnlyTools: true,
  }));
} finally {
  await client.close().catch(() => {});
}
