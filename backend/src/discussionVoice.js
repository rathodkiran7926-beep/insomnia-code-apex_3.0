import { z } from "zod";
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
  const credential = process.env.ELEVENLABS_API_KEY?.trim();
  if (!credential) throw missing();
  return credential;
}
function voiceError(status, code, path, signal, networkCode) {
  const permission = path.includes("/text-to-speech/")
    ? "Text to Speech"
    : path.includes("/speech-to-text")
      ? "Speech to Text"
      : "Voices Read";
  const reason =
    code === "missing_permissions"
      ? `ElevenLabs key lacks ${permission} permission (HTTP ${status}). Enable ${permission} for this API key in ElevenLabs, or replace ELEVENLABS_API_KEY in backend/.env with a key that has this permission, then restart the backend.`
      : status === 401
        ? "ElevenLabs rejected the API key (HTTP 401). Check ELEVENLABS_API_KEY in backend/.env and restart the backend."
        : status === 403
          ? "ElevenLabs denied voice access (HTTP 403). Check the API key permissions and account access."
          : status === 429 || code === "quota_exceeded"
            ? `ElevenLabs rate or account limit reached (HTTP ${status}). Check account usage before retrying.`
            : networkCode === "EACCES" || networkCode === "EPERM"
              ? `Network access to api.elevenlabs.io was blocked (${networkCode}). Restart the backend from a normal terminal outside the restricted environment and check firewall or proxy settings.`
              : status
                ? `ElevenLabs returned HTTP ${status}. Check voice access, model availability, and account usage.`
                : "Cannot reach ElevenLabs. Check network access and retry.";
  return Object.assign(
    new Error(
      signal?.aborted
        ? "Voice request cancelled."
        : reason + " Your text answer remains available.",
    ),
    {
      status: signal?.aborted ? 499 : 502,
      voiceErrorCode: code || "voice_unavailable",
    },
  );
}
async function providerResponse(path, options = {}) {
  const credential = key();
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(45000)])
    : AbortSignal.timeout(45000);
  let response;
  try {
    response = await fetch(api + path, {
      ...options,
      signal,
      redirect: "error",
      headers: { ...options.headers, "xi-api-key": credential },
    });
  } catch (error) {
    throw voiceError(
      null,
      null,
      path,
      options.signal,
      error.cause?.code || error.code,
    );
  }
  if (!response.ok) {
    // Only inspect bounded error JSON. Never return provider messages, keys,
    // account details, or request text to the client.
    const reader = response.body?.getReader();
    let size = 0;
    const chunks = [];
    try {
      while (reader && size < 4096) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value.subarray(0, 4096 - size);
        size += chunk.length;
        chunks.push(Buffer.from(chunk));
      }
    } catch {
    } finally {
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
    let code;
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8")).detail
        ?.status;
      if (
        ["missing_permissions", "invalid_api_key", "quota_exceeded"].includes(
          value,
        )
      )
        code = value;
    } catch {}
    throw voiceError(response.status, code, path, options.signal);
  }
  return response;
}
async function provider(path, options = {}) {
  const response = await providerResponse(path, options);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > (options.limit || 3000000))
      throw Object.assign(new Error("Voice response exceeds size limit."), {
        status: 502,
      });
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  return options.binary ? data : data.toString("utf8");
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
  const response = await providerResponse(
    `/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      signal: combined,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text.slice(0, 1200),
        model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5",
      }),
    },
  );
  if (!response.body)
    throw Object.assign(
      new Error(
        "ElevenLabs returned no audio. Your text answer remains available.",
      ),
      { status: 502 },
    );
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
