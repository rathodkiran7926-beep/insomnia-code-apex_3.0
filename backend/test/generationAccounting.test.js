import test from "node:test";
import assert from "node:assert/strict";
import { createGenerationAccounting, generationAccounting, generationUsage } from "../src/generationAccounting.js";

test("attempt accounting preserves responses and records only whitelisted usage and hashed work identities", async () => {
  const records = [];
  let time = 10;
  const accounting = createGenerationAccounting({ record: (value) => records.push(value), clock: () => time });
  const secret = "private-source-and-chat-sk-abcdefghijklmnopqrstuvwxyz";
  const raw = JSON.stringify({ choices: [{ message: { content: secret } }],
    usage: { prompt_tokens: 17, completion_tokens: 5, total_tokens: 22, private_metadata: secret } });
  const result = await accounting.attempt("practice_tasks", secret, async () => { time += 7; return raw; });
  assert.equal(result, raw);
  accounting.cache("practice_tasks", secret, "hit");
  accounting.error("practice_tasks", secret, new Error(secret), "invalid_output");
  assert.equal(records.length, 3);
  assert.deepEqual(records[0].tokens, { input: 17, output: 5, total: 22 });
  assert.equal(records[0].durationMs, 7);
  assert.equal(records[0].kind, "attempt");
  assert.equal(records[0].status, "success");
  assert.equal(records[1].status, "hit");
  assert.equal(records[2].errorCategory, "invalid_output");
  assert.match(records[0].workKey, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(records), /private-source|chat-sk-|private_metadata|choices|message|content/);
  assert(records.every((row) => Object.keys(row).every((key) =>
    ["sequence", "feature", "workKey", "kind", "status", "durationMs", "tokens", "errorCategory"].includes(key))));
});

test("absent and invalid token counts stay unknown while genuinely reported zero is preserved", async () => {
  const records = [];
  const accounting = createGenerationAccounting({ record: (value) => records.push(value) });
  for (const raw of ["{}", "invalid JSON", JSON.stringify({ usage: { prompt_tokens: -1, completion_tokens: "5", total_tokens: null } })])
    await accounting.attempt("generated_guides", "work", async () => raw);
  for (const record of records) assert.deepEqual(record.tokens, { input: "unknown", output: "unknown", total: "unknown" });
  await accounting.attempt("generated_guides", "work", async () => JSON.stringify({ usage: { prompt_tokens: 0, completion_tokens: 2 } }));
  assert.deepEqual(records.at(-1).tokens, { input: 0, output: 2, total: "unknown" });
});

test("provider failures are counted once per attempt without adding retries or changing the thrown error", async () => {
  const records = [];
  const accounting = createGenerationAccounting({ record: (value) => records.push(value) });
  const error = Object.assign(new Error("sensitive provider details"), { remoteStatus: 503 });
  let calls = 0;
  await assert.rejects(accounting.attempt("practice_tasks", "work", async () => { calls++; throw error; }), (caught) => caught === error);
  assert.equal(calls, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "error");
  assert.equal(records[0].errorCategory, "provider_unavailable");
  assert.deepEqual(records[0].tokens, { input: "unknown", output: "unknown", total: "unknown" });
  assert.doesNotMatch(JSON.stringify(records), /sensitive provider details/);
  accounting.error("practice_tasks", "work", new SyntaxError("private malformed output"));
  assert.equal(records.at(-1).errorCategory, "invalid_output");
  accounting.error("practice_tasks", "work", Object.assign(new Error("private network error"), { code: "ECONNRESET" }));
  assert.equal(records.at(-1).errorCategory, "transport");
});

test("sync/async telemetry failures and clock failures cannot fail or delay generation", async () => {
  for (const record of [() => { throw new Error("sink failed"); }, async () => { throw new Error("async sink failed"); }]) {
    const accounting = createGenerationAccounting({ record, clock: () => { throw new Error("clock failed"); } });
    assert.equal(await accounting.attempt("practice_tasks", "work", async () => "response"), "response");
    assert.doesNotThrow(() => accounting.cache("practice_tasks", "work", "miss"));
    assert.doesNotThrow(() => accounting.error("practice_tasks", "work", new Error("provider failed")));
  }
});

test("accounting adds no queue, shared permit, or duplicate provider execution", async () => {
  const accounting = createGenerationAccounting({ record: () => {} });
  let firstFinish, secondFinish, calls = 0;
  const first = accounting.attempt("practice_tasks", "a", () => { calls++; return new Promise((resolve) => { firstFinish = resolve; }); });
  const second = accounting.attempt("generated_guides", "b", () => { calls++; return new Promise((resolve) => { secondFinish = resolve; }); });
  assert.equal(calls, 2);
  secondFinish("second");
  assert.equal(await second, "second");
  firstFinish("first");
  assert.equal(await first, "first");
  assert.equal(calls, 2);
});

test("default diagnostic records remain bounded and cannot be mutated through the reader", () => {
  for (let i = 0; i < 510; i++) generationAccounting.cache("practice_tasks", `key-${i}`, "hit");
  const records = generationUsage();
  assert.equal(records.length, 500);
  records[0].status = "tampered";
  assert.equal(generationUsage()[0].status, "hit");
});
