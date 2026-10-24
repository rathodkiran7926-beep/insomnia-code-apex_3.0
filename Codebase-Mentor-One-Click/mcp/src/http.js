import { timingSafeEqual } from "node:crypto";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const host = process.env.MCP_HTTP_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.MCP_HTTP_PORT || 3921);
const token = process.env.MCP_HTTP_TOKEN?.trim() || "";
const rateLimit = Number(process.env.MCP_HTTP_RATE_LIMIT || 120);
const maxConcurrent = Number(process.env.MCP_HTTP_MAX_CONCURRENT || 16);
const loopback = new Set(["127.0.0.1", "localhost", "::1"]);

function fail(message) {
  console.error(`[codebase-mentor-mcp] ${message}`);
  process.exit(1);
}

if (!Number.isInteger(port) || port < 0 || port > 65535) fail("MCP_HTTP_PORT must be an integer from 0 to 65535.");
if (!Number.isInteger(rateLimit) || rateLimit < 1) fail("MCP_HTTP_RATE_LIMIT must be a positive integer.");
if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) fail("MCP_HTTP_MAX_CONCURRENT must be a positive integer.");
if (token.length < 16)
  fail("MCP_HTTP_TOKEN is required and must be at least 16 characters. Set it in the server environment; never commit it.");
if (!loopback.has(host) && !process.env.MCP_HTTP_ALLOWED_ORIGINS?.trim())
  console.error("[codebase-mentor-mcp] warning: non-loopback binding without MCP_HTTP_ALLOWED_ORIGINS. Requests with an Origin header will be rejected.");

const allowedOrigins = new Set([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  `http://[::1]:${port}`,
  ...(process.env.MCP_HTTP_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
]);

let createAgentContextMcpServer;
try {
  ({ createAgentContextMcpServer } = await import("./server.js"));
} catch (error) {
  fail(`failed to load the context bridge: ${error?.message || error}`);
}

const expectedAuthorization = Buffer.from(`Bearer ${token}`);
const hits = new Map();
let active = 0;
const app = express();
app.disable("x-powered-by");

function originAllowed(req) {
  const origin = req.get("origin");
  return !origin || allowedOrigins.has(origin);
}

function authorized(req) {
  const provided = Buffer.from(req.get("authorization") || "");
  return provided.length === expectedAuthorization.length && timingSafeEqual(provided, expectedAuthorization);
}

function limited(req, res, next) {
  const key = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.start >= 60_000) {
    hits.set(key, { start: now, count: 1 });
    return next();
  }
  entry.count++;
  if (entry.count > rateLimit) {
    res.set("Retry-After", String(Math.max(1, Math.ceil((entry.start + 60_000 - now) / 1000))));
    return res.status(429).json({ jsonrpc: "2.0", error: { code: -32000, message: "Too many requests" } });
  }
  next();
}

const cleanupHits = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) if (now - entry.start >= 60_000) hits.delete(key);
}, 60_000);
cleanupHits.unref();

app.get("/healthz", (_req, res) =>
  res.json({ ok: true, server: "codebase-mentor-agent-context-bridge", transport: "streamable-http" }),
);

app.use("/mcp", (req, res, next) => {
  if (!originAllowed(req))
    return res.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: "Origin not allowed" } });
  next();
});
app.use("/mcp", (req, res, next) => {
  if (!authorized(req))
    return res
      .status(401)
      .set("WWW-Authenticate", 'Bearer realm="codebase-mentor-mcp"')
      .json({ jsonrpc: "2.0", error: { code: -32000, message: "Unauthorized" } });
  next();
});
app.use("/mcp", limited);
app.use("/mcp", (req, res, next) => {
  if (req.method === "POST" && !req.is("application/json"))
    return res.status(415).json({ jsonrpc: "2.0", error: { code: -32000, message: "Content-Type must be application/json" } });
  next();
});
app.use("/mcp", express.json({ limit: "1mb", strict: true }));

app.post("/mcp", async (req, res) => {
  if (active >= maxConcurrent)
    return res.status(503).set("Retry-After", "1").json({ jsonrpc: "2.0", error: { code: -32000, message: "Server busy" } });
  active++;
  const server = createAgentContextMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    void server.close().catch(() => {});
    void transport.close().catch(() => {});
  };
  res.on("close", cleanup);
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[codebase-mentor-mcp] HTTP request failed:", error?.message || error);
    if (!res.headersSent)
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" } });
  } finally {
    active--;
    if (res.writableEnded) cleanup();
  }
});

app.all("/mcp", (_req, res) =>
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Only POST is supported" } }),
);

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  const tooLarge = error?.type === "entity.too.large";
  res
    .status(tooLarge ? 413 : 400)
    .json({ jsonrpc: "2.0", error: { code: -32700, message: tooLarge ? "Request body too large" : "Invalid JSON request" } });
});

const httpServer = app.listen(port, host, () => {
  const address = httpServer.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  for (const origin of [`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`, `http://[::1]:${actualPort}`])
    allowedOrigins.add(origin);
  console.error(`[codebase-mentor-mcp] Streamable HTTP listening on http://${host}:${actualPort}/mcp`);
});
httpServer.requestTimeout = 60_000;
httpServer.headersTimeout = 10_000;
httpServer.keepAliveTimeout = 5_000;
httpServer.on("error", (error) => {
  console.error(`[codebase-mentor-mcp] HTTP server failed: ${error.message}`);
  process.exit(1);
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
