// Shared OpenAI-compatible configuration for every text-generation feature.
// Credentials are read at request time and never included in public responses.
export function llmConfig() {
  const baseUrl = (
    process.env.LLM_BASE_URL?.trim() ||
    "https://studio-unmapped-vicinity.ngrok-free.dev/v1"
  ).replace(/\/+$/, "");
  return {
    baseUrl,
    endpoint: `${baseUrl}/chat/completions`,
    model: process.env.LLM_MODEL?.trim() || "qwen2.5-codebase:latest",
    apiKey: process.env.LLM_API_KEY?.trim() || "",
  };
}
