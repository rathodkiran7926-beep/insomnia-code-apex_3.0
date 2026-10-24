import { z } from "zod";
import { boundedFetch } from "./github.js";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const api = "https://api.elevenlabs.io";
const missing = () =>
  Object.assign(
    new Error(
      "Voice requires ELEVENLABS_API_KEY in backend/.env. Text discussion still works.",
    ),
    { status: 503 },
  );
let cache = null,
  pending = null;
function key() {
  if (!process.env.ELEVENLABS_API_KEY) throw missing();
  return process.env.ELEVENLABS_API_KEY;
}
async function provider(path, options = {}) {
  try {
    return await boundedFetch(api + path, {
      ...options,
      headers: { ...options.headers, "xi-api-key": key() },
    });
  } catch (error) {
    if (error.status) throw error;
    const remoteStatus = error.remoteStatus;
    const denied = error.code === "EACCES" || error.code === "EPERM";
    const reason = denied
      ? `Network access to api.elevenlabs.io was blocked (${error.code}). Restart the backend from a normal terminal outside the restricted environment. If it still fails, check firewall or proxy settings.`
      : remoteStatus === 401
        ? "ElevenLabs rejected the API key (HTTP 401). Check ELEVENLABS_API_KEY in backend/.env and restart the backend."
        : remoteStatus === 403
          ? "ElevenLabs denied access (HTTP 403). Check the API key's voice, speech-to-text, or text-to-speech permissions."
          : remoteStatus === 429
            ? "ElevenLabs rate or account limit reached (HTTP 429). Check account usage and retry later."
            : remoteStatus
              ? `ElevenLabs returned HTTP ${remoteStatus}. Check voice access, model availability, and account usage.`
              : "Cannot reach ElevenLabs. Check network access and retry.";
    throw Object.assign(
      new Error(
        options.signal?.aborted
          ? "Voice request cancelled."
          : `${reason} Text discussion remains available.`,
      ),
      { status: options.signal?.aborted ? 499 : 502 },
    );
  }
}
export async function availableVoices() {
  const credential = key();
  if (cache?.credential === credential && cache.expires > Date.now())
    return { voices: cache.voices, limited: cache.limited };
  if (pending) return pending;
  pending = (async () => {
    const voices = [];
    let token,
      more = false;
    for (let i = 0; i < 3; i++) {
      const query = new URLSearchParams({
        page_size: "100",
        include_total_count: "false",
        ...(token ? { next_page_token: token } : {}),
      });
      const body = JSON.parse(
        await provider("/v2/voices?" + query, { limit: 1800000 }),
      );
      const checked = z
        .array(
          z.object({
            voice_id: z.string().min(1).max(150),
            name: z.string().max(200),
            description: z.string().nullable().optional(),
            labels: z.record(z.string(), z.string()).nullable().optional(),
            category: z.string().optional(),
          }),
        )
        .max(500)
        .parse(body.voices);
      voices.push(
        ...checked.map((v) => ({
          id: v.voice_id,
          name: v.name,
          description: (v.description || "").slice(0, 300),
          labels: v.labels || {},
          category: v.category || "",
        })),
      );
      more = !!body.has_more;
      token = body.next_page_token;
      if (!more || !token) break;
    }
    cache = {
      credential,
      voices: [...new Map(voices.map((v) => [v.id, v])).values()],
      limited: more,
      expires: Date.now() + 300000,
    };
    return { voices: cache.voices, limited: more };
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}
export async function createSpeech(voiceId, text, signal) {
  const { voices } = await availableVoices();
  if (!voices.some((v) => v.id === voiceId))
    throw Object.assign(
      new Error(
        "This voice is unavailable. Refresh the voice list and choose another.",
      ),
      { status: 400 },
    );
  return provider(
    `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      signal,
      binary: true,
      limit: 3000000,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text.slice(0, 1200),
        model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5",
      }),
    },
  );
}
// Keep credentials on the server and forward chunks with backpressure and a
// bounded lifetime. Cancellation stops provider generation when the call ends.
export async function streamSpeech(voiceId, text, res, signal) {
  const { voices } = await availableVoices();
  if (!voices.some((v) => v.id === voiceId))
    throw Object.assign(
      new Error("This voice is unavailable. Choose another voice."),
      { status: 400 },
    );
  const combined = AbortSignal.any([signal, AbortSignal.timeout(45000)]);
  const response = await fetch(
    `${api}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      signal: combined,
      headers: { "xi-api-key": key(), "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text.slice(0, 1200),
        model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5",
      }),
    },
  );
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw Object.assign(
      new Error(
        `Voice service unavailable (HTTP ${response.status}). Your text answer remains available.`,
      ),
      { status: 502 },
    );
  }
  res.type("audio/mpeg");
  res.set("Cache-Control", "no-store");
  res.set("X-Accel-Buffering", "no");
  if (response.headers.get("content-type")?.includes("audio/mpeg"))
    res.set("X-Voice-Stream", "1");
  let size = 0;
  await pipeline(
    Readable.fromWeb(response.body),
    new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        callback(
          size > 3000000
            ? new Error("Voice response exceeded size limit")
            : null,
          chunk,
        );
      },
    }),
    res,
    { signal: combined },
  );
}
export function checkAudio(buffer, mime, duration) {
  const type = mime.split(";")[0].trim().toLowerCase();
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > 5000000)
    throw Object.assign(
      new Error("Recording must be a nonempty audio file under 5 MB."),
      { status: 413 },
    );
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60.5)
    throw Object.assign(new Error("Record up to 60 seconds per question."), {
      status: 400,
    });
  const valid =
    (type === "audio/webm" &&
      buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) ||
    (type === "audio/ogg" && buffer.toString("ascii", 0, 4) === "OggS") ||
    (["audio/mp4", "audio/x-m4a"].includes(type) &&
      buffer.toString("ascii", 4, 8) === "ftyp") ||
    (["audio/wav", "audio/x-wav"].includes(type) &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WAVE") ||
    (["audio/mpeg", "audio/mp3"].includes(type) &&
      (buffer.toString("ascii", 0, 3) === "ID3" || buffer[0] === 255));
  if (!valid)
    throw Object.assign(
      new Error(
        "Unsupported or invalid recording format. Use WebM, Ogg, MP4, WAV, or MP3.",
      ),
      { status: 415 },
    );
  return type;
}
export async function transcribe(buffer, mime, duration, signal) {
  key();
  const type = checkAudio(buffer, mime, duration);
  const form = new FormData();
  form.append(
    "file",
    new Blob([buffer], { type }),
    "question." +
      {
        "audio/webm": "webm",
        "audio/ogg": "ogg",
        "audio/mp4": "m4a",
        "audio/x-m4a": "m4a",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/mpeg": "mp3",
        "audio/mp3": "mp3",
      }[type],
  );
  form.append("model_id", process.env.ELEVENLABS_STT_MODEL || "scribe_v2");
  form.append("tag_audio_events", "false");
  const result = JSON.parse(
    await provider("/v1/speech-to-text", {
      method: "POST",
      signal,
      body: form,
      limit: 100000,
    }),
  );
  if (result.words?.some((w) => typeof w.end === "number" && w.end > 60.5))
    throw Object.assign(new Error("Recording exceeds the 60-second limit."), {
      status: 400,
    });
  const text = z.string().trim().min(1).max(2000).parse(result.text);
  return { text };
}
