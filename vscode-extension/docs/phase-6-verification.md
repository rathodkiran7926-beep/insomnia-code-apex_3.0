# Phase 6 - Work Context Time Machine verification

Date: 2026-10-24. Scope: Phase 6 only; previous Phase 4/5 uncommitted work preserved.
No Phase 7 implementation, commits, deployment or Marketplace publication.

## Architecture and implementation

IDE metadata -> editable user fields -> explicit preview/confirmation -> centralized
HTTP client -> existing shared Express backend -> existing SQLite file -> resume
with original notes and bounded evidence -> existing Source/Map/Mentor adapters.
The extension has no checkpoint database, analyzer or AI workflow. Checkpoint
state in the extension is transient and bounded to one page/detail/resume.

- `backend/src/checkpoints.js`: additive version-1 table/index migration,
  transactionally persisted UUIDs, idempotent request IDs, exact user note strings,
  repository-scoped list/detail/delete, backend-derived snapshot identity, validated
  source references, bounded stored-file comparison and exact existing PR lookup.
- `backend/src/checkpointRoutes.js`, `ideRoutes.js`: shared API endpoints, no-store
  responses, disabled-default capability and explicit single-user loopback guard.
- `src/api-client/checkpointContracts.ts`, `client.ts`: bounded runtime validation,
  shared cancellation/timeouts/transport, private error handling, exact approved
  create-result checks and snapshot/reference provenance validation.
- `src/checkpointController.ts`: availability, pagination, serialized mutation,
  uncertain-outcome messaging, cancellation, context invalidation and stale guards.
- `src/views/checkpointContent.ts`, `checkpointPanel.ts`, `savedTasks.ts`,
  `mentorTree.ts`, `media/checkpoints.js`, `mentor.css`: native Saved Tasks tree,
  escaped nonce-CSP local panel, empty authored fields, editable preview, original
  note display, evidence/version labels and confirmed deletion.
- `src/commands/checkpointCommands.ts`, `extension.ts`: registration, existing
  selection resolver, optional evidence attachment, temporary original-snapshot
  Source/Map/Mentor, stored-file diff and existing exact PR review integration.
- `comparisonContexts.ts`, `sourceNavigation.ts`, `mentorController.ts`,
  `prController.ts`: small extensions to existing temporary contexts/navigation,
  reference metadata reuse and safe stored-comparison loading.
- Tests/harness, package manifest, READMEs, `.env.example` and phase plan updated.
  No runtime npm dependency was added. Actual `.env` was not edited.

## Security and evidence limits

`CODEBASE_MENTOR_LOCAL_CHECKPOINTS=1` must be deliberately enabled on the backend.
It is disabled by default. Data routes require direct loopback local/remote socket
addresses, loopback Host, safe local Origin when present, no proxy forwarding
headers and no cross-site Fetch Metadata. This is a local single-user guard,
not authentication, per-user ACLs, proxy protection or secure hosted sharing.
Test children enable it explicitly; normal backend configuration was not changed.

Only approved title, authored notes, reference IDs and extension-reported Git
branch/HEAD/status are sent. No source/buffer upload, automatic save, checkpoint
polling, automatic POST retry, telemetry or logging of notes was introduced.
A failed/aborted mutation may have reached SQLite: Refresh before deliberate retry;
identical Save retries reuse the approved request ID. Backend validation rejects
client identity/commit overrides, unsafe paths and mismatched immutable citations.

Snapshot identity and indexed commit are backend-derived. Local Git is separately
labelled extension-reported. Commit mismatch does not establish a source change.
Comparison is limited to up to eight approved, same-path complete stored files,
at most 300KB each; missing, renamed, excluded or unmapped evidence stays unknown.
File text equality/difference is not semantic impact or a local-worktree comparison.
Missing saved snapshots preserve original notes with unavailable source actions.
Existing PR review requires exact stored saved/current snapshot and commit pairs;
resume never creates analysis. Persistent workspace binding/files/branches are
unchanged. The desktop harness changes only its ignored fixture clones.

## Verification evidence

Baseline before Phase 6: backend 67/67; extension 98/98, strict typecheck and build.
Final command results and desktop/artifact evidence are recorded below.

- `cd backend; npm.cmd test`: **79/79 pass**, zero failures/skips.
  Log: `../vscode-extension/.host-test/phase6-backend.log`.
- `cd vscode-extension; npm.cmd run check`: **pass**, strict TypeScript.
- `npm.cmd test`: **122/122 pass**, zero failures/skips.
  Log: `.host-test/phase6-unit.log`.
  Includes real backend HTTP/SQLite, defaults/security boundary, validation,
  rollback/idempotency/concurrency, cross-repository isolation, missing snapshot,
  immutable references, unknown/verified file evidence, process persistence,
  malicious rendering, duplicate Save, save/refresh races, late response rejection,
  original-snapshot actions, stored PR review and previous feature regressions.

### Real desktop and artifact checks

`npm.cmd run test:host`: **8/8 scenarios pass**, exit 0, against installed Windows
VS Code 1.143.1 x64. Log `.host-test/phase6-final-host.log`; isolated run folder
`.host-test/phase2-e1F7Un/`. Empty uses the actual Extension Host test runner;
seven nonempty cases use the actual Development Host and test-only companion
because VS Code disables modal dialogs under extensionTestsPath. CDP drives real
native rows, confirmation dialogs and panel buttons. No mocked desktop claim.

Scenarios: empty, single, restart, multi, public, checkpoint-save,
checkpoint-resume and checkpoint-delete. Existing selection/citation/follow-up,
Map, dirty/indexed context and binding regressions run alongside checkpoint work.
The checkpoint fixture is real public `sindresorhus/p-limit`, indexed commit
`a8a6fbec4e0e866d6d779b10889bb4f5567e70eb`, snapshot
`0c97743b56b972dfae496ac0`, component `limitFunction`, reference 19,
`index.js:133-142`. Notes are controlled **test-user input**, explicitly typed
into initially empty fields; they are not a developer's private notes or generated
production content. No checkpoint exists before preview confirmation. The Save
case also refreshes while typing and verifies the exact draft survives.

VS Code exits between checkpoint scenarios using the same isolated profile.
The existing backend exits/restarts twice with the same file SQLite database.
A branch change and real empty Git commit in the ignored clone establish a local
HEAD mismatch; the indexed snapshot stays unchanged. Resume retrieves exact
notes/reference IDs from persistence, opens read-only source at the cited line,
opens Map/Mentor with the original snapshot, preserves those contexts on same-task
Refresh and leaves the persistent workspace binding unchanged. Delete is clicked
in the panel, confirmed in the native modal, then GET returns 404 while the saved
repository snapshot and workspace binding still exist. Saved/resumed proof images
are in the run folder's `checkpoint/checkpoint-{saved,resume}-proof.png` and were
visually inspected. Test notes/screenshots/database remain ignored artifacts.

`npm.cmd run build:dev`, production `npm.cmd run build` (also run by prepublish),
`npm.cmd run package:vsix`, `npm.cmd run package:list`: **pass**.
Final `codebase-mentor-0.1.0.vsix`: **53,821 bytes**, ten ZIP entries including
manifest metadata, eight shipped extension files. Archive inspection confirms
checkpoint JS and bundle are present; no source trees, dependencies, source maps,
logs, test profiles or environment files are included.
SHA256: `a76f2822937bbb6ffb327845263345e1d9b3791318cdc1543cd2ab77946a3eab`.

`code.cmd --user-data-dir .host-test/phase6-package/user-data --extensions-dir
.host-test/phase6-package/extensions --install-extension ./codebase-mentor-0.1.0.vsix
--force`: **pass**; isolated `--list-extensions --show-versions` reports
`codebase-mentor-local.codebase-mentor@0.1.0`. Normal user profile was not targeted.
`git diff --check`: **pass** (Git line-ending conversion notices only).

## Review and corrections

Independent backend/contract review identified mismatched citation fragments and
verified file-change results lacking current evidence. Backend citation checks now
match immutable file/range fragments; client contracts require current references.
Root integration review fixed unsent draft loss on Refresh, incorrect PR-style
labels in checkpoint diffs, unknown/stale checkpoint IDs, and local PR waiting
continuing during a switch to an existing stored comparison. Tests cover these.

The full desktop suite then exposed stale native Saved Tasks child actions: the
stable tree group could retain children built with an earlier view token. A new
regression failed with `old !== current` before the fix. Saved Tasks now reads
current children on request. Native list actions carry a stable repository-binding
context guard, while panel detail actions retain their individual view tokens.
This avoids invalidating a saved-task row when only the detail view changes,
while rejecting other repositories/backends and unknown/deleted IDs. All 122 tests
pass afterward. Screenshot review also exposed same-checkpoint Refresh clearing
its temporary Map/Mentor session. A failing regression confirmed it; retaining
the original immutable detail while refreshing the same ID preserves navigation,
while a different task or repository still invalidates it. Desktop assertions
now check Map/Mentor remain valid after that Refresh. Bounded test diagnostics contain status/IDs, not note strings.

## Remaining limits and Phase 7 readiness

Windows desktop is the exercised environment. WSL, SSH, containers, macOS/Linux,
real private repositories, multi-user deployment and Marketplace publication were
not verified. Live PR worker verification is opt-in and was not rerun in Phase 6;
controlled PR regressions remain in the test suites. No hosted synchronization,
secure sharing, semantic history, arbitrary snapshot impact or local diff analyzer
is claimed. SQLite must retain its configured database path across server restarts.

Versioned backend records, exact authored context, repository/snapshot/commit IDs
and validated references provide a foundation for Smart Context Handoff. Phase 7
still requires explicit sharing design, authentication, authorization, recipient
scope, expiry/revocation and privacy review; checkpoint persistence alone provides
none of those capabilities. Phase 7 was not started.

## Final Git status

21 tracked modified files and 45 untracked path entries (including pre-existing
Phase 4/5 work); all left uncommitted. No commits were created. Generated VSIX,
bundles, logs, profiles, fixture clones and databases are ignored. Full status:

```text
 M backend/.env.example
 M backend/README.md
 M backend/src/ideRoutes.js
 M vscode-extension/README.md
 M vscode-extension/media/mentor.css
 M vscode-extension/package.json
 M vscode-extension/scripts/test-host.mjs
 M vscode-extension/scripts/test.mjs
 M vscode-extension/src/api-client/client.ts
 M vscode-extension/src/extension.ts
 M vscode-extension/src/mentorController.ts
 M vscode-extension/src/views/mentorContent.ts
 M vscode-extension/src/views/mentorPanel.ts
 M vscode-extension/src/views/mentorTree.ts
 M vscode-extension/src/vscode-adapters/sourceNavigation.ts
 M vscode-extension/test/host.ts
 M vscode-extension/test/mentor-controller.test.cjs
 M vscode-extension/test/mentor-render.test.cjs
 M vscode-extension/test/source-navigation.test.cjs
 M vscode-extension/test/ui-driver.mjs
 M vscode-extension/test/vscode-stub.cjs
?? backend/src/checkpointRoutes.js
?? backend/src/checkpoints.js
?? backend/src/ideNeighborhood.js
?? backend/test/checkpoints.test.js
?? backend/test/helpers/
?? backend/test/ideNeighborhood.test.js
?? backend/test/prRoutes.test.js
?? vscode-extension/docs/phase-4-plan.md
?? vscode-extension/docs/phase-4-verification.md
?? vscode-extension/docs/phase-5-plan.md
?? vscode-extension/docs/phase-5-verification.md
?? vscode-extension/docs/phase-6-plan.md
?? vscode-extension/docs/phase-6-verification.md
?? vscode-extension/media/checkpoints.js
?? vscode-extension/scripts/test-pr-live.mjs
?? vscode-extension/src/api-client/atlasContracts.ts
?? vscode-extension/src/api-client/checkpointContracts.ts
?? vscode-extension/src/api-client/prContracts.ts
?? vscode-extension/src/atlasController.ts
?? vscode-extension/src/checkpointController.ts
?? vscode-extension/src/commands/atlasCommands.ts
?? vscode-extension/src/commands/checkpointCommands.ts
?? vscode-extension/src/commands/prCommands.ts
?? vscode-extension/src/comparisonContexts.ts
?? vscode-extension/src/prController.ts
?? vscode-extension/src/views/atlasTree.ts
?? vscode-extension/src/views/changesTree.ts
?? vscode-extension/src/views/checkpointContent.ts
?? vscode-extension/src/views/checkpointPanel.ts
?? vscode-extension/src/views/savedTasks.ts
?? vscode-extension/test/atlas-client.test.cjs
?? vscode-extension/test/atlas-contracts.test.cjs
?? vscode-extension/test/atlas-controller.test.cjs
?? vscode-extension/test/atlas-ui.test.cjs
?? vscode-extension/test/changes-tree.test.cjs
?? vscode-extension/test/checkpoint-actions.test.cjs
?? vscode-extension/test/checkpoint-client.test.cjs
?? vscode-extension/test/checkpoint-contracts.test.cjs
?? vscode-extension/test/checkpoint-controller.test.cjs
?? vscode-extension/test/checkpoint-render.test.cjs
?? vscode-extension/test/comparison-context.test.cjs
?? vscode-extension/test/pr-actions.test.cjs
?? vscode-extension/test/pr-client.test.cjs
?? vscode-extension/test/pr-contracts.test.cjs
?? vscode-extension/test/pr-controller.test.cjs
```
