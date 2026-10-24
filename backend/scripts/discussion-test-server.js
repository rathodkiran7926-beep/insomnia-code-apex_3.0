// Isolated browser-test providers. Never imported by the production server.
import { writeFileSync } from "node:fs";
if (
  process.env.DISCUSSION_TEST_PROVIDER !== "1" ||
  !process.env.DATABASE_PATH?.endsWith("discussion-ui-verification.sqlite")
)
  throw new Error("Use only through verify-discussion-ui.js");
process.env.LLM_BASE_URL = "https://test-model.invalid/v1";
process.env.LLM_API_KEY = "isolated-test-key";
process.env.LLM_MODEL = "configured-test-model";
process.env.ELEVENLABS_API_KEY = "isolated-test-voice-key";
const { analyze } = await import("../src/analyzer.js");
const { db, saveSnapshot } = await import("../src/storage.js");
const files = {
  "limiter.ts": `// Described as token bucket by its author.
const counts = new Map();
setInterval(()=>counts.clear(),60000);
export function limit(req,res,next){const n=(counts.get(req.ip)||0)+1;counts.set(req.ip,n);if(n>10)return res.status(429).send('Try later');next();}`,
  "app.ts": `import express from 'express';import {limit} from './limiter';const app=express();app.use(limit);`,
};
const graph = analyze({
  repository: "https://github.com/example/discussion-test",
  commit: "e".repeat(40),
  files,
});
saveSnapshot(
  graph,
  {
    snapshotId: graph.snapshotId,
    ai: { explanations: [], message: "Isolated test fixture" },
  },
  "",
  files,
);
db.prepare("INSERT OR REPLACE INTO analysis_jobs VALUES (?,?,?,?,?,?)").run(
  "discussion-ui-job",
  "complete",
  100,
  "Ready",
  graph.snapshotId,
  new Date().toISOString(),
);
const trace = { voiceIds: [], transcriptions: 0, reasonings: 0 };
const persist = () =>
  writeFileSync(
    new URL("../data/discussion-ui-provider-trace.json", import.meta.url),
    JSON.stringify(trace),
  );
persist();
const original = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.includes("test-model.invalid")) {
    trace.reasonings++;
    persist();
    const body = JSON.parse(options.body);
    if (body.messages.at(-1)?.content === "slow verification")
      await new Promise((resolve) => setTimeout(resolve, 1200));
    const draft = body.messages[0].content.includes(
      "Draft a NEW discussion decision",
    );
    const source = JSON.parse(body.messages[1].content).untrustedEvidence;
    const referenceId = source.references[0].id;
    const content = draft
      ? {
          problem: "Choose a request limiting approach",
          requirements: ["Understand process-local state"],
          currentImplementation: "An in-memory counter with periodic reset",
          options: [
            {
              name: "Keep current counter",
              pros: ["Simple"],
              cons: ["Independent process state"],
              assumptions: ["Deployment requirements must be confirmed"],
            },
          ],
          reason: "Only if explicitly chosen",
          risks: ["Burst at reset boundary"],
          verification: ["Test window boundaries and multiple instances"],
          evidenceIds: [referenceId],
        }
      : {
          spokenText:
            "This code periodically resets an in-memory counter. Independent processes do not automatically share that state.",
          displayText:
            "The selected implementation uses a Map and a periodic reset. The misleading token-bucket comment is not evidence of token refilling. Confirm deployment requirements before choosing an alternative.",
          claims: [
            {
              text: "This discussion is tied to the selected implementation.",
              evidenceIds: [referenceId],
            },
          ],
          alternatives: [],
          followUpQuestion:
            "Will this run in a single process or multiple instances?",
          uncertainties: ["Deployment is not shown."],
          memory: {
            summary:
              "The user is discussing a periodic counter and deployment.",
            requirements: ["Clarify topology"],
            rejectedAlternatives: [],
            openQuestions: ["Single or multiple instances?"],
          },
        };
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) } }],
      }),
    );
  }
  if (target.includes("api.elevenlabs.io/v2/voices"))
    return new Response(
      JSON.stringify({
        voices: [
          {
            voice_id: "test-account-one",
            name: "Test Account Voice One",
            labels: { language: "en" },
          },
          {
            voice_id: "test-account-two",
            name: "Test Account Voice Two",
            labels: { language: "en" },
          },
        ],
        has_more: false,
      }),
    );
  if (target.includes("api.elevenlabs.io/v1/text-to-speech/")) {
    trace.voiceIds.push(new URL(target).pathname.split("/")[3]);
    persist();
    const data = Buffer.alloc(44 + 32000);
    data.write("RIFF");
    data.writeUInt32LE(data.length - 8, 4);
    data.write("WAVEfmt ", 8);
    data.writeUInt32LE(16, 16);
    data.writeUInt16LE(1, 20);
    data.writeUInt16LE(1, 22);
    data.writeUInt32LE(8000, 24);
    data.writeUInt32LE(16000, 28);
    data.writeUInt16LE(2, 32);
    data.writeUInt16LE(16, 34);
    data.write("data", 36);
    data.writeUInt32LE(32000, 40);
    return new Response(data);
  }
  if (target.includes("api.elevenlabs.io/v1/speech-to-text")) {
    trace.transcriptions++;
    persist();
    return new Response(
      JSON.stringify({
        text: "What happens with multiple backend instances?",
        words: [{ end: 1 }],
      }),
    );
  }
  return original(url, options);
};
await import("../src/server.js");
