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

For the Streamable HTTP form, use the separate script and append the client name: `npm run print-config:http -- codex`. Do not pass `--http` through `npm run`, because npm consumes that flag as its own proxy setting. The STDIO output uses the current Node executable and an absolute path to `mcp/src/stdio.js`. If `CODEBASE_MENTOR_API_URL` is set when the helper runs, it is included in the generated entry. The HTTP output uses `MCP_HTTP_URL` or the default endpoint.

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

## Tools

| Tool | Purpose |
| --- | --- |
| `get_task_context` | Retrieve compact, source-cited context for a task from one snapshot. |
| `inspect_symbol` | Inspect an exact or lexically matched symbol and its direct relationships. |
| `explore_dependencies` | Explore bounded, typed dependencies around a symbol. |
| `check_context_drift` | Validate stored source reference IDs against the immutable analyzed snapshot. |

All tools require `snapshotId`. They are annotated read-only. The MCP package never opens the database; every call becomes a POST to one of the backend routes under `/api/snapshots/:id/agent-context`.

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

Harness-level status on the verification machine:

| Harness | Version | Evidence | Status |
| --- | --- | --- | --- |
| Codex CLI | 0.164.0-alpha.11.1 | `codex mcp list` shows `codebase_mentor` enabled with the project STDIO configuration. A model invocation was blocked by the ChatGPT account usage limit. | Configuration discovered; tool invocation not verified. |
| Claude Code | 2.1.247 | A temporary `--mcp-config` with `--strict-mcp-config` reported `codebase_mentor` as `connected` and exposed all four `mcp__codebase_mentor__*` tools. The model call then failed with `Credit balance is too low`. | Connection and tool discovery verified; tool invocation blocked by billing. |
| OpenCode | 2.1.4 | A project-scoped `mcp.servers` configuration connected with four tools. A real `opencode run --standalone` call invoked `codebase_mentor_get_task_context` and returned the requested snapshot identity and an estimated token count. | Verified end to end before the backend split; rerun after configuring the backend URL. |
| Cursor | 3.7.12 | The installed IDE launcher exposes no working headless agent or MCP invocation command, and the standalone Cursor `agent` CLI is not installed. Configuration follows the official `.cursor/mcp.json` format. | Documentation only; not runtime-verified. |
| Generic SDK client | `@modelcontextprotocol/sdk` 1.32.2 | STDIO and HTTP verifiers list and call all four tools against a fake backend, and the integration verifiers call the real backend. | Verified end to end. |

No client configuration files were modified by the verifier. Temporary configurations were used for Claude Code and OpenCode, and the repository's Codex registration was left in place.

## Troubleshooting

- **No tools appear in the harness.** Confirm the server is configured under the correct key for that harness and version. OpenCode 2.x requires `mcp.servers`. Restart or reconnect the client after editing configuration.
- **STDIO server starts but the client reports invalid JSON.** Make sure stdout contains only MCP messages. Do not launch the entry point through `npm run`, shell banners, or logging wrappers.
- **Backend unreachable.** Start the backend or set `CODEBASE_MENTOR_API_URL` to the hosted API. Check `GET /api/health` on the backend.
- **`Snapshot not found`.** The backend does not have that snapshot. Analyze the repository first, or use the snapshot ID from the app.
- **HTTP 401 from MCP.** The `Authorization` header must be exactly `Bearer <MCP_HTTP_TOKEN>`.
- **HTTP 403 from MCP.** The request has an `Origin` header that is not the loopback endpoint or an entry in `MCP_HTTP_ALLOWED_ORIGINS`.
- **HTTP 405/415/413.** Use POST, `Content-Type: application/json`, and a body no larger than 1 MiB.
- **Windows path issues.** Use forward slashes or escaped backslashes in JSON. In TOML, quoted Windows paths are literal strings. Prefer an absolute path for user-level configuration.
