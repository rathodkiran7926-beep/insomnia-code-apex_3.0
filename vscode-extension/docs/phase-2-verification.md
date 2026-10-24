# Phase 2 verification — 24 October 2026

## Audit and implementation

The full Phase 2 request, relevant implementation-guide sections, Phase 1
verification report, all existing extension source/build/test files, backend
snapshot/analysis routes and frontend snapshot types were inspected first.
Fresh baseline: strict TypeScript check passed, 14 tests passed, build passed.
All original uncommitted Phase 1 work was preserved. No backend/frontend/shared
production file was changed, and no new dependency was added.

The extension reuses GET /api/health and GET /api/snapshots/:id on the existing
server. The latter returns snapshotId, repository, commit, components,
references, relationships, report and documentation. Phase 2 validates only
consumed metadata and envelope identity, then discards the graph/source excerpts.
No repository lookup/listing API was invented.

Bindings use versioned workspaceState records keyed by workspace-folder URI,
scoped to the normalized full backend URL, including a reverse-proxy prefix.
Only canonical GitHub identity, snapshot ID, indexed commit, workspace URI,
backend URL and connection timestamp are persisted. Git identity and local HEAD
are compared separately. Full equal SHA-1 commit IDs establish a match; partial
SHAs never do. Unknown identity requires an explicit unverified confirmation;
a confirmed repository mismatch is rejected. Revision mismatches are allowed
with explicit warning. Repository state is derived from current Git metadata,
never folder display names.

The Git adapter uses only a typed, read-only subset of built-in vscode.git API
v1. Its API was checked against the official 1.100 and current declarations.
No production shell Git calls, AST parsing, file scanning, source-content reads,
uploads, AI or graph inference were introduced. Restricted Mode keeps health
available but gates Git/editor context and snapshot connection/restoration.

## Commands and actual results

Commands below ran from vscode-extension/ during Phase 2, not merely in Phase 1.

| Command | Result |
| --- | --- |
| `npm.cmd run check` | Passed strict TypeScript checking |
| `npm.cmd test` | Passed 30/30 tests, including all original regression scenarios |
| `npm.cmd run build` | Passed; production bundle approximately 24.85 KB |
| `npm.cmd run test:host` | Passed all four desktop scenarios described below |
| `npm.cmd run package:vsix` | Passed; 7 VSIX archive entries, approximately 14.54 KB |
| `npm.cmd run package:list` | Only LICENSE.txt, package.json, README.md, dist/extension.js, resources/icon.svg |
| `code.cmd --user-data-dir .host-test/vsix-user --extensions-dir .host-test/vsix-extensions --install-extension .\codebase-mentor-0.1.0.vsix --force` | Final Phase 2 VSIX installed successfully in isolated test directory |
| `git diff --check` | Passed; only Git's Windows line-ending notices |

Environment: Windows, Node 24.15.0, npm 11.12.1, installed VS Code 1.143.1.
Build outputs and the local VSIX are ignored. There are no runtime npm
dependencies. Installation/audit were not repeated because Phase 2 adds no
dependencies; Phase 1's tooling override remains documented in README.

## Automated coverage

Tests cover single/multi-root/no workspace; outside-workspace, untitled and
unsupported documents; Windows URI casing and containment; remote authority
isolation; GitHub HTTPS/SSH normalization and credential removal; missing Git;
Git API events/disablement/disposal; verified/mismatched/unverified identity;
matched/different/unknown commits; dirty working trees and unsaved editors;
exact 0-based selections and inclusive backend line conversion; malformed
snapshot responses and 404; independent persistence/removal; backend URL and
prefix changes; restart restoration; obsolete request cancellation; and disposal.

Cursor-event regression fires twenty selection events and verifies the backend
request count does not change. The editor document fixture throws if getText()
is called. Snapshot graphs are never stored in bindings.

The existing-backend integration harness invokes the existing backend analyze,
documentGraph (generateAI:false), saveSnapshot and server modules with bounded
deterministic test source. It uses DATABASE_PATH=:memory:, no .env, provider
calls or GitHub access. Tests read an actual stored snapshot through the actual
GET endpoint, verify missing snapshots, connect, restart the controller from
saved Memento data, stop the server, verify Unavailable, restart it and recover.
The harness is test-only, excluded from the VSIX, and duplicates no analyzer.

Deterministic asynchronous-persistence regressions prove:

- Disconnect cancels a refresh and ignores its late response.
- A canceled connection cannot resurrect a disconnected binding.
- Restoration during pending removal cannot reload the removed binding.
- Refresh/restoration during a confirmed save keep active and persisted snapshot
  IDs consistent. Reads wait for saves; operation generations reject stale work.

## Real desktop and UI verification

The final `npm.cmd run test:host` completed successfully in four isolated cases:

1. **Empty window:** activation, all contributed registrations, three views,
   original commands, actual health response and invalid-URL recovery.
2. **Single repository:** actual snapshot input and explicit connection
   confirmation, verified identity/matched revision from built-in Git, editor
   selection and unsaved-state metadata, refresh, actual branch and HEAD change,
   and Change Snapshot with different-revision confirmation. The rendered Focus
   snapshot ID and revision warning are asserted in the workbench DOM.
3. **Restart:** reopen the same workspace/profile in a new VS Code process,
   restore the saved changed snapshot, retain the honest different-revision
   status, refresh and disconnect.
4. **Multi-root:** interact with the real folder picker twice, bind two generated
   Git repositories to independent real snapshots, refresh, disconnect one and
   verify the other survives. The rendered sidebar is checked and captured.

The built-in extension-test runner deliberately rejects modal dialogs with
“DialogService: refused to show dialog in tests.” Empty-window tests retain that
runner; interactive tests use normal isolated Extension Development Hosts and
a generated test-only companion extension. CDP drives the real workbench picker,
input and confirmation; no production UI method is mocked. Result markers and
assertions verify state, and screenshot capture waits for native tree refresh.

Latest passing log: `.host-test/phase2-run.log`. Desktop artifacts live under
`.host-test/phase2-wzgGyO/`, including `single/focus.png`, `multi/focus.png` and
per-scenario result files. Screenshots were visually inspected in an earlier
passing run; final DOM assertions also verify the displayed snapshot and
revision text. Generated Git mutations occur only inside the test fixtures,
with hooks/templates disabled. The fixture is reset between branch-change and
multi-root scenarios. Normal user extensions/settings and project Git state
are not modified by those tests. Owned test windows and backend are stopped.

## Problems found and fixed

- The guide's first-folder-only connection snippet was unsuitable for multi-root;
  commands now pick a folder and persist by URI, never display name.
- Root URI casing could hide available Git metadata on Windows. Equality and
  containment now use the same scheme/authority/Windows-case rules.
- Map/Changes initially derived an active binding directly from the workspace,
  bypassing the nested-repository guard. They now use validated editor context.
- Disconnect/confirmation rollback could revive deleted in-memory bindings.
  Disconnect clears state immediately and coordinates pending removal.
- Refresh during asynchronous save could display an old snapshot while storage
  contained a new one. Pending-save coordination and generations fix both
  refresh and restoration, with reproduced regression tests.
- Git can be missing initially and later become available. Initialization can
  retry without duplicating successful subscriptions; disablement clears state.
- Native tree rendering is asynchronous. UI tests now wait for rendered labels
  before claiming sidebar success, rather than relying on command completion.
- Context7 npm access was blocked; official Microsoft documentation was checked
  through the web tool. No dependency was installed as a workaround.

Independent read-only review reported no remaining blockers after the race
fixes; its focused binding suite passed 8/8. The final full suite passed 30/30.

## Files and scope

New Phase 2 production modules:

- `src/repository.ts`: canonical identity, metadata validation, revision
  comparison and minimal versioned binding storage.
- `src/repositoryController.ts`: connect/restore/refresh/disconnect orchestration,
  confirmation, cancellation, persistence coordination and derived context.
- `src/vscode-adapters/workspaceContext.ts`: folders, trust, safe URI paths/picker.
- `src/vscode-adapters/gitContext.ts`: read-only built-in Git metadata and events.
- `src/vscode-adapters/editorContext.ts`: safe selection/dirty/binding metadata.
- `src/commands/repositoryCommands.ts`: four new real command handlers.

Extended Phase 1 files: `package.json` contributions/trust description;
`src/api-client/client.ts` snapshot GET and backend identity; `src/extension.ts`
registration/events/read-only context API; `src/commands/register.ts` health retry
restores bindings; `src/views/mentorTree.ts` repository context rows and actions;
`README.md`; `scripts/test.mjs`, `scripts/test-host.mjs`; and activation, backend,
host and editor-API-substitute tests.

New tests: `test/repository.test.cjs`, `test/adapters.test.cjs`,
`test/bindings.test.cjs`, `test/backend-fixture.mjs`, `test/ui-driver.mjs`.
New documentation: this report and `docs/phase-2-plan.md`.

## Remaining limits and Phase 3

Real SSH/WSL/container environments, non-Windows hosts and VS Code 1.100 runtime
were not exercised. Remote URI isolation and unavailable metadata are covered
by deterministic tests. Light/high-contrast themes were not visually reviewed;
native TreeItems/ThemeIcons inherit VS Code themes. No production auth, ACLs or
Marketplace publication was added or tested; the backend remains local/public
repository oriented. The development-tool MSAL override remains as in Phase 1.

Phase 3 can reuse the metadata/context API and backend-scoped bindings. It must
still implement the backend selection resolver before selection-based AI calls,
preserve pinned snapshot evidence and warn on different/unknown local revisions.
No AI Mentor, source-symbol resolution, architecture graph, PR tracking,
handoff, checkpoint or later-phase feature was implemented.

Git initially contained all uncommitted Phase 1 files. All final changes and new
files remain under vscode-extension/; no commits were created. Generated
artifacts and test profiles remain ignored. See `git status --short` and
`git ls-files --others --exclude-standard vscode-extension` for the complete
inventory, including the preserved Phase 1 files.
