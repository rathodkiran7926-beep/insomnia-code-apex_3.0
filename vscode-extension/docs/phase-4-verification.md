# Phase 4 verification — 24 October 2026

## Outcome and audit

Implemented Quick Architecture Atlas in the existing native Map view. The web
platform and extension continue using the existing shared backend. No analyzer,
parser, LLM adapter, database, worker or runtime dependency was added to the
extension. Backend analysis, storage, Q&A, source, prompts and frontend behavior
remain unchanged. No Phase 5 features or Git commits were created.

Inspected the Phase 4 attachment, implementation guide's Atlas/backend/source/
performance/testing sections, Phase 1–3 verification reports, extension source,
commands/adapters/providers/controllers/tests/manifest, backend analyzer/storage/
workspace/selection/router/server/documentation, and frontend architecture graph,
HashRouter and RepositoryAnalysisContext. Git was clean at baseline `c25859f`.
Fresh baseline: backend 56/56; extension 52/52; strict typecheck/build passed.

Audit findings: components have snapshot-scoped IDs, name, role, inferred and
referenceId. Stored relationships use `source`, `target`, `type`, `certainty`,
referenceId and occasional mountPath. References hold snapshot/file/line/immutable
GitHub URL metadata plus excerpts. Edge evidence can identify a call site rather
than either declaration. Existing documentation contains explicitly inferred AI
explanations and source IDs. The frontend receives a whole snapshot graph. No
existing bounded neighborhood endpoint was present. The browser persists an
analysis-job selection in localStorage; arbitrary snapshot/component deep-link
hydration is unsupported. Its real full workspace route is `/#/workspace`.

Native tree APIs were verified against the official
[Tree View API guide](https://code.visualstudio.com/api/extension-guides/tree-view)
and installed VS Code 1.100 type declarations, then exercised on desktop 1.143.1.

## Architecture and contracts

Explicit selection -> shared Mentor selection method -> existing backend resolver
and picker -> bounded stored neighborhood -> native Map -> existing source
navigation or existing Mentor component Q&A/panel.

`GET /api/ide/snapshots/:snapshotId/components/:componentId/neighborhood` accepts
strict query fields: limit 1–100 (default 25), direction both/incoming/outgoing,
and optional exact relationshipType. Snapshot IDs are bounded at 150 characters;
component IDs at 200. The extension requests 25 direct edges with a 10-second
timeout and a 2,000,000-byte streamed response cap, without automatic retries.

The route projects the existing normalized components/relationships/
source_references tables using snapshot-scoped joins, selecting LIMIT+1 edges.
It returns small repository/commit metadata via SQLite JSON extraction and
bounded stored documentation. It does not deserialize and serialize the full
graph for each request. Missing endpoints/evidence are excluded; invalid selected
component evidence fails explicitly. Per-request component/reference maps avoid
repeated reads for already returned entities. Existing storage schema is unchanged.

Response fields: snapshotId/repository/commit, selected component, related
components, incoming/outgoing original edges, legitimate references without
excerpts, inferred documentation, limitations, limit and truncated. Certainty,
inferred, mountPath and evidence are preserved when stored; missing certainty
is displayed as unavailable. Unknown edge types remain their original labels.
No incoming edge is generically relabelled a caller or outgoing edge a dependency.

Typed client validation checks snapshot/commit/repository, selected component,
node/reference membership, direction, immutable URLs/paths/coordinates, duplicate
IDs, document provenance and count bounds. All requests reuse the central HTTP
transport and cancellation/error conventions. Empty neighborhoods are valid.

Map has one current neighborhood and at most five target descriptors in memory,
with no persistent graph cache. Component clicks explore known IDs; expansion
shows relationship evidence separately from declaration evidence. Back returns
to the previous exploration target. Back to Editor Selection restores the last
explicitly resolved editor component; Show Related Code resolves a new selection.
Cursor movement makes no graph/LLM requests. Map, editor and Mentor targets stay
separate. Refresh is explicit; stale actions carry rejected view tokens. Binding,
workspace, backend and snapshot changes clear obsolete data/actions and cancel
or ignore outdated results. Saved/offline bindings are not treated as evidence.

Source actions reuse Phase 3 SourceNavigation through a general openReference
entry point. Command handlers require current neighborhood reference membership;
the adapter then checks binding, complete indexed source and local identity/
HEAD/dirty state/physical path/text before highlighting. Otherwise it opens a
read-only indexed document. Relationship evidence never substitutes a target
declaration. Map-to-Mentor uses the explicit component ID without re-resolution,
the original Q&A endpoint/panel/provenance/history, and existing source guards.

Documentation displays existing inferred, cited explanations, or an honest empty
state; it generates nothing. Full Atlas validates configured webBaseUrl and opens
the existing workspace route with an explicit notice that browser repository state
is independent. No invented deep-link parameters or frontend changes were added.

## Executed checks

Windows; Node 24.15.0; npm 11.12.1; VS Code desktop 1.143.1.

| Directory | Command | Result |
| --- | --- | --- |
| backend | `npm.cmd test` | **61/61 passed**, including all 56 baseline tests |
| extension | `npm.cmd run check` | Strict TypeScript passed |
| extension | `npm.cmd test` | **68/68 passed**, including all 52 baseline tests |
| extension | `npm.cmd run build:dev` | Passed; bundle and source map produced |
| extension | `npm.cmd run build` | Passed; production bundle **70,008 bytes** |
| extension | `npm.cmd run test:host` | All five desktop scenarios passed, final run below |
| extension | `npm.cmd run package:vsix` | Passed; VSIX **32,063 bytes**, nine entries |
| extension | `npm.cmd run package:list` | Seven intended extension files only |
| extension | `code.cmd --user-data-dir .host-test/vsix-user --extensions-dir .host-test/vsix-extensions --install-extension .\codebase-mentor-0.1.0.vsix --force` | Final VSIX installed successfully in isolated profile |
| root | `git diff --check` | Passed; only Windows line-ending conversion notices |

Archive inspected using System.IO.Compression.ZipFile: manifest/content-type
metadata plus LICENSE, package.json, README, dist/extension.js, media/mentor.css,
media/mentor.js and resources/icon.svg. Sources/tests/fixtures/docs/dependencies/
source maps/logs/databases/credentials are excluded. VSIX remains local version
0.1.0; installation was verified with --force. No Marketplace publication.

Backend additions test real persisted analyzer graphs over Express HTTP: edge
direction/types/certainty and inference; distinct evidence; incoming/outgoing;
empty/missing/malformed IDs, invalid query, limits/truncation; dangling nodes/refs;
cross-snapshot references; and existing inferred documentation with valid/invalid
scope. All selection/Q&A/source regression tests remain passing.

Extension additions cover typed GET/HTTP/status/cancellation/byte limits; malformed
identities/URLs/direction/evidence/counts; unknown/possible types; tree actions and
scope/checkout warnings; exploration/back/editor target; stale tokens and rapid
supersession; backend/workspace/snapshot/disconnect changes; explicit rate-limit
retry; resolver reuse without Q&A; exact Map-to-Mentor targeting; declaration
versus edge navigation; cross-file Mentor location; safe web URL construction.
Existing navigation tests retain clean/dirty/missing/mismatched local source
coverage, exact line conversion and pinned fallback behavior. Activation tests
verify manifest command registrations and disposal of providers/listeners.

## Actual public-repository desktop verification

Public repository: `https://github.com/sindresorhus/p-limit`, immutable revision
`a8a6fbec4e0e866d6d779b10889bb4f5567e70eb` (package 7.3.3).
Cloned through Git, without installing or executing repository dependencies.
The harness analyzes actual index.js/index.d.ts/package.json/readme.md bytes using
the existing backend analyzer, documentation(generateAI:false), persistence and
server in an isolated in-memory database. Other deterministic Git fixtures retain
Phase 1–3 regressions. Provider credentials are removed; backend/.env is not read.

Public graph: snapshot `0c97743b56b972dfae496ac0`, 26 components, nine relationships.
Selection: real `limitFunction` (`c19`), declaration index.js:133–142. Its outgoing
`calls` edge targets `pLimit`; the relationship source is the actual call site,
separate from pLimit's declaration. The test compares returned edge IDs with
the persisted full graph, rather than assuming a visually attractive topology.

Measured serialized full snapshot + documentation: **48,782 bytes**. Same selected
neighborhood: **1,951 bytes**. A local SQLite read measured approximately **1.7 ms**
in one run; this is an observation on this small repository, not a large-repo
latency claim. Large counts/byte limits are covered with controlled fixtures.

Final host run: `.host-test/phase4-run.log`; generated directory
`.host-test/phase2-8ORAGU/` (the phase2 prefix is inherited fixture naming).
Empty, single-folder, restart, multi-root and public scenarios all passed.
The public scenario's actual result file is `public/public-result.json` with
`{"ok":true}`. CDP drives the normal isolated Extension Development Host because
VS Code extension-test mode refuses modal dialogs. The test-only companion is
excluded from the VSIX. Owned windows/backend processes stop on completion.

Real assertions/actions:

1. Connect exact public snapshot through native input/confirmation UI.
2. Select real function and invoke Show Related Code; no Mentor Q&A occurs.
3. Compare incoming/outgoing edge IDs to the stored graph.
4. Expand native relationship row and **click its actual evidence row**; verify
   real file and exact 1-based-to-0-based call-site coordinates.
5. Click native related-component row, verify target change and declaration source.
6. Explain the related component through the existing Mentor; assert snapshot,
   component and facts-only provenance; inspect rendered panel.
7. Back restores original Map component, independently of Mentor and editor.
8. Click the actual Mentor-to-Map button, verify its component; Back again.
9. Inspect native Map screenshot `public/atlas.png`, showing limitFunction in Map
   while the panel remains explicitly scoped to pLimit. Screenshot visually reviewed.
10. Resolve a real isolated module in the same graph and verify empty relationships.
11. Create an empty commit only in the disposable public clone, refresh official
    Git API status, assert different HEAD and actual read-only indexed navigation.
12. Disconnect and assert Map result is cleared.

Final log markers: MENTOR_PHASE4_UI_PASS for atlas-public-edge,
atlas-public-explore, atlas-public-proof; Mentor UI pass markers for
atlas-public-mentor and atlas-public-mentor-related; and
MENTOR_DEVELOPMENT_HOST_PASS for single/restart/multi/public. The empty scenario
also passed. All original Phase 3 rendered citation/follow-up/history/modified-file
and Phase 2 revision/snapshot/restart/multi-root checks ran in the same final run.

## Problems found and fixed

- Independent review reproduced a cross-file Mentor header using the original
  editor filename. Results now retain the validated component declaration reference;
  the header displays that file independently of preserved editor context.
- Review found module fallback scope and checkout warnings omitted from Map.
  The tree now shows the backend resolver notice and current revision/dirty state.
  Regression tests prove both corrections. Review follow-up passed 24 focused
  tests and found no remaining blocker.
- Screenshot testing initially accepted a related row's name while native tree
  rendering still showed a previous target/loading state. The driver now waits
  for the actual Selected Component row and ready status before clicking/capture.
- Replaced the obsolete Map placeholder provider; Focus/Changes remain native and
  unchanged in purpose. The old placeholder-only host assertion was replaced by
  actual Map unit and desktop coverage.
- Removed an extra script EOF blank line discovered by git diff --check.

## Limits and Phase 5

- No live AI-provider call; actual facts-only Mentor works without credentials.
  Existing controlled AI/fallback tests remain passing.
- The web route is audited and its safe URL construction tested; authenticated
  browser handoff and automatic snapshot/component hydration are not implemented.
- No real SSH/WSL/container, non-Windows host or minimum VS Code 1.100 runtime
  test. Native theme/icon/keyboard tree behavior is used; screen readers and
  comprehensive light/high-contrast visual testing remain unverified.
- Public repository snapshot covers its application/declaration sources and
  metadata, not the repository's test suite. Dynamic/external calls remain
  unresolved. Unknown/possible relationship types and truncation use controlled
  persisted fixtures, not invented public-repository edges.
- Selection resolution and Mentor retain the Phase 3 broad evidence endpoint;
  incremental Map exploration uses only bounded neighborhoods. Very large
  snapshots may still hit the existing evidence-validator limits during selection.
- SQLite graph metadata extraction/relationship filtering still reads existing
  stored data internally; no arbitrary-size latency guarantee is claimed. No
  client full-graph traversal or cache is introduced.
- Map currently uses the default 25-edge projection. More edges are available via
  the bounded API or existing full web experience; there is no native pagination.
- Auth/ACLs and Marketplace publishing remain outside scope. No PR features,
  impact tracking, handoffs, checkpoints, runtime tracing or other Phase 5 work.

The typed client, guarded component context, native Map provider, explicit Mentor
entry point and generalized version-aware source adapter are reusable for Phase 5.
PR behavior still needs its own contracts and implementation; readiness does not
claim that feature already exists.

## Files and Git

New production files: backend/src/ideNeighborhood.js;
extension src/api-client/atlasContracts.ts, src/atlasController.ts,
src/views/atlasTree.ts, src/commands/atlasCommands.ts.
Modified production: backend IDE router/README; extension client, activation,
Mentor controller/content/panel, native Focus/Changes provider, source navigation,
manifest and README. No frontend/shared/analyzer/storage/workspace/.env changes.

New tests: backend/test/ideNeighborhood.test.js; extension test/atlas-client.test.cjs,
atlas-contracts.test.cjs, atlas-controller.test.cjs and atlas-ui.test.cjs. Extended
existing Mentor/render/navigation tests, scripts/test.mjs, scripts/test-host.mjs,
test/host.ts and test/ui-driver.mjs. New docs: phase-4-plan.md and this report.
Generated VSIX, clones, profiles, screenshots and logs remain ignored. All changes
remain uncommitted; exact status inventory follows.

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
?? backend/src/ideNeighborhood.js
?? backend/test/ideNeighborhood.test.js
?? vscode-extension/docs/phase-4-plan.md
?? vscode-extension/docs/phase-4-verification.md
?? vscode-extension/src/api-client/atlasContracts.ts
?? vscode-extension/src/atlasController.ts
?? vscode-extension/src/commands/atlasCommands.ts
?? vscode-extension/src/views/atlasTree.ts
?? vscode-extension/test/atlas-client.test.cjs
?? vscode-extension/test/atlas-contracts.test.cjs
?? vscode-extension/test/atlas-controller.test.cjs
?? vscode-extension/test/atlas-ui.test.cjs
```
