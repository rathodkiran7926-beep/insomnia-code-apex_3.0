# Phase 2 implementation plan

Spec: complete Phase 2 task supplied on 24 October 2026; relevant identity,
binding, IDE context, trust and testing sections of the implementation guide.

Audit: Phase 1's five source modules, scripts, tests, manifest, README and
verification report were inspected. Fresh check, all 14 tests and build passed.
Existing changes remain uncommitted and will be preserved. GET
/api/snapshots/:id returns graph JSON plus documentation; metadata fields are
snapshotId, repository, commit, report.limitations. No repository-list endpoint
exists. No backend or frontend change is required.

Design: retain the health connection and HTTP transport. Add validated snapshot
metadata at the API boundary; keep only metadata, never the graph. Bind each
workspace URI to a snapshot and the normalized full backend base URL (including
proxy prefix). Read Git using the built-in vscode.git API v1; do not shell out.
Use native input/picker/confirmation and tree rows. Keep editor positions 0-based
and conversion to 1-based explicit. Trust gates Git and context collection and
snapshot connection/restoration; health remains available in Restricted Mode.

Tasks, executed inline with test-first changes:
- [x] Test and implement GitHub identity normalization, snapshot validation,
  commit comparison and independent versioned Memento bindings.
- [x] Test and implement workspace paths, Git metadata/events and editor
  context. Validate URI scheme/authority and Windows containment boundaries.
- [x] Test and implement connection orchestration: explicit confirmation,
  mismatch rejection, restoration, refresh, cancellation, server changes and
  disconnect. Re-check local evidence after asynchronous confirmation.
- [x] Wire events, commands and native views. Cursor events only refresh local
  metadata; snapshot requests occur on explicit action/restoration/reconnection.
- [x] Add real existing-backend snapshot integration and Extension Host checks;
  preserve the original regression tests. Verify restart and multi-root state.
- [x] Run typecheck/tests/build/host/package/archive inspection/diff check and
  independent critical review. Document unverified UI or remote behavior. No
  commits, analysis, AI, graph rendering or other later-phase implementation.

Reference: official microsoft/vscode extensions/git/src/api/git.d.ts and VS Code
workspace/URI/editor API documentation, verified before adapter implementation.
The guide's first-folder-only binding snippet is insufficient for this phase;
all multi-root commands require a folder picker. Remote credentials never leave
the Git adapter; only canonical public GitHub identity is exposed or persisted.
