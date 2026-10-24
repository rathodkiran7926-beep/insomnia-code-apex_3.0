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

async function request(snapshotId, suffix, body) {
  const endpoint = `${backendConfig.url}/api/snapshots/${encodeURIComponent(snapshotId)}/agent-context${suffix}`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(backendConfig.token ? { authorization: `Bearer ${backendConfig.token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(backendConfig.timeoutMs),
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError";
    throw new BackendError(
      timedOut
        ? "Codebase Mentor backend timed out. Retry or raise CODEBASE_MENTOR_API_TIMEOUT_MS."
        : `Codebase Mentor backend is unreachable at ${backendConfig.url}. Start the backend or set CODEBASE_MENTOR_API_URL.`,
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
    if (response.status === 400 || response.status === 404) {
      throw new BackendError(data?.error || "Invalid Codebase Mentor request.", {
        status: response.status,
        safe: true,
      });
    }
    if (response.status === 401 || response.status === 403) {
      throw new BackendError(
        "Codebase Mentor backend rejected the request. Check CODEBASE_MENTOR_API_TOKEN.",
        { status: response.status, safe: true },
      );
    }
    if (response.status === 429) {
      throw new BackendError("Codebase Mentor backend is busy. Try again shortly.", {
        status: 429,
        safe: true,
      });
    }
    throw new BackendError(`Codebase Mentor backend returned HTTP ${response.status}.`, {
      status: response.status,
    });
  }

  return data;
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
