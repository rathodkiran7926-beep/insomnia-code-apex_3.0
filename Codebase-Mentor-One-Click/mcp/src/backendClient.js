import { getWorkspaceRepositoryUrl } from "./workspaceRepository.js";

const DEFAULT_API_URL = "http://127.0.0.1:3001";

function parseApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CODEBASE_MENTOR_API_URL must be an absolute HTTP(S) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("CODEBASE_MENTOR_API_URL must use http or https.");
  return url.toString().replace(/\/$/, "");
}

function parseTimeout(value) {
  const timeout = Number(value || 30_000);
  if (!Number.isInteger(timeout) || timeout < 1)
    throw new Error("CODEBASE_MENTOR_API_TIMEOUT_MS must be a positive integer.");
  return timeout;
}

export const backendConfig = {
  url: parseApiUrl(process.env.CODEBASE_MENTOR_API_URL || DEFAULT_API_URL),
  token: process.env.CODEBASE_MENTOR_API_TOKEN?.trim() || "",
  timeoutMs: parseTimeout(process.env.CODEBASE_MENTOR_API_TIMEOUT_MS),
};

class BackendError extends Error {
  constructor(message, { status, safe = false } = {}) {
    super(message);
    this.name = "BackendError";
    this.status = status;
    this.safe = safe;
  }
}

async function apiRequest(path, { method = "GET", body, timeoutMs = backendConfig.timeoutMs } = {}) {
  let response;
  try {
    response = await fetch(`${backendConfig.url}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(backendConfig.token ? { authorization: `Bearer ${backendConfig.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError";
    throw new BackendError(
      timedOut
        ? "Codebase Mentor backend timed out. Retry or raise CODEBASE_MENTOR_API_TIMEOUT_MS."
        : `Codebase Mentor backend is unreachable at ${backendConfig.url}. Start Codebase Mentor or check its local service configuration.`,
      { status: 503, safe: true },
    );
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new BackendError("Codebase Mentor backend returned an invalid response.", {
        status: 502,
        safe: true,
      });
    }
  }

  if (!response.ok) {
    const message = data?.error || `Codebase Mentor backend returned HTTP ${response.status}.`;
    if ([400, 401, 403, 404, 409, 422, 429].includes(response.status))
      throw new BackendError(message, { status: response.status, safe: true });
    throw new BackendError(`Codebase Mentor backend returned HTTP ${response.status}.`, {
      status: response.status,
    });
  }
  return data;
}

async function wait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function startRepositoryAnalysis(repositoryUrl) {
  console.error(`[codebase-mentor-mcp] no saved snapshot found; analyzing ${repositoryUrl}`);
  const started = await apiRequest("/api/analyses", {
    method: "POST",
    body: { url: repositoryUrl },
    timeoutMs: 15_000,
  });
  if (!started?.id) throw new BackendError("Codebase Mentor could not start repository analysis.", { safe: true });

  const analysisTimeout = Math.min(
    Math.max(Number(process.env.CODEBASE_MENTOR_ANALYSIS_TIMEOUT_MS) || 280_000, 10_000),
    295_000,
  );
  const deadline = Date.now() + analysisTimeout;
  let lastProgress = "Queued for analysis";
  while (Date.now() < deadline) {
    await wait(1500);
    const job = await apiRequest(`/api/analyses/${encodeURIComponent(started.id)}`, { timeoutMs: 10_000 });
    if (job?.message && job.message !== lastProgress) {
      lastProgress = job.message;
      console.error(`[codebase-mentor-mcp] ${job.progress || 0}% — ${job.message}`);
    }
    if (job?.status === "complete" && job.snapshot_id) return job.snapshot_id;
    if (job?.status === "failed")
      throw new BackendError(
        `Automatic repository analysis failed: ${job.message || "Unknown analysis error"}. The current analyzer supports public GitHub repositories.`,
        { safe: true },
      );
  }
  throw new BackendError(
    "Repository analysis is still running but exceeded the MCP wait limit. Retry the request; the analysis may have completed in the background.",
    { safe: true },
  );
}

const snapshotCache = new Map();

async function resolveSnapshotId(requestedSnapshotId) {
  if (requestedSnapshotId !== undefined && requestedSnapshotId !== null) {
    if (typeof requestedSnapshotId !== "string" || !requestedSnapshotId || requestedSnapshotId.length > 200)
      throw new BackendError("Invalid snapshotId.", { status: 400, safe: true });
    return requestedSnapshotId;
  }

  const repositoryUrl = getWorkspaceRepositoryUrl();
  const cacheKey = repositoryUrl || "__single_saved_repository__";
  const cached = snapshotCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < 30_000) return cached.snapshotId;

  const query = repositoryUrl ? `?repository=${encodeURIComponent(repositoryUrl)}` : "";
  try {
    const latest = await apiRequest(`/api/snapshots/latest${query}`, { timeoutMs: 10_000 });
    if (!latest?.snapshotId) throw new BackendError("Latest snapshot response was missing snapshotId.", { safe: true });
    snapshotCache.set(cacheKey, { snapshotId: latest.snapshotId, checkedAt: Date.now() });
    return latest.snapshotId;
  } catch (error) {
    if (error?.status !== 404) {
      if (!repositoryUrl && error?.status === 400) {
        throw new BackendError(
          "Codebase Mentor has multiple analyzed repositories, and the current workspace's GitHub origin could not be detected. Open the repository as the coding-agent workspace or set CODEBASE_MENTOR_REPOSITORY_URL.",
          { safe: true },
        );
      }
      if (!repositoryUrl && error?.status === 404) {
        throw new BackendError(
          "No analyzed repository snapshot exists and the current workspace's GitHub origin could not be detected. Open a public GitHub repository as the coding-agent workspace. The analyzer currently supports public GitHub repositories only.",
          { safe: true },
        );
      }
      throw error;
    }
    if (!repositoryUrl) {
      throw new BackendError(
        "No analyzed snapshot exists and Codebase Mentor could not detect a public GitHub origin from the current workspace. Open a public GitHub repository in your coding agent. Private/local repository analysis is not supported by the existing analyzer yet.",
        { safe: true },
      );
    }
    const snapshotId = await startRepositoryAnalysis(repositoryUrl);
    snapshotCache.set(repositoryUrl, { snapshotId, checkedAt: Date.now() });
    return snapshotId;
  }
}

async function request(snapshotId, suffix, body) {
  const id = await resolveSnapshotId(snapshotId);
  const endpoint = `/api/snapshots/${encodeURIComponent(id)}/agent-context${suffix}`;
  return apiRequest(endpoint, { method: "POST", body });
}

export function getTaskContext(snapshotId, task, options = {}) {
  return request(snapshotId, "", { task, ...options });
}

export function inspectSymbol(snapshotId, symbol) {
  return request(snapshotId, "/inspect-symbol", { symbol });
}

export function exploreDependencies(snapshotId, symbol, options = {}) {
  return request(snapshotId, "/explore-dependencies", { symbol, ...options });
}

export function checkContextDrift(snapshotId, referenceIds = []) {
  return request(snapshotId, "/check-drift", { referenceIds });
}
