# Phase 5 verification — 24 October 2026

## Implementation and audit

Phase 5 adds PR Changes and Impact Tracking to the existing native Changes view.
Both clients use the same backend. No PR analyzer, GitHub crawler, AI workflow,
database, worker, setup detector or impact algorithm was added to the extension.
All backend PR production modules are unchanged in this phase. Existing
uncommitted Phase 4 files were preserved; no commits or Phase 6 features.

Read the complete Phase 5 task and the implementation guide's Changes, backend,
snapshot, source, security and testing sections. Inspected current extension
controllers/adapters/providers/commands/contracts/activation/manifest/tests and
Phase 1–4 reports. Audited prRoutes, prGithub, prWorker, prComparison, storage,
source/Q&A, and frontend PullRequestChanges types and API consumption. Fresh
baseline: backend 61/61; extension 68/68; strict check and production build passed.
Git already contained the uncommitted Phase 4 work against HEAD c25859f.

Verified existing contracts, without new IDE PR endpoints:

- GET /api/pr/pulls?snapshotId=...&state=all|open|closed&page=... returns the
  backend repository, page, hasMore and at most 30 real PR items.
- POST /api/pr/analyses {url} returns HTTP202 {id}; backend owns two bounded workers.
- GET /api/pr/analyses/:id returns running/complete/failed, progress/message and
  **comparison_id**, plus url. Cancellation of local requests does not stop workers.
- GET /api/pr/comparisons/:id returns pinned PR metadata, changed files,
  beforeSnapshotId/afterSnapshotId, components, edges, impact, setup and warnings.
- The worker uses merge base (baseCommit), headCommit, and distinct targetCommit.
  A head fork is valid. Merged/no-op comparisons may share a snapshot when the
  repository and commit are identical; the client accepts that consistent case.
- Existing source API returns validated complete indexed files for stored
  references. Patch excerpts are insufficient for native diffs.

## Data flow and identity

Connected repository -> backend discovery -> explicit PR selection -> explicit
backend job -> polling -> stored comparison -> native Changes -> existing
SourceNavigation / Map / Mentor with exact comparison-side context.

The centralized client validates response identity, status, counts, IDs, URLs,
paths, commits, side-specific references and provenance. Listings are capped at
256,000 response bytes, jobs/POST responses at 64,000 and comparisons at 8,000,000.
The existing streamed transport applies these caps without a second HTTP client.
Patch bodies are discarded. Dependency/script values are reduced to presence
indicators; setup guide values become booleans. Environment findings retain names
and unknown requiredness. Secret values and executable setup commands are not shown.

PrController retains one page, one selection, one job and one comparison in memory.
No comparison JSON/job database is persisted. Reopening a view can resume the same
job ID in this extension session. Start is explicitly user-triggered, guarded
against repeated clicks, and never automatically retried. Status polling waits
1.5 seconds between requests, counts elapsed request time against six minutes,
also caps request count, and honors per-request timeouts. Rate limits/failures
require explicit recovery. Hidden/disposed views and changed repository/snapshot/
backend contexts stop local waiting and ignore obsolete results. An individual
request can finish at its timeout boundary; the next result is checked against
the elapsed deadline. Local branch changes do not select a different remote PR.

ComparisonContexts holds at most two temporary side bindings, anchored to an
unchanged saved workspace binding and the current comparison. It never writes
workspaceState. Source/Map/Mentor guards accept only an expected registered side
binding or the actual saved binding. Clearing/changing the comparison or parent
invalidates prior temporary actions. Side references are resolved from the
validated comparison, with after fork identity preserved. Same component/reference
IDs on different sides remain separate. Source-side metadata is cached at most
twice per current comparison; it is checked against pinned repository/commit.

Map and Mentor reuse existing controllers and panels, without re-resolving a known
PR component ID. The source adapter reuses its existing validation/cache/provider
for native vscode.diff. Both complete files are immutable read-only documents
labelled with their actual commits. Missing/hidden/added/deleted/unsupported exact
pairs offer an explicit validated PR files-page fallback. Neither current working
tree text nor partial patch text substitutes for either side.

Native tree sections are lazy: selected PR, version identities, remote PR page,
backend progress, changed files, architecture components, original relationship
differences, Potential Impact — Static Analysis, setup findings and warnings.
Most result lists display at most100 items with explicit omission counts. Up to200
backend warnings plus a warning-omission notice remain available. View-item tokens
are checked before mutations, cancellation and source/component actions; palette
commands without a token intentionally act on the current selection. Refresh
reloads the stored comparison; Reanalyze is the explicit new-worker action.

## Automated verification

Windows; Node24.15.0, npm11.12.1, VS Code desktop1.143.1; types target VS Code1.100.

- Backend `npm.cmd test`: **67/67 passed**, preserving all61 baseline tests.
- Extension `npm.cmd test`: **98/98 passed**, preserving all68 baseline tests.
- Extension `npm.cmd run check`: strict TypeScript passed.
- Backend focused route tests: six real Express/SQLite integration tests, including
  actual prWorker execution with controlled GitHub/archive responses. They cover
  discovery/query/snapshot errors, invalid POST, missing jobs/comparisons, running/
  failed/completed snake_case job fields, stored result retrieval, fork and
  merge-base/head/target identities, two-worker capacity, 429 without queueing,
  provider failure and both capacity slots releasing. No production test hooks.
- New extension coverage includes runtime/byte-bound transport; manual URL/base
  validation; fork references; shared-version comparisons; warning truncation;
  setup/patch redaction; discovery/page/empty states; explicit start/progress;
  failed/missing/restarted backend recovery; elapsed deadline; cancel/resume;
  hidden/disposed in-flight responses; duplicate clicks; context invalidation;
  stale job actions; side-aware Source/Map/Mentor; binding preservation; exact
  read-only native diff; tree labels/lazy sections/truncation; lifecycle cleanup.

## Live public PR verification

Public PR: https://github.com/sindresorhus/p-limit/pull/106
Title: feat: add pause and resume capabilities to concurrency limit.
The live scenario uses actual backend GitHub discovery and the existing worker,
not the controlled provider fixture. The backend runs with isolated in-memory
storage; no .env is loaded and no live LLM request is required. Repository
dependencies/scripts are not installed or executed.

Pinned identities observed:

- Base repository: https://github.com/sindresorhus/p-limit
- Head repository: https://github.com/sergerommss95-cpu/p-limit
- Merge base: 9f52583119f0cb0d85c6fec600c94a21fd89d060
- Head: aa2d20b48702ab8ce1928fd4a853cb3bc9451b0d
- Target tip: 9f52583119f0cb0d85c6fec600c94a21fd89d060
- Before snapshot: 184b81747b14aee0462663a0
- After snapshot: 37a3d5deceb959c851ea83f8
- Workspace binding remained 0c97743b56b972dfae496ac0 throughout PR exploration.

Actual findings: four modified files (index.d.ts, index.js, index.test-d.ts, test.js),
66 component change records, four added and one removed relationship,40 potential
impact candidates on each side, and no dependency/script/environment-name changes.
These are backend static findings; no tests/setup/runtime behavior were executed
to establish safety or failure. The native view preserves backend warnings.

Actual status observations include queued0%, reading PR/pinning commits3%,
before archive19%, after archive59%, complete100%. Status values come from the
backend; the test samples in-memory controller state, without additional polling.

Desktop workflow assertions: connect snapshot; discover actual PRs; click native
PR106 row; click Start Analysis; observe real job; retrieve stored comparison;
inspect rendered sections; open native complete-file diff; validate both URI
commits/read-only schemes; open exact before-side reference coordinates; explore
after-side fork component in Map; explain it using existing facts-only Mentor;
preserve saved binding; disconnect and clear obsolete Changes/Map contexts.

Live mode command: `$env:MENTOR_TEST_LIVE_PR='1'; npm.cmd run test:host`.
It runs the five Phase1–4 desktop regressions plus the live PR scenario. Network,
current public PR availability and GitHub quotas are required. Default desktop
tests retain the original five scenarios. MENTOR_TEST_SCENARIOS=pr is an optional
test-only filter used while diagnosing the UI harness.

## Independent review and corrected defects

Independent task review and whole-production review inspected contracts, original
backend ownership, side identity, source/diff, temporary binding guards, job
duplication, stale responses/actions, memory/listener bounds and secret handling.
Confirmed defects were corrected and tested:

1. Same-version comparisons were initially rejected; consistent shared snapshot
   IDs now pass, inconsistent shared identities fail.
2. More than200 legitimate backend exclusion warnings rejected all findings;
   now first200 are retained plus an explicit omitted-count notice.
3. Manual URL selection retained a placeholder title after comparison retrieval;
   the native heading now uses the actual backend title/number.
4. Poll-count bounds excluded time in status requests; monotonic elapsed-time
   checks now enforce the advertised local waiting policy.
5. Retained Start/Cancel tree actions could operate on a replacement PR; supplied
   view tokens are now rejected before all registered PR actions.
6. Selecting in a newly active repository before an editor event could retain the
   old repository's PR page; select now synchronizes context first.
7. Desktop harness assertion namespace misuse and a Start row hidden below an
   expanded30-PR list were diagnosed and corrected. The actual Start button is
   clicked after collapsing the list; no production command was bypassed.
8. Native title commands initially lacked icons; icons now keep the Changes header
   compact. The obsolete Changes placeholder and its obsolete host assertion were
   replaced by the real provider and unit/live desktop verification.

Review follow-up found no remaining blocker for the reviewed fixes. Original
Phase3/4 source, Atlas and Mentor tests remain passing after integration.

## Remaining limits and Phase6

- Only public GitHub PRs supported by the existing backend. No private-repository
  support, extension GitHub credentials or new authentication/ACL behavior.
- Job resume is in-memory for this VS Code session, not across a full extension
  restart. Backend jobs remain stored server-side; there is no cancellation API.
- Exact diff requires usable complete source-reference pairs. Added/deleted,
  hidden or excluded files use the real PR files-page fallback. Opening that
  fallback in an authenticated browser is not covered by the live desktop test.
- Comparison response8MB and list/section caps deliberately reject oversized
  envelopes or display bounded subsets. No native result pagination beyond the
  backend's PR listing pages; full platform remains the large-result experience.
- Source/Map/Mentor retain their existing broad snapshot metadata/evidence reads
  when needed; no full comparison snapshots are downloaded merely to render Changes.
- No live AI-provider request, real SSH/WSL/container/non-Windows host, minimum
  VS Code1.100 runtime, screen-reader or comprehensive light/high-contrast test.
- Worker crash/five-minute timeout/SQLite failure injection and full process-restart
  persistence are not exercised by the new worker integration tests. Extension
  failed/missing/restarted-backend responses are covered with controlled tests.
- No migrations, installations or repository tests run automatically. Setup and
  impact remain static findings. No Time Machine, handoff, runtime tracing or
  other future feature was implemented.

Phase6 can reuse guarded workspace/snapshot identity, existing persistence for
workspace bindings, explicit temporary historical contexts, and version-aware
source/diff navigation. Work Context Time Machine still needs its own backend
checkpoint contract and implementation; this phase adds no checkpoint storage.

## File responsibilities

New production modules: src/api-client/prContracts.ts (validated DTOs/redaction),
src/prController.ts (session/job state), src/comparisonContexts.ts (temporary side
bindings), src/views/changesTree.ts (native presentation), src/commands/prCommands.ts
(user actions and existing source/Map/Mentor integration). Existing client,
activation, Mentor/Atlas guards and source adapter were extended minimally.
Manifest/README and test/host scripts were updated; no new npm dependencies.

Backend additions are test-only: test/prRoutes.test.js and
test/helpers/prWorkerFetch.js. Extension new tests: pr-contracts, pr-client,
pr-controller, pr-actions, comparison-context and changes-tree. Existing source
navigation, host/UI driver and editor API substitute tests were extended.
New docs: phase-5-plan.md and this report. Generated logs/clones/profiles/VSIX
are ignored. Exact final commands/artifact sizes and Git inventory follow.

## Final command and artifact record

| Directory | Actual command | Result |
| --- | --- | --- |
| backend | `npm.cmd test` | **67/67 passed**; `.test-output/backend-phase5-tests.log` under extension |
| extension | `npm.cmd test` | **98/98 passed**; `.test-output/phase5-tests.log` |
| extension | `npm.cmd run check` | Passed strict TypeScript |
| extension | `npm.cmd run build:dev` | Passed; development bundle and source map |
| extension | `npm.cmd run build` | Passed; final production bundle **100,719 bytes** |
| extension | `npm.cmd run test:host` with live flags removed | **Five scenarios passed**, final current-code run; `.host-test/phase5-run.log` |
| extension | `$env:MENTOR_TEST_LIVE_PR='1'; npm.cmd run test:host` | Earlier full **six-scenario run passed**; successful files in `.host-test/phase2-F4Xpse/` |
| extension | Live mode, `MENTOR_TEST_SCENARIOS=pr` | Focused live scenario **passed**; `.host-test/phase5-live-debug.log`, `.host-test/phase2-c2cYah/pr/` |
| extension | Later full live-mode rerun after selection guard | First five passed, **live job failed with GitHub HTTP403**; `.host-test/phase5-live-final-403.log`, `.host-test/phase2-6h48nD/pr/` |
| extension | `npm.cmd run package:vsix` | Passed; **42,025-byte VSIX**, nine archive entries |
| extension | `npm.cmd run package:list` | Passed; seven intended extension files only |
| extension | `code.cmd --user-data-dir .host-test/vsix-user --extensions-dir .host-test/vsix-extensions --install-extension .\codebase-mentor-0.1.0.vsix --force` | Final VSIX installed successfully in isolated profile |
| root | `git diff --check` | Passed; only Windows line-ending conversion notices |

The later HTTP403 is a real external failure, not a passing live test or a reason
to substitute mock evidence. The backend's actual failure appears in Changes.
Earlier successful live jobs independently exercised the worker/download/result/
diff/Map/Mentor workflow. The last production change was the repository-selection
context guard, covered by its failing-then-passing regression and independent
follow-up review; default desktop scenarios passed again afterward.

Successful full live evidence: `.host-test/phase2-F4Xpse/pr/pr-result.json` is
`{"ok":true}`, as are its single/restart/multi/public result files. Comparison
`a660fde0-e011-4186-b817-f5b2aa2806f9` and recorded progress/counts are in
`pr/pr-steps.json.evidence.json`. Visually inspected screenshots:
`pr/pr-changes.png`, `pr/pr-diff.png` (actual native before/after diff with pinned
commit labels), and `pr/mentor-indexed.png` for the existing Mentor panel.
The earlier focused live comparison was `b9ef81c0-d0c0-4f89-8a04-f37f6e95763d`.

Archive inspection using System.IO.Compression.ZipFile found only metadata plus
LICENSE.txt, package.json, README.md, dist/extension.js, media/mentor.css,
media/mentor.js and resources/icon.svg. Backend/test modules, generated companion,
source maps, test data, logs, databases, dependencies and credentials are excluded.
The local VSIX remains version0.1.0; no Marketplace publication.

All current uncommitted Phase4 work remains. Phase5 production changes are confined
to the extension; backend Phase5 additions are tests only. Frontend/shared/.env
files are unchanged. No commits were created. The complete current working-tree
inventory (including preserved Phase4 changes) follows.

```text
 M backend/README.md
 M backend/src/ideRoutes.js
 M vscode-extension/README.md
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
?? backend/src/ideNeighborhood.js
?? backend/test/helpers/
?? backend/test/ideNeighborhood.test.js
?? backend/test/prRoutes.test.js
?? vscode-extension/docs/phase-4-plan.md
?? vscode-extension/docs/phase-4-verification.md
?? vscode-extension/docs/phase-5-plan.md
?? vscode-extension/docs/phase-5-verification.md
?? vscode-extension/scripts/test-pr-live.mjs
?? vscode-extension/src/api-client/atlasContracts.ts
?? vscode-extension/src/api-client/prContracts.ts
?? vscode-extension/src/atlasController.ts
?? vscode-extension/src/commands/atlasCommands.ts
?? vscode-extension/src/commands/prCommands.ts
?? vscode-extension/src/comparisonContexts.ts
?? vscode-extension/src/prController.ts
?? vscode-extension/src/views/atlasTree.ts
?? vscode-extension/src/views/changesTree.ts
?? vscode-extension/test/atlas-client.test.cjs
?? vscode-extension/test/atlas-contracts.test.cjs
?? vscode-extension/test/atlas-controller.test.cjs
?? vscode-extension/test/atlas-ui.test.cjs
?? vscode-extension/test/changes-tree.test.cjs
?? vscode-extension/test/comparison-context.test.cjs
?? vscode-extension/test/pr-actions.test.cjs
?? vscode-extension/test/pr-client.test.cjs
?? vscode-extension/test/pr-contracts.test.cjs
?? vscode-extension/test/pr-controller.test.cjs
```
