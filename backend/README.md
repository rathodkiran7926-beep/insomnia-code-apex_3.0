# Backend

Node.js 24+, Express, TypeScript Compiler API and built-in SQLite. See the [project README](../README.md) for setup, supported patterns, limits and verification.

## API

The VS Code companion uses the same server. Phase 3 adds
`POST /api/ide/resolve-selection` with `{snapshotId,file,startLine,endLine}`.
Paths are repository-relative; line ranges are inclusive and 1-based. The route
returns up to 20 actual stored component/reference IDs, plus `scope` and `notice`.
Only containing source ranges qualify. Meaningful declarations take precedence
over a containing module; module-only coverage is labelled explicitly. This
route performs no parsing, source upload, external fetch or LLM call.

Explanations continue through `POST /api/snapshots/:id/questions`
(`{componentId,question}`), and pinned source through
`GET /api/snapshots/:id/source?referenceId=...`. Source text is returned in
`excerpt` with `complete:true`, snapshot/file identity and full-file bounds.
Run `node --test test/ideSelection.test.js test/workspace.test.js` for focused
resolver and existing Mentor regressions, or `npm.cmd test` for the full suite.
The existing loopback/public-repository and authentication limitations remain.

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

Gemini Flash is the default model configuration. Put your Google AI Studio API key in `LLM_API_KEY` in the ignored `backend/.env` file. Keep `.env.example` credential-free.

```dotenv
LLM_API_KEY=your_gemini_api_key
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_MODEL=gemini-3.5-flash
```

This uses Google's [OpenAI-compatible endpoint](https://ai.google.dev/gemini-api/docs/openai) with the existing validated documentation adapter. Google's [model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash) currently marks Gemini 3.5 Flash deprecated and says requests are routed to Gemini 3.6 Flash. The requested model ID remains configurable. Restart the backend and run a new repository analysis to generate new explanations; saved snapshots retain their earlier documentation.

To diagnose mentor or voice reply failures, run `npm.cmd run check:llm` from `backend`. It loads `.env` and sends a tiny prompt without repository contents, reporting the provider's error with configured credentials redacted. HTTP 401 means the configured credentials were rejected: create a replacement key in [Google AI Studio](https://aistudio.google.com/api-keys), update `LLM_API_KEY` in `.env`, run the check again, then restart the backend. HTTP 403 indicates access restrictions or permissions; HTTP 429 indicates quota or rate limits. Environment variables already set in the terminal override `.env`, so remove any stale `LLM_API_KEY` from that terminal before restarting. Live voice also needs Gemini for mentor replies, in addition to ElevenLabs for transcription and speech. Never put real credentials in `.env.example`; rotate any keys previously shared in it.
