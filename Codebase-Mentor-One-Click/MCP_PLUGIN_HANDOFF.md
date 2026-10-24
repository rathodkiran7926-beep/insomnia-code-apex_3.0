# Codebase Mentor MCP Plugin — Local Quickstart and Handoff

## Intended user experience

After one initial install, the normal workflow is:

1. Open a supported repository in VS Code/Codex.
2. Run `Install-Codebase-Mentor.bat` once on this machine (or `Start-Codebase-Mentor.bat` after setup).
3. Reload VS Code once so Codex loads the shared MCP configuration.
4. Ask Codex normal codebase questions. The MCP server resolves the current workspace's public GitHub origin, reuses the latest analyzed snapshot, and starts analysis automatically when no snapshot exists. The server does not require the Codebase Mentor web UI to be open.

The installer modifies only the `codebase_mentor` MCP entry in the active Codex `config.toml`; it backs up the existing file before changing it and preserves all other entries. It creates `backend/.env` and `mcp/.env` from examples only when those files do not already exist.

## Architecture

```text
Codex
  -> shared MCP server (`mcp/src/stdio.js`)
    -> current workspace GitHub origin / latest snapshot resolver
    -> existing Codebase Mentor backend API
      -> existing analyzer, persistent graph, snapshot and source evidence
```

The MCP package does not build its own graph or open SQLite directly. It reuses the existing backend analysis API and Agent Context Bridge. Four read-only tools are exposed: `get_task_context`, `inspect_symbol`, `explore_dependencies`, and `check_context_drift`. Snapshot IDs remain optional for ordinary use, but can be supplied to pin requests to an exact analyzed snapshot.

## Requirements and current limitations

- Windows one-click scripts are provided; Node.js 24 or newer is required.
- Setup installs the backend and MCP dependencies, registers the MCP server with Codex, and starts the backend. VS Code/Codex must be reloaded once after configuration changes.
- The existing analyzer supports public GitHub repository URLs only. Private GitHub repositories and purely local filesystem analysis are not implemented.
- Automatic repository detection reads `CODEBASE_MENTOR_REPOSITORY_URL` when explicitly set, otherwise it checks the coding-agent process's current working directory for the `origin` or `upstream` Git remote. Compatible clients may launch MCP servers from different working directories; if that happens, configure the environment override in the harness.
- Automatic first-use analysis may take several minutes. The Codex tool timeout is set to 360 seconds in the generated entry. Other harnesses may apply their own call timeout settings.
- `check_context_drift` validates evidence against the stored analyzed snapshot; it does not compare the graph with uncommitted live working-tree contents.
- `Install-Codebase-Mentor.bat` performs setup and starts the local backend. `Start-Codebase-Mentor.bat` starts it later. `Stop-Codebase-Mentor.bat` stops the backend process started by these scripts. MCP can also start the backend if it is not running.

## Transport and cross-harness status

The shared MCP package supports stdio and Streamable HTTP. The Windows installer registers stdio with Codex. Other harnesses use their own installation/configuration conventions; configuration examples are in [`mcp/docs/harness-setup.md`](mcp/docs/harness-setup.md).

A configuration example is not a claim of real harness compatibility. Report per-harness status as one of: **verified** (actual harness connected and invoked a tool), **protocol-tested** (MCP SDK client test), **configuration documented**, or **unverified**. Do not state that Claude Code, OpenCode, or Cursor is verified without testing it.

## Checks performed while preparing this archive

- JavaScript syntax checks across backend source and MCP source/scripts/tests: passed.
- Config generator smoke test: passed; it emits the stdio command with absolute paths and a 360-second Codex tool timeout.
- Automatic snapshot/analysis flow: passed a controlled fake-backend exercise (latest-snapshot lookup → analysis start → job poll → retrieval). This did not exercise the actual MCP protocol SDK.
- Full MCP unit tests and live backend integration: not verified for this archive. Dependency installation timed out in the packaging environment, leaving the SDK incomplete; the available Node.js runtime was 22.16.0, below the declared Node.js 24+ requirement.
- Windows PowerShell installer execution and actual Codex invocation: not executed in this Linux packaging environment. Run the installer on Windows and verify once in Codex.

## Verification commands

```powershell
cd backend
npm.cmd test
cd ../mcp
npm.cmd test
# With backend running and a public GitHub workspace open:
npm.cmd run verify
```

MCP unit tests use a fake backend. Live verification requires a running backend and a real analyzed public GitHub repository. The available packaging environment may not include Node.js 24 or installed dependencies, so record those blockers rather than claiming unrun checks passed.
