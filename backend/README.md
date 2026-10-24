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
| POST   | `/api/snapshots/:id/agent-context`             | Bounded, source-backed Agent Context Bridge retrieval (`{ "task": "..." }`)                          |
| GET    | `/api/snapshots/:id/documentation?download=1` | Markdown attachment                                                                                  |

Configuration: `HOST` (default `127.0.0.1`), `PORT` (default `3001`), optional `DATABASE_PATH`, `GITHUB_TOKEN`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`. The `.env` file is loaded by start/dev scripts. Documentation adapter failures fall back to extracted facts.

## MCP plugin for coding agents

The MCP plugin is an independent package in [`../mcp`](../mcp). It calls this backend over HTTP; it does not import backend code or open the SQLite database. The backend exposes four read-only agent-context routes:

| Method | Route | MCP tool |
| --- | --- | --- |
| POST | `/api/snapshots/:id/agent-context` | `get_task_context` |
| POST | `/api/snapshots/:id/agent-context/inspect-symbol` | `inspect_symbol` |
| POST | `/api/snapshots/:id/agent-context/explore-dependencies` | `explore_dependencies` |
| POST | `/api/snapshots/:id/agent-context/check-drift` | `check_context_drift` |

The backend must be running and reachable by the MCP process. The MCP package defaults to `http://127.0.0.1:3001`; set `CODEBASE_MENTOR_API_URL` for a hosted deployment. See [mcp/docs/harness-setup.md](../mcp/docs/harness-setup.md) for STDIO and Streamable HTTP setup, client configuration for Codex, Claude Code, OpenCode, Cursor, and generic MCP clients, and verification commands.

In the app, analyze a non-empty supported repository, open **Agent Context Bridge**, enter the task, and retrieve context. Select **MCP request**, copy it, then paste it into your coding agent. The copied request instructs the agent to call `get_task_context`; it does not invoke MCP on its own. If MCP is unavailable, select **Prompt slice** instead. The MCP server is read-only: the harness itself edits the local checkout. Ask the agent to inspect cited files locally before making changes because this bridge cannot compare the saved snapshot with the live working tree.

Requests require an existing snapshot ID. Freshness is pinned to the stored analyzed commit; this project has no service that compares snapshots to a live working tree. Retrieval caching is process-local and keyed by repository, snapshot/commit, normalized query, mode, and limits. Token counts are estimates, not vendor tokenizer counts.

To compare unfiltered graph delivery with bounded retrieval for a saved snapshot, run `npm run evaluate:agent-context -- <snapshot-id> "<task description>"` from `backend`. It uses the same byte/3 estimate for both outputs and labels lexical overlap as a proxy, not a human relevance score.

For a reproducible measurement on the current checkout without creating or saving a graph outside the evaluator, run `npm run evaluate:workspace-agent-context -- "<task description>"`. This invokes the existing analyzer over `backend/src` and `frontend/src`, stores the temporary graph in an in-memory SQLite database, and reports a local source fingerprint instead of presenting it as a Git commit.

If analysis reports `EACCES` or `EPERM` when reaching GitHub, the backend process is being denied network access. Start it from a normal terminal with `cd backend` and `npm.cmd run dev`, and check firewall/proxy rules if the error persists. A GitHub token does not fix operating-system network restrictions. If port 3001 is already occupied, stop the older backend first: the UI connects to whichever process owns that port.

Gemini Flash is the default model configuration. Put your Google AI Studio API key in `LLM_API_KEY` in the ignored `backend/.env` file. Keep `.env.example` credential-free.

```dotenv
LLM_API_KEY=your_gemini_api_key
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_MODEL=gemini-3.5-flash
```

This uses Google's [OpenAI-compatible endpoint](https://ai.google.dev/gemini-api/docs/openai) with the existing validated documentation adapter. Google's [model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash) currently marks Gemini 3.5 Flash deprecated and says requests are routed to Gemini 3.6 Flash. The requested model ID remains configurable. Restart the backend and run a new repository analysis to generate new explanations; saved snapshots retain their earlier documentation.

To diagnose mentor or voice reply failures, run `npm.cmd run check:llm` from `backend`. It loads `.env` and sends a tiny prompt without repository contents, reporting the provider's error with configured credentials redacted. HTTP 401 means the configured credentials were rejected: create a replacement key in [Google AI Studio](https://aistudio.google.com/api-keys), update `LLM_API_KEY` in `.env`, run the check again, then restart the backend. HTTP 403 indicates access restrictions or permissions; HTTP 429 indicates quota or rate limits. Environment variables already set in the terminal override `.env`, so remove any stale `LLM_API_KEY` from that terminal before restarting. Live voice also needs Gemini for mentor replies, in addition to ElevenLabs for transcription and speech. Never put real credentials in `.env.example`; rotate any keys previously shared in it.
