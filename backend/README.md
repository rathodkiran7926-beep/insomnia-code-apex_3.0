# Backend

Node.js 24+, Express, TypeScript Compiler API and built-in SQLite. See the [project README](../README.md) for setup, supported patterns, limits and verification.

## API

| Method | Path                                          | Result                                                                                               |
| ------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`                                 | Health status                                                                                        |
| POST   | `/api/analyses`                               | `{ "url": "https://github.com/owner/repo", "revision": "optional" }` → HTTP 202 `{ "id": "job-id" }` |
| GET    | `/api/analyses/:id`                           | Real status, progress, message, snapshot ID                                                          |
| GET    | `/api/snapshots/:id`                          | Evidence graph, report, source references, documentation metadata                                    |
| GET    | `/api/snapshots/:id/documentation`            | Markdown including Mermaid                                                                           |
| GET    | `/api/snapshots/:id/documentation?download=1` | Markdown attachment                                                                                  |

Configuration: `PORT`, optional `DATABASE_PATH`, `GITHUB_TOKEN`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`. The `.env` file is loaded by start/dev scripts. Documentation adapter failures fall back to extracted facts.

If analysis reports `EACCES` or `EPERM` when reaching GitHub, the backend process is being denied network access. Start it from a normal terminal with `cd backend` and `npm.cmd run dev`, and check firewall/proxy rules if the error persists. A GitHub token does not fix operating-system network restrictions. If port 3001 is already occupied, stop the older backend first: the UI connects to whichever process owns that port.

All text-generation features share `src/llmConfig.js` and an OpenAI-compatible chat-completions endpoint. This includes repository explanations, workspace questions, component discussions and decision drafts, generated guides, handoff briefings, and Code Journey explanations/questions. Existing citation validation and source fallbacks remain in place. ElevenLabs transcription and speech retain their separate configuration.

Set these values in the ignored `backend/.env` file:

```dotenv
LLM_API_KEY=your_endpoint_api_key
LLM_BASE_URL=https://studio-unmapped-vicinity.ngrok-free.dev/v1
LLM_MODEL=qwen2.5-codebase:latest
```

The model ID above was returned by the configured endpoint's models API. Other served models can be selected with `LLM_MODEL`. The key is never stored in source files or public configuration responses. Restart the backend after changing environment values; existing saved guides remain attached to their original snapshots and are not silently regenerated.

Run `npm.cmd run check:llm` in `backend` to send a tiny connection diagnostic without repository contents. HTTP 401 means the endpoint rejected the key; HTTP 403 indicates access restrictions; HTTP 429 indicates quota or request limits. A tunnel or model server must remain online. Shell environment variables take precedence over values loaded from `.env`. Never put a real key in `.env.example`.
Discussion replies use an explicit JSON schema with the current snapshot's allowed evidence IDs. If the model returns malformed JSON, a wrong field shape, or unknown citation IDs, the backend requests one corrected reply against the same pinned source and question. Citation validation is never bypassed and IDs are not silently replaced. Only the final validated reply and its user question are committed; two invalid replies leave the conversation unchanged. Authentication and network errors retain their separate recovery messages.
