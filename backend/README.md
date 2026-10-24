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

## Decision and failure memory (F07)

F07 uses the existing SQLite database and analyzed repository snapshots. It supports decision and failure-lesson drafts, immutable revisions, evidence references, maintainer questions, retrieval, approval, withdrawal, supersession, and manual review-state changes. It does not run a second repository index or PR diff engine.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/api/decision-memory/records?repository=...` | Search approved and `needs_review` records; optional `q`, `type`, `snapshotId`, `sourceReferenceId`, `limit`, and `offset` filters |
| POST | `/api/decision-memory/records` | Create a draft decision or failure lesson |
| GET | `/api/decision-memory/records/:id?repository=...` | Read a repository-scoped record; drafts require maintainer access |
| GET | `/api/decision-memory/records/:id/history?repository=...` | Read immutable revisions and audit events; maintainer access required |
| POST | `/api/decision-memory/records/:id/revisions` | Create a new draft revision using `expectedRevision`, `content`, and optional `evidence` |
| POST | `/api/decision-memory/records/:id/submit` | Submit the exact `expectedRevision` for review |
| POST | `/api/decision-memory/records/:id/approve` | Approve the exact submitted revision; maintainer access required |
| POST | `/api/decision-memory/records/:id/needs-review` | Mark an approved record for review; maintainer access required |
| POST | `/api/decision-memory/records/:id/review` | Resolve review as `still_applicable` or `withdraw`; maintainer access required |
| POST | `/api/decision-memory/records/:id/withdraw` | Withdraw with a reason; maintainer access required |
| POST | `/api/decision-memory/records/:id/supersede` | Link an approved replacement; maintainer access required |
| POST | `/api/decision-memory/questions` | Create or deduplicate a repository-scoped maintainer question |
| GET | `/api/decision-memory/questions?repository=...` | List open questions; maintainer access required |
| GET | `/api/decision-memory/questions/:id?repository=...` | Read a question; maintainer access required |
| POST | `/api/decision-memory/questions/:id/suggestion` | Generate a source-grounded answer draft for maintainer review; accepts the analyzed `componentId` and `snapshotId` (or a related source reference) |
| POST | `/api/decision-memory/questions/:id/respond` | Persist a maintainer response and evidence without closing the question |
| POST | `/api/decision-memory/questions/:id/resolve` | Save a response and optionally link a record, or close with a reason; maintainer access required |

The learner UI searches current team-memory records by question keywords before it enables question submission. Maintainers select a specific analyzed module or function to ground a response draft in that component's source, callers, dependencies, and available tests. When an LLM is configured the draft is marked as AI-generated, otherwise the API identifies its source-facts fallback. Suggestions are not saved until a maintainer reviews and submits them.

Record creation accepts `repository`, `type` (`decision` or `failure_lesson`), typed `content`, and optional `evidence`. Evidence source-reference IDs are checked against the specified analyzed snapshot and repository. Failure lessons may preserve an unknown cause; a confirmed cause requires evidence, and a verified resolution requires test or observed-run evidence.

**Local demo access:** F07 defaults to a shared demo identity when `NODE_ENV` is not `production`. This allows the same local user to create, review, and approve records without signing in or assigning repository roles. It is deliberately not authentication: anyone who can reach the F07 API can act as the demo maintainer. The backend currently binds to `127.0.0.1`, but do not expose or deploy demo mode to other users. Set `F07_DEMO_MODE=false` to disable the demo identity; in production demo mode is off by default. Setting `F07_DEMO_MODE=true` explicitly enables this insecure demo mode in any environment.

For real multi-user use, keep demo mode disabled and connect a trusted `resolvePrincipal(req)` adapter in `backend/src/decisionMemoryAuth.js` that validates an actual session/token and resolves repository membership server-side. It must return a verified `userId` and repository-specific `repositoryRoles`. Request-body fields and arbitrary headers are not identity.

F07 does not yet consume F08 changes automatically. A demo maintainer can explicitly mark an approved record `needs_review`; automatic source-change review, model-assisted F07 record drafting, and frontend integration remain follow-up work. Existing discussion drafts remain distinct and are not silently promoted to F07 records.

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
