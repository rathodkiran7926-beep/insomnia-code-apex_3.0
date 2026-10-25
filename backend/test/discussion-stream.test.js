import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import {
  streamSpeech,
  createSpeech,
  transcribe,
  availableVoices,
} from "../src/discussionVoice.js";

test("provider speech streams bytes, validates voice IDs, and propagates cancellation", async () => {
  const original = globalThis.fetch;
  const originalKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "isolated-stream-test";
  const requests = [];
  let fail = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/v2/voices"))
      return Response.json({
        voices: [{ voice_id: "selected-voice", name: "Selected voice" }],
        has_more: false,
      });
    requests.push({ url, options });
    if (fail) return new Response("private provider details", { status: 429 });
    return new Response(new Uint8Array([73, 68, 51, 1]), {
      headers: { "Content-Type": "audio/mpeg" },
    });
  };
  function destination() {
    const chunks = [];
    const res = new Writable({
      write(chunk, _encoding, done) {
        chunks.push(chunk);
        done();
      },
    });
    res.headers = {};
    res.type = (type) => {
      res.headers.type = type;
      return res;
    };
    res.set = (name, value) => {
      res.headers[name] = value;
      return res;
    };
    return { res, chunks };
  }
  try {
    const controller = new AbortController();
    const { res, chunks } = destination();
    await streamSpeech(
      "selected-voice",
      "A source-backed explanation.",
      res,
      controller.signal,
    );
    assert.equal(res.headers["X-Voice-Stream"], "1");
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.deepEqual(Buffer.concat(chunks), Buffer.from([73, 68, 51, 1]));
    assert.match(
      requests[0].url,
      /selected-voice\/stream\?output_format=mp3_44100_128$/,
    );
    assert.equal(
      JSON.parse(requests[0].options.body).text,
      "A source-backed explanation.",
    );
    controller.abort();
    assert.equal(requests[0].options.signal.aborted, true);
    await assert.rejects(
      streamSpeech(
        "invented",
        "No",
        destination().res,
        new AbortController().signal,
      ),
      /unavailable/,
    );
    assert.equal(requests.length, 1);
    fail = true;
    await assert.rejects(
      streamSpeech(
        "selected-voice",
        "No",
        destination().res,
        new AbortController().signal,
      ),
      /HTTP 429/,
    );
  } finally {
    globalThis.fetch = original;
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalKey;
  }
});

test("missing voice permissions are distinguished from invalid credentials without leaking provider data", async () => {
  const original = globalThis.fetch;
  const originalKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "  permission-test-key  ";
  let code = "missing_permissions";
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers["xi-api-key"], "permission-test-key");
    if (String(url).includes("/v2/voices"))
      return Response.json({
        voices: [{ voice_id: "permitted-voice", name: "Voice" }],
        has_more: false,
      });
    requests++;
    return Response.json(
      {
        detail: {
          status: code,
          message: "private provider and account details",
        },
      },
      { status: 401 },
    );
  };
  const permission = (name) => (error) => {
    assert.match(error.message, new RegExp(`lacks ${name} permission`));
    assert.match(error.message, /restart the backend/);
    assert.doesNotMatch(
      error.message,
      /private provider|permission-test-key|rejected the API key/,
    );
    return true;
  };
  try {
    await assert.rejects(
      streamSpeech(
        "permitted-voice",
        "Hello",
        {},
        new AbortController().signal,
      ),
      permission("Text to Speech"),
    );
    await assert.rejects(
      createSpeech("permitted-voice", "Hello"),
      permission("Text to Speech"),
    );
    const wav = Buffer.alloc(44);
    wav.write("RIFF", 0);
    wav.write("WAVE", 8);
    await assert.rejects(
      transcribe(wav, "audio/wav", 1),
      permission("Speech to Text"),
    );
    code = "invalid_api_key";
    await assert.rejects(
      createSpeech("permitted-voice", "Hello"),
      /rejected the API key/,
    );
    assert.equal(requests, 4, "Authentication failures are never retried");
    process.env.ELEVENLABS_API_KEY = "   ";
    await assert.rejects(
      availableVoices(),
      /Voice requires ELEVENLABS_API_KEY/,
    );
    assert.equal(requests, 4);
  } finally {
    globalThis.fetch = original;
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalKey;
  }
});
