# Discuss this component

Discuss a selected function, class, module, or other analyzed component beside its code. The conversation stays bound to its repository, snapshot and commit. Component changes pause the old discussion and offer an explicit new session.

Use **Start live voice** for a hands-free conversation. It creates a discussion if needed, listens for sustained speech followed by a 1.4-second pause, transcribes the question with ElevenLabs, sends it automatically to the configured Gemini model, plays the cited answer in the selected voice, and listens again. **End conversation** cancels pending work, stops playback and releases the microphone. **Interrupt & speak** cancels an answer and returns to listening. Changing component or closing the panel also ends voice mode. The microphone pauses during replies to avoid recording the mentor?s own voice. This uses automatic turns, rather than full-duplex streaming: transcription, reasoning, and speech generation still take time. Silence-only segments are discarded locally; each segment stays within the existing 60-second / 5 MB limits. Provider and microphone failures end voice mode with an explicit error.

Text questions and manual Record / review / Send remain available when voice conversation is off. Conversation history and decisions persist after ending voice mode. Voice activity uses the browser Web Audio analyser (https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData).

The backend loads selected source, surrounding declarations, resolved callers/callees/imports, relevant captured configuration/test references, and analysis limitations. Read-only evidence retrieval only accepts references in that component context. Conversation requests contain bounded evidence, the last 12 messages, and a rolling requirements/rejections/questions summary. Full messages are stored in SQLite up to 100 turns. No repository commands run through this feature.

Use **Draft decision** for an editable record. An optional explicitly entered choice is recorded; otherwise it says **Decision pending**. Only **Save decision** persists the record. No application code or PR is modified.

Open **Talk with mentor** from the toolbar or bottom-center workspace button for the larger centered conversation view. The side-panel expand button opens the same view. All voice controls, questions, citations, and decision tools use the same mounted discussion session. Closing the centered view returns it to the side panel without interrupting voice; use **End conversation** to stop the microphone. The dialog supports Escape, keyboard focus trapping, and a responsive mobile width.

## Files

- `backend/src/discussion.js`, `discussion-system.txt`: sessions, evidence, Gemini responses, memory, decision drafts and saves.
- `backend/src/discussionVoice.js`, `discussionRoutes.js`: account voices, speech, transcription, input/rate limits and routes under `/api/discussions`.
- `backend/src/server.js`, `github.js`: API integration and cancellation-aware provider requests.
- `frontend/src/components/ComponentDiscussion.tsx`, `LiveMentorWorkspace.tsx`, `pages/Repository.tsx`: component launch buttons, side panel, microphone, transcript, voice preferences and decisions.
- `frontend/src/styles/component-discussion.css`: existing light purple theme.
- `backend/test/discussion.test.js`, `backend/scripts/verify-discussion-ui.js`, `discussion-test-server.js`: evidence/decision/provider tests and isolated browser providers, never used by normal application startup.

## Configuration and running

Environment-variable names only: `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_STT_MODEL`, `ELEVENLABS_TTS_MODEL`, `PORT`, `DATABASE_PATH`, `GITHUB_TOKEN`. Keep credentials in the ignored backend environment file. Gemini uses the configured model without substituting another model. Optional ElevenLabs model overrides use the provider defaults when omitted.

Run `npm.cmd run dev` in `backend`, and `npm.cmd run dev` in `frontend`. Select a component, open **Talk with mentor**, then **Start live voice**. Choose a real account voice in Voice settings and save your preference. Recording requires microphone permission on localhost or HTTPS. Live voice sends automatically after a pause; manual recording lets you review a transcription before sending.

Tests: `npm.cmd test` in each folder; `npm.cmd run build` in `frontend`. With Chrome or Edge installed on Windows, run `npm.cmd run verify:discussion` in `backend` for an isolated browser test with simulated providers and a browser test microphone. Provider simulations exist only in the explicit test server, not the production flow.

## Limits

Discussion replies now request a JSON schema containing the required answer,
claim, and memory fields. The provider schema omits string/array length limits
that some local servers cannot compile into a grammar; the backend still enforces
all original limits and validates citation IDs against the selected snapshot.
`LLM_JSON_MODE=json_object` selects legacy JSON-object formatting, and `0` omits
the format parameter. Both retain backend validation. A single fenced JSON reply
is accepted; truncated replies are regenerated. One repair attempt receives the
rejected shape and validation details. Invalid citations are never replaced, and
invalid answers are never persisted. No environment change is required for the
configured server tested with this fix.

Recordings are capped at 60 seconds and 5 MB, kept in memory and not saved locally. Provider retention follows its account policy. Server validation checks format, client duration metadata, and returned transcription word timestamps; it is not a full media demuxer. Provider requests time out, audio responses and context are bounded, and discussion routes are rate-limited. At most three text reasoning jobs run concurrently. Voice lists are cached for five minutes and capped at 300 returned voices.

Missing voice credentials keep text mode usable. Missing Gemini configuration prevents reasoning with a clear error. No production mock answers are supplied. Source IDs are validated against the bound snapshot, but that does not verify semantic correctness. Tests are source evidence, not executed results. Draft code edits are not analyzed evidence. The existing app is a local, public-repository tool with no multi-user authentication; production hosting needs repository/session authorization before exposing discussion data.

Official API references: [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), [ElevenLabs transcription](https://elevenlabs.io/docs/api-reference/speech-to-text/convert), [account voices](https://elevenlabs.io/docs/api-reference/voices/search), [speech synthesis](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).
