import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_PATH = ":memory:";
const { db, saveSnapshot } = await import("../src/storage.js");
const { analyze } = await import("../src/analyzer.js");
const {
  discussion,
  startDiscussion,
  discussionContext,
  discussionTurn,
  validateReply,
  draftDecision,
  saveDecision,
  sessionView,
  scopedEvidence,
} = await import("../src/discussion.js");
const { availableVoices, createSpeech, transcribe, checkAudio } =
  await import("../src/discussionVoice.js");
test("voice failures distinguish blocked networking from provider access and rate limits", async () => {
  const original = globalThis.fetch;
  const credential = process.env.ELEVENLABS_API_KEY;
  try {
    process.env.ELEVENLABS_API_KEY = "voice-error-test";
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed", { cause: { code: "EACCES" } });
    };
    await assert.rejects(
      availableVoices(),
      /blocked \(EACCES\).*normal terminal/,
    );
    for (const [status, message] of [
      [401, /rejected the API key/],
      [403, /permissions/],
      [429, /limit reached/],
    ]) {
      globalThis.fetch = async () => new Response("{}", { status });
      await assert.rejects(availableVoices(), message);
    }
  } finally {
    globalThis.fetch = original;
    if (credential === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = credential;
  }
});
const files = {
  "limiter.ts": `// Token bucket (author comment, not proof).
const counts = new Map<string,number>();
setInterval(() => counts.clear(), 60000);
export function limit(req,res,next) {
 const count=(counts.get(req.ip)||0)+1; counts.set(req.ip,count);
 if(count>10) return res.status(429).send('Try later');
 next();
}`,
  "app.ts": `import express from 'express';import {limit} from './limiter';export const app=express();app.use(limit);`,
  "limiter.test.ts": `import {limit} from './limiter';export function testLimit(){ return limit; }`,
  "unrelated.ts": `export function unrelated(){return 'not evidence';}`,
};
const graph = analyze({
  repository: "https://github.com/example/rate",
  commit: "a".repeat(40),
  files,
});
saveSnapshot(graph, {}, "", files);
const component = graph.components.find(
  (c) => c.name === "limit" && c.role !== "module",
);
const reply = () => ({
  spokenText:
    "This resets counters periodically; it is not proven to be a classic token bucket. Each process can have its own Map.",
  displayText:
    "The implementation increments a process-memory counter and periodically clears its Map. There is no supplied evidence of a shared multi-instance quota.",
  claims: [
    {
      text: "The containing file initializes a Map and periodically clears it.",
      evidenceIds: [
        graph.components.find(
          (c) => c.role === "module" && c.name.includes("limiter.ts"),
        ).referenceId,
      ],
    },
  ],
  alternatives: [],
  followUpQuestion:
    "Will this run in one process or multiple backend instances?",
  uncertainties: ["Deployment topology is not established by the source."],
  memory: {
    summary:
      "User is exploring a periodic counter limiter. Deployment is unknown.",
    requirements: ["No extra infrastructure"],
    rejectedAlternatives: ["Redis not yet acceptable"],
    openQuestions: ["Deployment topology"],
  },
});
async function fakeGemini(fn, run) {
  const original = globalThis.fetch,
    key = process.env.LLM_API_KEY,
    model = process.env.LLM_MODEL;
  process.env.LLM_API_KEY = "test";
  process.env.LLM_MODEL = "configured-test-model";
  globalThis.fetch = fn;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
    if (model === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = model;
  }
}
const jsonResponse = (value) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(value) } }],
    }),
  );

test("discussion is bound to the selected component/snapshot and includes counter storage/reset evidence", async () => {
  const view = startDiscussion(graph, component.id),
    context = await discussionContext(discussion(view.id));
  assert.equal(view.snapshotId, graph.snapshotId);
  assert.equal(view.componentId, component.id);
  assert.match(context.containingFileContext.content, /new Map/);
  assert.match(context.containingFileContext.content, /counts.clear/);
  assert(context.references.every((r) => r.snapshotId === graph.snapshotId));
  assert(JSON.stringify(context).length < 80000);
  const unrelated = graph.components.find((c) => c.name === "unrelated");
  await assert.rejects(
    scopedEvidence(discussion(view.id), unrelated.referenceId),
    (e) => e.status === 403,
  );
  assert.throws(
    () =>
      validateReply(
        {
          ...reply(),
          claims: [{ text: "Fake", evidenceIds: ["other-snapshot"] }],
        },
        context.references,
      ),
    /Unknown source/,
  );
});
test("Gemini uses configured model, supplied evidence, rolling memory, and bounded history", async () => {
  const view = startDiscussion(graph, component.id);
  await fakeGemini(
    async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.model, "configured-test-model");
      assert.match(
        body.messages[0].content,
        /not automatically a classic token bucket/,
      );
      assert.match(body.messages[1].content, /counts.clear/);
      assert(body.messages.length <= 15);
      return jsonResponse(reply());
    },
    async () => {
      const result = await discussionTurn(view.id, "What algorithm is this?");
      assert.equal(result.componentId, component.id);
      assert(
        result.answer.citations.every((c) => c.url.includes(graph.commit)),
      );
      for (let i = 0; i < 7; i++)
        await discussionTurn(view.id, "What about multiple instances?");
      assert.equal(sessionView(discussion(view.id)).messages.length, 16);
      assert(
        discussion(view.id).memory.requirements.includes(
          "No extra infrastructure",
        ),
      );
    },
  );
});
test("temporary Gemini overload retries once and persists a single conversation turn", async () => {
  const view = startDiscussion(graph, component.id);
  let attempts = 0;
  await fakeGemini(
    async () =>
      ++attempts === 1
        ? new Response("", { status: 503 })
        : jsonResponse(reply()),
    async () => {
      await discussionTurn(view.id, "Explain this implementation");
      assert.equal(attempts, 2);
      assert.equal(sessionView(discussion(view.id)).messages.length, 2);
    },
  );
});

test("Gemini authentication failures are not retried", async () => {
  const view = startDiscussion(graph, component.id);
  let attempts = 0;
  await fakeGemini(
    async () => {
      attempts++;
      return new Response("", { status: 401 });
    },
    async () => {
      await assert.rejects(discussionTurn(view.id, "Explain"), /credentials/);
      assert.equal(attempts, 1);
      assert.equal(sessionView(discussion(view.id)).messages.length, 0);
    },
  );
});

test("ending a discussion request cancels a pending overload retry", async () => {
  const view = startDiscussion(graph, component.id);
  const controller = new AbortController();
  let attempts = 0;
  await fakeGemini(
    async () => {
      attempts++;
      controller.abort();
      return new Response("", { status: 503 });
    },
    async () => {
      await assert.rejects(
        discussionTurn(view.id, "Explain", controller.signal),
        (error) => error.status === 499,
      );
      assert.equal(attempts, 1);
      assert.equal(sessionView(discussion(view.id)).messages.length, 0);
    },
  );
});

test("invalid evidence and provider failures never create fabricated conversation messages", async () => {
  const view = startDiscussion(graph, component.id);
  await fakeGemini(
    async () =>
      jsonResponse({
        ...reply(),
        claims: [{ text: "Unfounded", evidenceIds: ["made-up"] }],
      }),
    async () => {
      await assert.rejects(
        discussionTurn(view.id, "Explain"),
        (e) => e.status === 502,
      );
      assert.equal(sessionView(discussion(view.id)).messages.length, 0);
    },
  );
  await fakeGemini(
    async () => new Response("", { status: 503 }),
    async () => {
      await assert.rejects(
        discussionTurn(view.id, "Explain"),
        (e) => e.status === 502,
      );
    },
  );
  const key = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  try {
    await assert.rejects(
      discussionTurn(view.id, "Explain"),
      (e) => e.status === 503,
    );
  } finally {
    if (key !== undefined) process.env.LLM_API_KEY = key;
  }
});
test("decision drafts remain pending and are saved only by an explicit save operation", async () => {
  const view = startDiscussion(graph, component.id);
  await fakeGemini(
    async () => jsonResponse(reply()),
    () => discussionTurn(view.id, "No Redis available."),
  );
  const decision = {
    problem: "Choose an appropriate limiter",
    requirements: ["No extra infrastructure"],
    currentImplementation: "Periodic in-memory counters",
    options: [
      {
        name: "Keep current counter",
        pros: ["Simple"],
        cons: ["Separate process state"],
        assumptions: ["Single process"],
      },
    ],
    reason: "Do not infer a choice",
    risks: ["Multiple process counts differ"],
    verification: ["Test boundaries and burst behavior"],
    evidenceIds: [component.referenceId],
  };
  await fakeGemini(
    async () => jsonResponse(decision),
    async () => {
      const draft = await draftDecision(view.id, undefined);
      assert.match(draft.content, /Decision pending/);
      assert.equal(sessionView(discussion(view.id)).savedDecisions.length, 0);
      const saved = saveDecision(
        view.id,
        draft.id,
        draft.content + "\nUser-reviewed note.",
      );
      assert.equal(sessionView(discussion(view.id)).savedDecisions.length, 1);
      assert.equal(saveDecision(view.id, draft.id, draft.content).id, saved.id);
      assert.throws(
        () => saveDecision(view.id, "wrong-draft", "Fake"),
        (e) => e.status === 409,
      );
    },
  );
});
test("voice list and selected voice IDs come from the account; recordings are transcribed separately", async () => {
  const original = globalThis.fetch,
    key = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "voice-test";
  let lists = 0;
  const spoken = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/v2/voices")) {
      lists++;
      return new Response(
        JSON.stringify({
          voices: [
            {
              voice_id: "actual-one",
              name: "Voice One",
              labels: { accent: "available metadata" },
            },
            { voice_id: "actual-two", name: "Voice Two" },
          ],
          has_more: false,
        }),
      );
    }
    if (String(url).includes("/text-to-speech/")) {
      spoken.push(String(url));
      assert.equal(JSON.parse(options.body).text, "Short answer");
      return new Response(new Uint8Array([73, 68, 51, 0]));
    }
    assert(String(url).includes("/speech-to-text"));
    assert.equal(options.body.get("model_id"), "scribe_v2");
    return new Response(
      JSON.stringify({
        text: "What does this counter do?",
        words: [{ end: 2 }],
      }),
    );
  };
  try {
    assert.equal((await availableVoices()).voices.length, 2);
    await availableVoices();
    assert.equal(lists, 1);
    await createSpeech("actual-one", "Short answer");
    await createSpeech("actual-two", "Short answer");
    assert(spoken[0].includes("/actual-one?"));
    assert(spoken[1].includes("/actual-two?"));
    await assert.rejects(
      createSpeech("invented", "Short answer"),
      (e) => e.status === 400,
    );
    const buffer = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      Buffer.alloc(50),
    ]);
    assert.equal(
      (await transcribe(buffer, "audio/webm;codecs=opus", 2)).text,
      "What does this counter do?",
    );
    assert.throws(
      () => checkAudio(Buffer.alloc(50), "audio/webm", 2),
      (e) => e.status === 415,
    );
    assert.throws(
      () => checkAudio(buffer, "audio/webm", 61),
      (e) => e.status === 400,
    );
    delete process.env.ELEVENLABS_API_KEY;
    await assert.rejects(availableVoices(), (e) => e.status === 503);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = key;
  }
});
