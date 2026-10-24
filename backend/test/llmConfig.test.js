import test from "node:test";
import assert from "node:assert/strict";
import { llmConfig } from "../src/llmConfig.js";

test("every compatible provider setting can change without an import-time cache or duplicated v1 path", () => {
  const names = ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY"];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    for (const name of names) delete process.env[name];
    assert.equal(llmConfig().model, "qwen2.5-codebase:latest");
    assert.equal(llmConfig().apiKey, "");
    assert.equal(
      llmConfig().endpoint,
      "https://studio-unmapped-vicinity.ngrok-free.dev/v1/chat/completions",
    );
    process.env.LLM_BASE_URL = " https://test-model.invalid/v1/// ";
    process.env.LLM_MODEL = " alternate-code-model ";
    process.env.LLM_API_KEY = " test-only-key ";
    assert.deepEqual(llmConfig(), {
      baseUrl: "https://test-model.invalid/v1",
      endpoint: "https://test-model.invalid/v1/chat/completions",
      model: "alternate-code-model",
      apiKey: "test-only-key",
    });
    process.env.LLM_MODEL = "another-model";
    assert.equal(llmConfig().model, "another-model");
  } finally {
    for (const name of names)
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
  }
});
