# Mentor voice conversation

Open a repository component in the workspace and select **Talk to mentor**.
The toolbar and discussion header use the platform's existing logo; Shishimaru
appears in the voice card. Select **Start live voice**, allow microphone access,
speak, then pause. The mentor transcribes the question, answers using the
existing component discussion service, speaks the answer, and listens again.

**Pause microphone** stops recording and cancels the current request or audio.
**Resume microphone** listens again. **Interrupt & speak** cancels the pending
reply and starts a new listening turn. **End conversation**, changing the code
selection, and leaving the workspace stop capture and playback. Existing text
answers, citations, voice selection, and decision drafting remain available.

## Configuration

Keep these values in the backend environment, never frontend code:

- `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`: the existing configured text model.
- `ELEVENLABS_API_KEY`: transcription and natural voice replies.
- `ELEVENLABS_TTS_MODEL`: optional override; defaults to `eleven_flash_v2_5`.
- `ELEVENLABS_STT_MODEL`: optional override; defaults to `scribe_v2`.

No new voice-provider subscription or credentials are assumed. Browser speech
synthesis is never used for this component discussion. Voice settings list
voices actually available on the configured account.

## How latency is reduced

After sustained speech, one second of silence submits the question. Listening
resumes after a short 80 ms scheduling delay. Supported browsers request streamed
MP3 from `POST /api/discussions/:id/speech` with `stream: true`. The backend
forwards ElevenLabs chunks with backpressure, a 45-second timeout, a 3 MB limit,
and cancellation. Playback begins while audio is still arriving. Browsers without
MP3 MediaSource support download and play the same provider voice.

This remains a turn-based conversation: transcription and the complete validated
model answer precede speech. It is not a full-duplex speech-to-speech connection;
interruptions use the button. Model response time, network, and account limits
still affect latency. Actual voice quality and latency require a live account
check; isolated tests do not measure them.

## Verification

- Frontend tests cover stream playback starting before completion, provider-audio
  fallback, cancellation, and provider errors; voice activity tests cover silence
  and pauses.
- Backend tests cover streamed bytes, voice validation, cancellation propagation,
  provider failure, and existing evidence-backed discussion behavior.
- `node backend/scripts/verify-discussion-ui.js` exercises the call loop with
  isolated model/voice fixtures, not paid provider calls.

Provider reference: [ElevenLabs stream speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/stream).
