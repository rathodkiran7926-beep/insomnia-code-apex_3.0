import http from "node:http";
import { once } from "node:events";

const commit = "a".repeat(40);
const repository = "https://github.com/example/mcp-fixture";

function identity(snapshotId) {
  return { snapshotId, repository, commit };
}

function context(snapshotId) {
  return {
    identity: identity(snapshotId),
    query: "trace handleRequest into loadAccount",
    nodes: [
      { id: "c-handler", name: "handleRequest", role: "handler", match: "exact" },
      { id: "c-service", name: "loadAccount", role: "service", match: "lexical" },
    ],
    relationships: [{ id: "e-call", source: "c-handler", target: "c-service", type: "calls", referenceId: "r-service" }],
    evidence: [
      {
        referenceId: "r-handler",
        referenceIds: ["r-handler"],
        file: "src/handler.js",
        startLine: 1,
        endLine: 3,
        excerpt: "export function handleRequest() {}",
        excerptStatus: "stored_snapshot_source",
      },
      {
        referenceId: "r-service",
        referenceIds: ["r-service"],
        file: "src/service.js",
        startLine: 1,
        endLine: 3,
        excerpt: "export function loadAccount() {}",
        excerptStatus: "stored_snapshot_source",
      },
    ],
    freshness: "snapshot_consistent_live_unverified",
    tokenEstimate: 321,
    truncated: false,
    cache: { hit: false },
  };
}

function responseFor(pathname, body, method = "POST") {
  if (pathname === "/api/snapshots/latest" && method === "GET")
    return { status: 200, value: { snapshotId: "snapshot-one", repository, commit } };
  const match = pathname.match(/^\/api\/snapshots\/([^/]+)\/agent-context(?:\/(inspect-symbol|explore-dependencies|check-drift))?$/);
  if (!match) return { status: 404, value: { error: "API route not found" } };
  const snapshotId = decodeURIComponent(match[1]);
  if (snapshotId === "missing") return { status: 404, value: { error: "Snapshot not found" } };
  const operation = match[2];
  if (!operation) return { status: 200, value: context(snapshotId) };
  if (operation === "inspect-symbol") {
    return {
      status: 200,
      value: {
        ...context(snapshotId),
        nodes: [{ id: "c-handler", name: body.symbol, role: "handler", match: "exact" }],
        relationships: [],
        evidence: [context(snapshotId).evidence[0]],
        tokenEstimate: 120,
      },
    };
  }
  if (operation === "explore-dependencies") {
    return {
      status: 200,
      value: {
        ...context(snapshotId),
        evidence: [context(snapshotId).evidence[1]],
        tokenEstimate: 180,
      },
    };
  }
  const referenceIds = Array.isArray(body.referenceIds) ? body.referenceIds : [];
  const missingReferenceIds = referenceIds.filter((id) => id === "missing-reference");
  return {
    status: 200,
    value: {
      identity: identity(snapshotId),
      status: missingReferenceIds.length ? "stale_or_invalid_evidence" : "snapshot_consistent_live_unverified",
      checkedReferences: referenceIds.length - missingReferenceIds.length,
      missingReferenceIds,
      invalidCoordinateIds: [],
      unavailableSourceIds: [],
      message: "References are checked against the stored analyzed snapshot.",
    },
  };
}

export async function startFakeBackend({ token = "" } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON request" }));
        return;
      }
      requests.push({ method: req.method, path: req.url, headers: req.headers, body });
      if (token && req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const result = responseFor(new URL(req.url, "http://fake-backend").pathname, body, req.method);
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(JSON.stringify(result.value));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
