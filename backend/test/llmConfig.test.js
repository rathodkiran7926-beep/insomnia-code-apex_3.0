import test from "node:test";
import assert from "node:assert/strict";
import { llmBaseUrl, llmHeaders, llmJsonMode, llmModel } from "../src/llmConfig.js";

const saved = Object.fromEntries(["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_JSON_MODE"].map((k) => [k, process.env[k]]));
const originalFetch = globalThis.fetch;
function reset() {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("OpenAI-compatible endpoint uses the configured ngrok host without exposing credentials", () => {
  try {
    process.env.LLM_BASE_URL = "https://studio-unmapped-vicinity.ngrok-free.dev/v1/";
    process.env.LLM_API_KEY = "fake-unit-test-key";
    process.env.LLM_JSON_MODE = "1";
    assert.equal(llmBaseUrl(), "https://studio-unmapped-vicinity.ngrok-free.dev/v1");
    assert.equal(llmHeaders().Authorization, "Bearer fake-unit-test-key");
    assert.equal(llmHeaders()["ngrok-skip-browser-warning"], "1");
    assert.deepEqual(llmJsonMode(), { response_format: { type: "json_object" } });
    process.env.LLM_JSON_MODE = "0";
    assert.deepEqual(llmJsonMode(), {});
    process.env.LLM_BASE_URL = "http://insecure.example/v1";
    assert.throws(llmBaseUrl, /HTTPS/);
  } finally { reset(); }
});

test("configured model ID is preserved; sole model is discovered when unspecified", async () => {
  try {
    process.env.LLM_BASE_URL = "https://studio-unmapped-vicinity.ngrok-free.dev/v1";
    process.env.LLM_API_KEY = "fake-unit-test-discovery";
    process.env.LLM_MODEL = "selected-model";
    assert.equal(await llmModel(), "selected-model");
    delete process.env.LLM_MODEL;
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(new URL(url).pathname, "/v1/models");
      assert.equal(options.headers["ngrok-skip-browser-warning"], "1");
      return new Response(JSON.stringify({ data: [{ id: "only-served-model" }] }));
    };
    assert.equal(await llmModel(), "only-served-model");
    assert.equal(await llmModel(), "only-served-model");
    assert.equal(calls, 1);
  } finally { reset(); }
});

test("ambiguous model listings require explicit LLM_MODEL", async () => {
  try {
    process.env.LLM_BASE_URL = "https://mock.llm.example/v1";
    process.env.LLM_API_KEY = "fake-ambiguous-model-test";
    delete process.env.LLM_MODEL;
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: "first" }, { id: "second" }] }));
    await assert.rejects(llmModel(), /multiple models.*LLM_MODEL/);
    process.env.LLM_MODEL = "second";
    assert.equal(await llmModel(), "second");
  } finally { reset(); }
});
