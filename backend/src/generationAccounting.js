import { createHash } from "node:crypto";

const features = new Set(["practice_tasks", "generated_guides"]);
const records = [];
let sequence = 0;
const append = (value) => {
  records.push(value);
  if (records.length > 500) records.shift();
};
const unknownTokens = () => ({ input: "unknown", output: "unknown", total: "unknown" });
function providerTokens(raw) {
  try {
    const usage = JSON.parse(raw).usage;
    const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : "unknown";
    return {
      input: count(usage?.prompt_tokens ?? usage?.input_tokens),
      output: count(usage?.completion_tokens ?? usage?.output_tokens),
      total: count(usage?.total_tokens),
    };
  } catch { return unknownTokens(); }
}
function errorCategory(error, fallback) {
  try {
    const status = error?.remoteStatus ?? error?.cause?.remoteStatus;
    if (status === 429) return "rate_limit";
    if (status === 401 || status === 403) return "provider_access";
    if ([500, 502, 503, 504].includes(status)) return "provider_unavailable";
    if (error?.status === 429) return "capacity";
    if (error?.status === 503) return "unavailable";
    if (error?.name === "SyntaxError" || error?.name === "ZodError") return "invalid_output";
  } catch { /* Never inspect or record provider error messages. */ }
  return fallback;
}

// Diagnostic accounting only: no queue, retries, timeouts or concurrency leases.
// Feature-specific caches/admission limits retain ownership of their behavior.
export function createGenerationAccounting({ record = append, clock = () => performance.now() } = {}) {
  const emit = (feature, key, fields) => {
    try {
      if (!features.has(feature) || typeof key !== "string") return;
      const workKey = createHash("sha256").update(`${feature}:${key}`).digest("hex");
      const result = record({ sequence: ++sequence, feature, workKey, ...fields });
      // An optional asynchronous diagnostic sink must never block generation.
      if (result?.then) Promise.resolve(result).catch(() => {});
    } catch { /* Instrumentation is always best effort. */ }
  };
  const time = () => { try { const value = clock(); return Number.isFinite(value) ? value : null; } catch { return null; } };
  return {
    cache(feature, key, status) {
      if (["hit", "miss", "coalesced"].includes(status)) emit(feature, key, { kind: "cache", status });
    },
    error(feature, key, error, category) {
      emit(feature, key, {
        kind: "generation_error",
        errorCategory: ["invalid_output", "storage", "evidence"].includes(category) ? category : errorCategory(error, "transport"),
      });
    },
    async attempt(feature, key, request) {
      const start = time();
      const duration = () => { const end = time(); return start === null || end === null ? "unknown" : Math.max(0, end - start); };
      try {
        const raw = await request();
        // Transport completion is separate from the caller's output validation.
        emit(feature, key, { kind: "attempt", status: "success", durationMs: duration(), tokens: providerTokens(raw) });
        return raw;
      } catch (error) {
        emit(feature, key, { kind: "attempt", status: "error", durationMs: duration(), tokens: unknownTokens(), errorCategory: errorCategory(error, "transport") });
        throw error;
      }
    },
  };
}

export const generationAccounting = createGenerationAccounting();
// Internal diagnostics, deliberately separate from product APIs and persistence.
export const generationUsage = () => structuredClone(records);
