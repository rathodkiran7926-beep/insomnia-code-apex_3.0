// Sends only a tiny diagnostic prompt, never repository contents or credentials in logs.
const base = (process.env.LLM_BASE_URL ||
  "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, "");
const key = process.env.LLM_API_KEY?.trim();
const model = process.env.LLM_MODEL?.trim();
function redact(value) {
  let text = String(value);
  for (const name of ["LLM_API_KEY", "GITHUB_TOKEN", "ELEVENLABS_API_KEY"])
    if (process.env[name]) text = text.replaceAll(process.env[name], "[REDACTED]");
  return text;
}
if (!key || !model) {
  console.error("Set LLM_API_KEY and LLM_MODEL in backend/.env, then retry.");
  process.exitCode = 1;
} else {
  try {
    const endpoint = new URL(`${base}/chat/completions`);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
      throw new Error("LLM_BASE_URL must be an HTTPS URL without embedded credentials.");
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
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
