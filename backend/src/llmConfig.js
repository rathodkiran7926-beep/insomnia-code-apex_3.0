// One OpenAI-compatible provider for all backend AI features. Keep credentials server-side.
import { boundedFetch } from "./github.js";

const DEFAULT_BASE_URL = "https://studio-unmapped-vicinity.ngrok-free.dev/v1";
let cachedModel;

export function llmBaseUrl() {
  const url = new URL((process.env.LLM_BASE_URL || DEFAULT_BASE_URL).trim());
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("LLM_BASE_URL must be an HTTPS URL without credentials or query parameters");
  return url.href.replace(/\/+$/, "");
}

export function llmHeaders() {
  const hostname = new URL(llmBaseUrl()).hostname;
  return {
    Authorization: `Bearer ${process.env.LLM_API_KEY || ""}`,
    "Content-Type": "application/json",
    ...(hostname.endsWith(".ngrok-free.dev")
      ? { "ngrok-skip-browser-warning": "1" }
      : {}),
  };
}

export function llmJsonMode() {
  // Some OpenAI-compatible local servers don't implement JSON response_format.
  // Keep schema/citation validation in callers even when this is disabled.
  return process.env.LLM_JSON_MODE === "0" ? {} : { response_format: { type: "json_object" } };
}

export async function llmModel() {
  const configured = process.env.LLM_MODEL?.trim();
  if (configured && configured !== "auto") return configured;
  if (!process.env.LLM_API_KEY)
    throw new Error("Set LLM_API_KEY in backend/.env");
  const base = llmBaseUrl();
  const key = process.env.LLM_API_KEY;
  if (!cachedModel || cachedModel.base !== base || cachedModel.key !== key) {
    const promise = (async () => {
      const body = JSON.parse(await boundedFetch(`${base}/models`, {
        limit: 64000,
        headers: llmHeaders(),
      }));
      const models = [...new Set((Array.isArray(body.data) ? body.data : [])
        .map((item) => item?.id)
        .filter((id) => typeof id === "string" && id.length > 0 && id.length <= 200))];
      if (models.length !== 1)
        throw new Error(
          models.length === 0
            ? "The provider returned no model IDs. Set LLM_MODEL in backend/.env."
            : "The provider offers multiple models. Set LLM_MODEL to the intended model ID in backend/.env.",
        );
      return models[0];
    })();
    cachedModel = { base, key, promise };
  }
  try {
    return await cachedModel.promise;
  } catch (error) {
    cachedModel = undefined; // transient /models failures may be retried
    throw error;
  }
}
