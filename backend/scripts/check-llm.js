// Sends only a tiny diagnostic prompt, never repository contents or credentials in logs.
import { llmBaseUrl, llmHeaders, llmModel } from "../src/llmConfig.js";
const key = process.env.LLM_API_KEY?.trim();
function redact(value) {
  let text = String(value);
  for (const name of ["LLM_API_KEY", "GITHUB_TOKEN", "ELEVENLABS_API_KEY"])
    if (process.env[name]) text = text.replaceAll(process.env[name], "[REDACTED]");
  return text;
}
if (!key) {
  console.error("Set LLM_API_KEY in backend/.env, then retry.");
  process.exitCode = 1;
} else {
  try {
    const model = await llmModel();
    const endpoint = new URL(`${llmBaseUrl()}/chat/completions`);
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: llmHeaders(),
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply OK." }], max_tokens: 16 }),
    });
    if (response.ok) {
      console.log(`LLM connection OK (${model}).`);
      await response.body?.cancel();
    } else {
      const body = await response.json().catch(() => ({}));
      console.error(`LLM check failed (HTTP ${response.status}): ${redact(body.error?.message || response.statusText)}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`LLM connection failed: ${redact(error.cause?.code || error.message)}`);
    process.exitCode = 1;
  }
}
