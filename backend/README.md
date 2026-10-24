# Backend

Phase 7 handoffs use the same SQLite database. Explicitly set
`CODEBASE_MENTOR_LOCAL_HANDOFFS=1` and restart for local single-user preparation.
This independent flag defaults off, including when checkpoints are enabled.
Every handoff data route reuses the checkpoint direct safe-loopback gate.
Localhost is not per-user authentication: hosted sharing, protected links,
repository authorization and authenticated senior replies remain unimplemented.

Under `/api/ide/handoffs`, `GET /capabilities` reports availability;
`POST /preview` accepts `{input,selection?}`. Input contains snapshotId,
optional componentId, sourceReferenceIds, exact question/attemptedSteps/
additionalContext strings and an editor/mentor/map/pr/checkpoint origin.
The backend validates snapshot identity, immutable source URLs, checkpoint
approval, and exact PR comparison sides (including forks). It projects bounded
stored direct graph evidence through the existing neighborhood service; no AI,
network source fetch or new graph analysis runs. Default references are bounded
to eight; excerpts, inferred documentation and checkpoint notes default off.
Selection explicitly chooses referenceIds, relationshipIds, excerptReferenceIds,
includeDocumentation and includeCheckpointNotes. Sensitive source paths are
denied. Suspected sensitive strings produce warnings, without any claim that
every secret can be detected. Review all text before manual sharing.
The selected component declaration gets the first of at most sixteen candidate
reference slots; bounded supplied references follow, then neighborhood extras.
Question, attempts, additional context and explicitly included checkpoint notes
reject C0/DEL/C1 control characters except tabs, LF and CR. Valid authored text
retains exact whitespace. Existing checkpoint storage remains unchanged; notes
containing these controls can be omitted from the handoff.

`POST /` accepts `{requestId,input,selection,digest}`. Save rebuilds the preview
and checks its SHA-256 digest against the exact approved selection, structured
context and canonical Markdown; drift returns 409. Transactional UUID request
deduplication makes retries stable and conflicting reuses return 409. Saved
content is immutable and remains readable after the original snapshot is gone
using a current same-repository snapshot scope. `GET /?snapshotId=...` lists
bounded repository summaries; `GET /:id?snapshotId=...` reopens the saved package;
`GET /:id/export?snapshotId=...` returns its exact stored Markdown/digest;
`DELETE /:id?snapshotId=...` deletes only that handoff. All reads, exports and
deletes are guarded and repository scoped. Export does not prove delivery or
clipboard/file success; no outbound sharing occurs. Authored text and source
are not logged. Markdown escapes authored HTML/syntax and fences excerpts.

Limits: question 1500 characters, attempts/context 2000 each, sixteen references,
five relationships, eleven components, one inferred documentation item (1200
characters), four excerpts (twenty lines/3000 characters each), 24KB requests,
64000 UTF-8 bytes each for context/Markdown, and 256KB API responses.
Run `node --test test/handoffs.test.js` for real HTTP/SQLite coverage and
separate-process restart persistence.

Phase 6 task checkpoints use this same backend and SQLite database. Explicitly
set `CODEBASE_MENTOR_LOCAL_CHECKPOINTS=1` and restart to enable them for one local
user. The default is disabled. Every data route requires direct loopback socket
addresses, a loopback Host, a safe local Origin when supplied, and no Forwarded
or X-Forwarded-* headers. This boundary does not provide production authentication,
user isolation, secure sharing, or cross-device synchronization. Do not enable
checkpoints on a hosted or proxied deployment.

`GET /api/ide/checkpoints/capabilities` reports availability without exposing
notes. Under `/api/ide/checkpoints`, `POST /` accepts a UUID requestId, snapshotId,
explicit taskTitle, notes `{discovery,unresolved,nextStep}`, localContext
`{branch?,headCommit?,gitStatus}`, and up to eight sourceReferenceIds. Identity,
indexed commit and approved evidence are derived/validated against stored
snapshots. Notes retain their original whitespace; no AI context is generated.
Title is limited to 200 characters, each note to 2000, and JSON to 24KB.
Idempotent retries must use the same requestId and payload; conflicting payloads
return 409. Writes and deletion use SQLite transactions in a versioned table.

`GET /?snapshotId=...&limit=10&offset=0` lists only the bound repository's summaries
without notes or reference IDs (limit at most 25; offset at most 10000).
`GET /:id?snapshotId=...` returns saved context and bounded source/component
evidence. `POST /:id/resume` accepts `{currentSnapshotId,localContext}` and compares
only the saved approved files using complete stored source of at most 300KB per
file. Missing/unmapped evidence stays unknown. File differences do not establish
behavior changes or analyze the local checkout. An existing PR comparison is
offered only for exact saved/current snapshots, immutable commits and matching
repository identities. Resume never changes repository bindings. Missing original
snapshots preserve notes. `DELETE /:id?snapshotId=...` deletes only the selected
checkpoint; repeated deletion returns 404. All data endpoints return 403 when
disabled or unsafe and 409 for another repository. No notes are logged.

Run `node --test test/checkpoints.test.js` for real SQLite/HTTP security,
validation, idempotency, pagination, evidence, rollback, concurrent saves,
deletion, and separate-process file database persistence coverage.

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

Quick Atlas uses `GET /api/ide/snapshots/:snapshotId/components/:componentId/neighborhood`.
Optional query: `limit` (default 25, integer 1–100), `direction` (`both`,
`incoming`, `outgoing`), and exact stored `relationshipType`. Unknown query keys
are rejected. The response includes snapshot/repository/commit identity, selected
and related components, original directed incoming/outgoing edges, certainty and
inference metadata when stored, declaration and relationship references (without
excerpts), existing inferred documentation, limitations, limit and truncation.
This projects the existing snapshot-scoped SQLite tables with bounded joins; it
does not load/serialize the entire graph, analyze source, traverse multiple hops,
or generate AI text. Dangling endpoint/evidence rows are omitted. Missing
snapshot/component/source evidence returns 404; invalid input returns 400.
Run `node --test test/ideNeighborhood.test.js` for focused persisted-HTTP tests.

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
