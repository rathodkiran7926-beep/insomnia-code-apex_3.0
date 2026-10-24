import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  checkContextDrift,
  exploreDependencies,
  getTaskContext,
  inspectSymbol,
} from "./backendClient.js";

const SERVER_NAME = "codebase-mentor-agent-context-bridge";
const SERVER_VERSION = "1.1.0";
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const MCP_TOOLS = [
  {
    name: "get_task_context",
    title: "Get task context",
    description:
      "Retrieve compact, source-cited architecture context for a task from one analyzed snapshot. Returns relevant components, typed relationships, source excerpts, snapshot identity, freshness limits, and an estimated token count. Read-only. Token counts are estimates, and the analyzed snapshot is not compared with the live working tree.",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        snapshotId: { type: "string", minLength: 1, maxLength: 200, description: "Analyzed snapshot identifier." },
        task: { type: "string", minLength: 1, maxLength: 2000, description: "Task or question to retrieve context for." },
        targetTokens: { type: "integer", minimum: 200, maximum: 12000, description: "Preferred estimated token budget." },
        maxTokens: { type: "integer", minimum: 500, maximum: 16000, description: "Hard estimated token ceiling." },
        depth: { type: "integer", minimum: 0, maximum: 3, description: "Dependency expansion depth." },
      },
      required: ["snapshotId", "task"],
      additionalProperties: false,
    },
  },
  {
    name: "inspect_symbol",
    title: "Inspect symbol",
    description:
      "Inspect an exact or lexically matched symbol and its direct relationships in one analyzed snapshot. Returns source-backed evidence and freshness status. Read-only.",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        snapshotId: { type: "string", minLength: 1, maxLength: 200, description: "Analyzed snapshot identifier." },
        symbol: { type: "string", minLength: 1, maxLength: 300, description: "Symbol name, file path, or lexical query." },
      },
      required: ["snapshotId", "symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "explore_dependencies",
    title: "Explore dependencies",
    description:
      "Explore bounded, typed dependencies around a symbol in one analyzed snapshot. Traversal depth and result counts are capped. Read-only.",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        snapshotId: { type: "string", minLength: 1, maxLength: 200, description: "Analyzed snapshot identifier." },
        symbol: { type: "string", minLength: 1, maxLength: 300, description: "Symbol name, file path, or lexical query." },
        depth: { type: "integer", minimum: 0, maximum: 3, description: "Dependency expansion depth." },
        maxNodes: { type: "integer", minimum: 1, maximum: 50, description: "Maximum graph nodes to return." },
        maxEdges: { type: "integer", minimum: 1, maximum: 80, description: "Maximum relationships to return." },
      },
      required: ["snapshotId", "symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "check_context_drift",
    title: "Check context drift",
    description:
      "Validate source reference IDs and line ranges against one authorized immutable analyzed snapshot. This checks stored evidence, not live working-tree files. Read-only.",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        snapshotId: { type: "string", minLength: 1, maxLength: 200, description: "Analyzed snapshot identifier." },
        referenceIds: {
          type: "array",
          maxItems: 100,
          items: { type: "string", minLength: 1, maxLength: 200 },
          description: "Source reference identifiers returned by another bridge tool.",
        },
      },
      required: ["snapshotId"],
      additionalProperties: false,
    },
  },
];

const INSTRUCTIONS =
  "Read-only Codebase Mentor context bridge backed by the Codebase Mentor API. " +
  "Call get_task_context first with a snapshotId and task; use inspect_symbol and explore_dependencies to drill into cited symbols. " +
  "Every response includes snapshot identity, source evidence, freshness status, and an estimated token count. " +
  "Token counts are estimates, not vendor tokenizer counts. The snapshot is pinned to the analyzed commit and is not compared with the live working tree. " +
  "The backend must be running and reachable at CODEBASE_MENTOR_API_URL.";

const allowedArguments = {
  get_task_context: ["snapshotId", "task", "targetTokens", "maxTokens", "depth"],
  inspect_symbol: ["snapshotId", "symbol"],
  explore_dependencies: ["snapshotId", "symbol", "depth", "maxNodes", "maxEdges"],
  check_context_drift: ["snapshotId", "referenceIds"],
};

function invalid(message) {
  return Object.assign(new Error(message), { status: 400, safe: true });
}

export async function invokeTool(name, args) {
  const allowed = allowedArguments[name];
  if (!allowed || !args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((key) => !allowed.includes(key)))
    throw invalid("Invalid tool arguments");
  if (typeof args.snapshotId !== "string" || !args.snapshotId || args.snapshotId.length > 200)
    throw invalid("snapshotId is required");
  for (const [key, low, high] of [["targetTokens", 200, 12000], ["maxTokens", 500, 16000], ["maxNodes", 1, 50], ["maxEdges", 1, 80], ["depth", 0, 3]])
    if (args[key] !== undefined && (!Number.isInteger(args[key]) || args[key] < low || args[key] > high))
      throw invalid(`Invalid ${key}`);
  if (name === "get_task_context" && (typeof args.task !== "string" || !args.task.trim() || args.task.length > 2000))
    throw invalid("Invalid task");
  if (["inspect_symbol", "explore_dependencies"].includes(name) && (typeof args.symbol !== "string" || !args.symbol.trim() || args.symbol.length > 300))
    throw invalid("Invalid symbol");
  if (name === "check_context_drift" && args.referenceIds !== undefined && (!Array.isArray(args.referenceIds) || args.referenceIds.length > 100 || args.referenceIds.some((id) => typeof id !== "string" || !id || id.length > 200)))
    throw invalid("Invalid referenceIds");
  switch (name) {
    case "get_task_context": {
      const { snapshotId, task, ...options } = args;
      return getTaskContext(snapshotId, task, options);
    }
    case "inspect_symbol":
      return inspectSymbol(args.snapshotId, args.symbol);
    case "explore_dependencies": {
      const { snapshotId, symbol, ...options } = args;
      return exploreDependencies(snapshotId, symbol, options);
    }
    case "check_context_drift":
      return checkContextDrift(args.snapshotId, args.referenceIds || []);
    default:
      throw invalid(`Unknown tool: ${name}`);
  }
}

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    isError: false,
  };
}

function toolError(error) {
  const safe = error?.safe === true || error?.status === 400 || error?.status === 404;
  if (!safe) console.error("[codebase-mentor-mcp] tool failed:", error?.message || error);
  return {
    content: [{ type: "text", text: safe ? error.message : "Agent Context Bridge could not complete the request." }],
    isError: true,
  };
}

export function createAgentContextMcpServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return toolResult(await invokeTool(request.params.name, request.params.arguments));
    } catch (error) {
      return toolError(error);
    }
  });

  return server;
}
