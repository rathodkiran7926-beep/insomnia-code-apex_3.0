# MCP harness setup

The MCP plugin is an independent package in `mcp/`. It has no backend imports and no direct database access. It calls the Codebase Mentor backend HTTP API and returns the bounded, source-cited result to the agent harness.

```text
agent harness
  -> MCP plugin (mcp/, STDIO or Streamable HTTP)
    -> Codebase Mentor backend API (backend/, default http://127.0.0.1:3001)
      -> analyzed snapshot database
```

The agent gets compact context with snapshot identity, source evidence, freshness status, and an estimated token count. The backend does the graph retrieval; the MCP process only validates and forwards tool calls.

## Prerequisites

- Node.js 24 or newer, as declared by `mcp/package.json`.
- A running Codebase Mentor backend with at least one completed repository analysis. The default API URL is `http://127.0.0.1:3001`.
- For a hosted backend, its public HTTP(S) URL and any required bearer token.
- For the HTTP transport, a random `MCP_HTTP_TOKEN` of at least 16 characters. Keep it in the environment that launches the MCP server or harness. Do not commit it or paste it into a tracked client configuration.

Install MCP dependencies once:

```sh
cd mcp
npm install
```

Run commands from the repository root unless a step says otherwise. Use absolute paths in user-level or global harness configuration.

## MCP environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `CODEBASE_MENTOR_API_URL` | `http://127.0.0.1:3001` | Backend base URL. Must be absolute HTTP(S). |
| `CODEBASE_MENTOR_API_TOKEN` | empty | Optional bearer token sent to the backend when the deployment requires one. |
| `CODEBASE_MENTOR_API_TIMEOUT_MS` | `30000` | Backend request timeout in milliseconds. |

Copy `mcp/.env.example` to `mcp/.env` for local runs. The npm scripts load it with `--env-file-if-exists=.env`. A harness that launches the STDIO entry point directly should set these variables in its own environment or `env` block.

## Start the server

STDIO:

```sh
node mcp/src/stdio.js
```

The process speaks MCP on stdout and writes diagnostics to stderr. Do not wrap it in `npm run` for a harness: package-manager banners can corrupt the STDIO stream. `mcp` provides `npm start` for manual runs.

Streamable HTTP (PowerShell):

```powershell
$env:MCP_HTTP_TOKEN = "<random token, at least 16 characters>"
node mcp/src/http.js
```

Streamable HTTP (macOS/Linux):

```sh
MCP_HTTP_TOKEN='<random token, at least 16 characters>' node mcp/src/http.js
```

The default endpoint is `http://127.0.0.1:3921/mcp`; `/healthz` returns a small unauthenticated health response. The HTTP server exits at startup if the token is missing or too short. It validates the `Origin` header when present, requires `Authorization: Bearer <token>`, accepts POST only, limits bodies to 1 MiB, rate-limits requests per client address, and caps concurrent requests.

Optional HTTP settings:

| Variable | Default | Meaning |
| --- | --- | --- |
| `MCP_HTTP_HOST` | `127.0.0.1` | Bind address. Keep loopback unless you have a protected network path. |
| `MCP_HTTP_PORT` | `3921` | Port. `0` chooses an available port and logs it. |
| `MCP_HTTP_TOKEN` | none | Required bearer token. |
| `MCP_HTTP_ALLOWED_ORIGINS` | empty | Comma-separated extra origins allowed in addition to the loopback origins. |
| `MCP_HTTP_RATE_LIMIT` | `120` | Requests per client address per minute. |
| `MCP_HTTP_MAX_CONCURRENT` | `16` | Maximum in-flight POST requests. |

The HTTP transport authenticates harness-to-MCP requests. It does not replace backend authentication. If you bind beyond loopback, terminate TLS in front of the MCP server, restrict network access, set `MCP_HTTP_ALLOWED_ORIGINS`, and protect the backend API separately.

## Print a configuration

`mcp` includes a helper that prints a merge-ready entry without writing any client file:

```sh
cd mcp
npm run print-config -- codex
npm run print-config -- claude
npm run print-config -- opencode
npm run print-config -- cursor
npm run print-config -- generic
```

For the Streamable HTTP form, use the separate script and append the client name: `npm run print-config:http -- codex`. Do not pass `--http` through `npm run`, because npm consumes that flag as its own proxy setting. The STDIO output uses the current Node executable, an absolute path to `mcp/src/stdio.js`, and an absolute `--env-file-if-exists` path to `mcp/.env`. If `CODEBASE_MENTOR_API_URL` is set when the helper runs, it is included in the generated entry. Keep `mcp/.env` untracked and never place secrets in committed configuration files. The HTTP output uses `MCP_HTTP_URL` or the default endpoint.

## Codex

Codex supports project-scoped `.codex/config.toml` and user-scoped `~/.codex/config.toml`. For a project-scoped file, a relative command works when Codex starts the server in the repository:

```toml
[mcp_servers.codebase_mentor]
command = "node"
args = ["--env-file-if-exists=mcp/.env", "mcp/src/stdio.js"]
startup_timeout_sec = 10
tool_timeout_sec = 60
enabled = true
```

For a user-scoped file, use an absolute script path:

```toml
[mcp_servers.codebase_mentor]
command = "node"
args = ["/absolute/path/to/repo/mcp/src/stdio.js"]
env = { CODEBASE_MENTOR_API_URL = "https://mentor.example.com" }
startup_timeout_sec = 10
tool_timeout_sec = 60
enabled = true
```

HTTP form:

```toml
[mcp_servers.codebase_mentor]
url = "http://127.0.0.1:3921/mcp"
bearer_token_env_var = "MCP_HTTP_TOKEN"
startup_timeout_sec = 10
tool_timeout_sec = 60
```

You can also register it with `codex mcp add`:

```sh
codex mcp add codebase_mentor -- node /absolute/path/to/repo/mcp/src/stdio.js
```

`codex mcp list` shows the configured server. Restart the Codex client or IDE extension after changing configuration.

Official reference: <https://developers.openai.com/codex/mcp/>

## Claude Code

Claude Code reads project-scoped `.mcp.json` or user-scoped configuration. Project `.mcp.json`:

```json
{
  "mcpServers": {
    "codebase_mentor": {
      "type": "stdio",
      "command": "node",
      "args": ["mcp/src/stdio.js"]
    }
  }
}
```

HTTP form:

```json
{
  "mcpServers": {
    "codebase_mentor": {
      "type": "http",
      "url": "http://127.0.0.1:3921/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_HTTP_TOKEN}"
      }
    }
  }
}
```

Claude Code expands `${MCP_HTTP_TOKEN}` from its environment. Project-scoped servers require approval on first use in an interactive session. The CLI equivalents are:

```sh
claude mcp add --transport stdio codebase_mentor -- node /absolute/path/to/repo/mcp/src/stdio.js
claude mcp add --transport http codebase_mentor http://127.0.0.1:3921/mcp --header "Authorization: Bearer $MCP_HTTP_TOKEN"
```

Official reference: <https://docs.claude.com/en/docs/claude-code/mcp>

## OpenCode

OpenCode 2.x stores MCP servers under `mcp.servers`. Put this in the project's `opencode.json` or `opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "codebase_mentor": {
        "type": "local",
        "command": ["node", "mcp/src/stdio.js"],
        "codemode": false
      }
    }
  }
}
```

`codemode: false` exposes the four tools directly. With Code Mode enabled, OpenCode exposes them through its `execute` tool under the server namespace instead.

HTTP form:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "codebase_mentor": {
        "type": "remote",
        "url": "http://127.0.0.1:3921/mcp",
        "headers": {
          "Authorization": "Bearer {env:MCP_HTTP_TOKEN}"
        },
        "oauth": false,
        "codemode": false
      }
    }
  }
}
```

Use absolute paths when the configuration lives in the global `~/.config/opencode/opencode.json`. OpenCode 1.x used entries directly under `mcp` with `enabled`; the installed OpenCode 2.x uses `mcp.servers` and `disabled`.

Official reference: <https://opencode.ai/docs/mcp-servers/>

## Cursor

Cursor reads project `.cursor/mcp.json` or user `~/.cursor/mcp.json`. Project STDIO form:

```json
{
  "mcpServers": {
    "codebase_mentor": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/mcp/src/stdio.js"]
    }
  }
}
```

HTTP form:

```json
{
  "mcpServers": {
    "codebase_mentor": {
      "url": "http://127.0.0.1:3921/mcp",
      "headers": {
        "Authorization": "Bearer ${env:MCP_HTTP_TOKEN}"
      }
    }
  }
}
```

Cursor supports `${workspaceFolder}` and `${env:NAME}` interpolation in `command`, `args`, `env`, `url`, and `headers`. For a global configuration, use an absolute script path instead of `${workspaceFolder}`.

Official reference: <https://cursor.com/docs/mcp>

## Generic MCP client

STDIO:

```json
{
  "mcpServers": {
    "codebase_mentor": {
      "command": "node",
      "args": ["/absolute/path/to/repo/mcp/src/stdio.js"]
    }
  }
}
```

Streamable HTTP:

```json
{
  "mcpServers": {
    "codebase_mentor": {
      "type": "http",
      "url": "http://127.0.0.1:3921/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

Any client that implements MCP tools over STDIO or Streamable HTTP can use the same four tools. Resources and resource templates are intentionally empty.

## Windows one-click setup

From the extracted project, double-click `Install-Codebase-Mentor.bat` once. It checks Node.js 24+, installs backend/MCP dependencies, creates missing `.env` files from examples, safely updates only the `codebase_mentor` entry in the active Codex `config.toml`, backs up the previous config, and starts the backend. Reload VS Code once. Later, use `Start-Codebase-Mentor.bat` or `Stop-Codebase-Mentor.bat` to manage the local backend.

After setup, open a public GitHub repository in Codex and ask your question. The bridge detects the current workspace's `origin` or `upstream` remote, selects its latest snapshot, and starts analysis if none exists. The first analysis may take several minutes. `snapshotId` can still be supplied to pin a question to a specific commit/snapshot.

This flow currently works with public GitHub repositories only. Private repositories and repositories without a public GitHub remote require a future local/private analyzer integration. If a harness launches MCP servers outside the repository workspace, set `CODEBASE_MENTOR_REPOSITORY_URL` to the correct public GitHub URL in that harness's environment.

## Tools

| Tool | Purpose |
| --- | --- |
| `get_task_context` | Retrieve compact, source-cited context for a task from one snapshot. |
| `inspect_symbol` | Inspect an exact or lexically matched symbol and its direct relationships. |
| `explore_dependencies` | Explore bounded, typed dependencies around a symbol. |
| `check_context_drift` | Validate stored source reference IDs against the immutable analyzed snapshot. |

`snapshotId` is optional. Without it, the MCP server resolves the latest snapshot for the current workspace’s public GitHub origin; if none exists, it triggers analysis through the existing backend API and waits for completion. Explicit snapshot IDs are supported for reproducible pinned requests. The tools are annotated read-only. The MCP package never opens SQLite directly; retrieval calls reach the existing Agent Context Bridge routes under `/api/snapshots/:id/agent-context`.

`check_context_drift` checks stored evidence against the snapshot record. It does not read live working-tree files, so a successful result means "snapshot consistent, live unverified." The same caveat applies to every response's `freshness` field. Token counts are byte-based estimates, not vendor tokenizer counts.

## Verification

MCP unit and protocol tests use a fake backend, so they do not need SQLite or the real backend:

```sh
cd mcp
npm test
```

Integration verifiers start the real MCP entry points and call the running backend. Set `SNAPSHOT_ID` to a completed snapshot:

```sh
cd mcp
SNAPSHOT_ID=<snapshot-id> npm run verify
SNAPSHOT_ID=<snapshot-id> npm run verify:http
```

They list and call all four tools, check citations, exercise bounded errors, and confirm the retrieval cache. The HTTP verifier also checks 401 without a token, 403 for a disallowed Origin, 405 for GET, 415 for the wrong content type, and 413 for an oversized body. They never open the SQLite file.

Harness-level status for the earlier baseline (not rerun after the automatic-snapshot/installer changes):

| Harness | Previous evidence | Current status for this archive |
| --- | --- | --- |
| Codex CLI | Previous config entry was discovered; model invocation was blocked by account usage limits. | Configuration instructions exist; rerun live invocation after installing this build. |
| Claude Code | Previous temporary config connected and exposed all four tools; model invocation was blocked by billing. | Configuration documented; not reverified after this build. |
| OpenCode | Previous build completed a real tool invocation against a saved snapshot. | Configuration documented; rerun after this build's backend client changes. |
| Cursor | Previous environment could not run a headless invocation. | Documentation only; not runtime-verified. |
| Generic MCP SDK client | Earlier protocol tests passed against a fake backend. | Tests must be rerun on this build; dependency installation did not complete in the packaging environment. |

No current harness-level success is inferred from the previous build's results.

## Troubleshooting

- **No tools appear in the harness.** Confirm the server is configured under the correct key for that harness and version. OpenCode 2.x requires `mcp.servers`. Restart or reconnect the client after editing configuration.
- **STDIO server starts but the client reports invalid JSON.** Make sure stdout contains only MCP messages. Do not launch the entry point through `npm run`, shell banners, or logging wrappers.
- **Backend unreachable.** Use `Start-Codebase-Mentor.bat`; check `GET /api/health` and the logs under `backend/data/`. The MCP server starts a local backend automatically when using its default loopback URL if dependencies are installed.
- **Repository cannot be detected.** The bridge checks the current workspace Git origin. Open the target repository as the agent workspace, or set `CODEBASE_MENTOR_REPOSITORY_URL` in the harness environment. Only public GitHub URLs are supported currently.
- **`Snapshot not found`.** When the bridge has identified a public GitHub repository and omitted `snapshotId`, it attempts analysis automatically. An explicit unknown `snapshotId` is never silently replaced.
- **HTTP 401 from MCP.** The `Authorization` header must be exactly `Bearer <MCP_HTTP_TOKEN>`.
- **HTTP 403 from MCP.** The request has an `Origin` header that is not the loopback endpoint or an entry in `MCP_HTTP_ALLOWED_ORIGINS`.
- **HTTP 405/415/413.** Use POST, `Content-Type: application/json`, and a body no larger than 1 MiB.
- **Windows path issues.** Use forward slashes or escaped backslashes in JSON. In TOML, quoted Windows paths are literal strings. Prefer an absolute path for user-level configuration.
