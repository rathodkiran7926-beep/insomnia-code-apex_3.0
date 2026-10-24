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

All tools require `snapshotId`, are annotated read-only, and return snapshot identity, evidence, freshness status, and an estimated token count.

## Setup

```sh
cd mcp
npm install
```

Start the backend first. Its default URL is `http://127.0.0.1:3001`. Set `CODEBASE_MENTOR_API_URL` for a hosted API and `CODEBASE_MENTOR_API_TOKEN` when the deployment requires a bearer token.

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

Full setup, client examples, environment variables, and security notes are in [docs/harness-setup.md](docs/harness-setup.md).

## Test and verify

```sh
npm test
SNAPSHOT_ID=<snapshot-id> npm run verify
SNAPSHOT_ID=<snapshot-id> npm run verify:http
```

The unit tests use a fake backend. The verifiers start the real MCP entry points and call the running backend; they do not read the database directly.
