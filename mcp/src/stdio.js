import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

let server;
let transport;

try {
  const { ensureBackendRunning } = await import("./backendLifecycle.js");
  await ensureBackendRunning();
  const { createAgentContextMcpServer } = await import("./server.js");
  server = createAgentContextMcpServer();
  transport = new StdioServerTransport();
  transport.onerror = (error) => console.error("[codebase-mentor-mcp] transport error:", error.message);
  await server.connect(transport);
  console.error("[codebase-mentor-mcp] stdio server ready");
} catch (error) {
  console.error(`[codebase-mentor-mcp] failed to start: ${error?.message || error}`);
  process.exit(1);
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try {
    await server?.close();
  } catch (error) {
    console.error("[codebase-mentor-mcp] shutdown error:", error?.message || error);
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
