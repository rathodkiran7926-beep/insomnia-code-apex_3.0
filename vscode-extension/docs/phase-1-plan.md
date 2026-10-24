# Phase 1 implementation plan and audit

Specification: the supplied Phase 1 task takes precedence over the broader
Codebase_Mentor_VSCode_Extension_Implementation_Guide.md (read in full).

Architecture: native trees and commands -> centralized extension-host HTTP
transport -> existing backend. No repository analysis or workspace upload.

Audit: Git initially clean on vs-extension. Four tracked extension files were
empty; shared/ had no contracts. Backend and frontend use independent npm
lockfiles. Backend requires Node >=24; installed Node is 24.15.0. VS Code is
1.143.1. No AGENTS.md was found. backend/src/server.js exposes GET /api/health
as {ok:true}, binds 127.0.0.1:3001 (PORT override), and accepts native requests
without Origin. Its POST Origin filter is not authentication. Frontend's
analysisApi.ts uses JSON and {error} errors but lacks transport cancellation.

Existing APIs: POST /api/analyses {url,revision?}; GET /api/analyses/:id;
GET /api/snapshots/:id; GET /api/snapshots/:id/source?referenceId=...;
POST /api/snapshots/:id/questions {componentId,question}; documentation,
discussion and /api/pr routes. Snapshot responses use commit, references,
components and relationships. No IDE resolver, checkpoints or handoffs exist.

Guide corrections for this phase: omit future commands and proposed APIs;
add cancellation, timeout, response validation, redirect rejection and URL
validation to starter transport; register and dispose all trees. No backend
or frontend changes are needed. The server lacks production auth and ACLs.

Implementation checklist:
- Configure strict TS, esbuild, three contributions, F5 and VSIX packaging.
- Write transport tests first: URL policy, GET/POST, errors, timeout,
  cancellation, redirect handling, health response validation.
- Implement transport with dynamic configuration and optional header provider
  seam for future authentication (no credentials or login implemented).
- Write connection tests first: all states, retry, config changes, stale results
  and disposal; implement one cancellable request with no polling.
- Register native trees and real command handlers; show workspace name locally.
  Open Workspace reveals the Mentor Focus view, even with no folder open.
- Exercise actual activation and contributions with Extension Host tests if
  available. Use isolated user data, extensions and an in-memory backend DB.
- Run install, typecheck, tests, build, VSIX package and archive inspection.
- Perform an independent critical review; fix verified issues. Do not commit.

Future phases: snapshot association, explanations/citations, populated Atlas,
PR integration and collaboration. Existing snapshot APIs are reusable, but
selection resolution and auth/ACLs require backend work in their own phases.
