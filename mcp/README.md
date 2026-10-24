# Codebase Mentor MCP plugin

Independent MCP package for Codebase Mentor. It exposes bounded, source-cited repository context to coding-agent harnesses over STDIO or Streamable HTTP.

The plugin does not import backend code and does not open the SQLite database. Every tool call is an HTTP POST to the Codebase Mentor backend.

```text
harness -> mcp/ -> CODEBASE_MENTOR_API_URL -> backend/
```

## Tools

| Tool | Purpose |
| --- | --- |
| `get_task_context` | Retrieve compact context for a task from one analyzed snapshot. |
| `inspect_symbol` | Inspect an exact or lexically matched symbol and its direct relationships. |
| `explore_dependencies` | Explore bounded, typed dependencies around a symbol. |
| `check_context_drift` | Validate stored source reference IDs against the snapshot. |

`snapshotId` is optional for all tools. When omitted, the bridge resolves the latest analyzed snapshot for the current workspace’s public GitHub origin. If none exists, it starts analysis through the existing backend API and waits for the result. Explicit `snapshotId` remains supported for reproducible, pinned analysis. All tools are annotated read-only and return snapshot identity, evidence, freshness status, and an estimated token count.

## Simplest setup on Windows

Ensure the Codex CLI is installed and `codex --version` works in your terminal. From the extracted project, double-click `Install-Codebase-Mentor.bat` once. It checks Node.js 24+, installs only the backend and MCP dependencies, creates local `.env` files from examples if absent, backs up the Codex config, repairs any UTF-8 BOM left by the old installer, registers Codebase Mentor using `codex mcp add`, and starts the backend. Codex handles the TOML update and preserves other MCP entries. Restart or reload VS Code once after installation. Then open a public GitHub repository in Codex and ask normal questions; Codebase Mentor resolves the workspace remote automatically and analyzes it on first use if needed.

Use `Start-Codebase-Mentor.bat` to start the backend later and `Stop-Codebase-Mentor.bat` to stop the managed local backend. The MCP server can also start the local backend automatically if it is stopped.

**Current analyzer limitation:** the existing analyzer supports public GitHub repositories only. Private and purely local filesystem analysis are not supported by this version. The workspace must expose a supported GitHub `origin` or `upstream` remote to auto-select the repository.

## Manual/developer setup

```sh
cd backend && npm ci
cd ../mcp && npm ci
```

The default API URL is `http://127.0.0.1:3001`. Set `CODEBASE_MENTOR_API_URL` for a hosted API and `CODEBASE_MENTOR_API_TOKEN` when the deployment requires a bearer token. The MCP server automatically starts a local backend when using the default loopback endpoint and the backend is not already running.

STDIO:

```sh
node src/stdio.js
```

Streamable HTTP:

```sh
MCP_HTTP_TOKEN='<random token, at least 16 characters>' node src/http.js
```

The HTTP endpoint defaults to `http://127.0.0.1:3921/mcp`.

Print a harness configuration without writing client files:

```sh
npm run print-config -- codex
npm run print-config:http -- codex
```

Full setup, client examples, environment variables, and security notes are in [docs/harness-setup.md](docs/harness-setup.md). The repository-level [MCP_PLUGIN_HANDOFF.md](../MCP_PLUGIN_HANDOFF.md) explains the plugin packaging and verification status. Generated STDIO configurations load `mcp/.env` using an absolute path; keep that file untracked and never store secrets in the generated config.

## Test and verify

```sh
npm test
SNAPSHOT_ID=<snapshot-id> npm run verify
SNAPSHOT_ID=<snapshot-id> npm run verify:http
```

The unit tests use a fake backend. The verifiers start the real MCP entry points and call the running backend; they do not read the database directly. Harness-level compatibility must be verified with the installed harness after this version's automatic snapshot resolver changes; earlier baseline checks are not a substitute for rerunning the checks.
