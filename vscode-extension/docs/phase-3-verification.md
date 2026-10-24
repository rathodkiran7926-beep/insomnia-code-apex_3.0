# Phase 3 verification — 24 October 2026

## Audit and scope

The complete Phase 3 task, implementation guide's resolver/Mentor/source and
security sections, Phase 1/2 reports, all current extension modules/commands and
tests, backend server/workspace/storage/analyzer/workspace tests, and frontend
domain contracts were inspected before implementation. Fresh baseline results:
30 extension tests, strict typecheck/build, and all 49 backend tests passed.
Existing uncommitted Phase 1/2 work was preserved. No commits were created.

Both clients still use the existing shared backend. The only backend production
addition is a small IDE selection router/service mounted in server.js. The
existing analyzer, storage schema, Q&A implementation, provider integration,
prompts and frontend are unchanged. No runtime dependency was added.

Actual existing contracts were verified before use:

- Snapshot: GET /api/snapshots/:id, with components/references and pinned commit.
- Mentor: POST /api/snapshots/:id/questions accepts componentId/question and
  returns answer, referenceIds, citations, snapshotId, componentId, mode, notice.
- Source: GET /api/snapshots/:id/source?referenceId=... returns complete source
  in **excerpt**, plus file, snapshotId, complete:true, startLine:1, endLine, URL.

The guide's proposed resolver used line overlap alone. The implemented resolver
requires containment, so partial overlaps cannot masquerade as one selected
declaration. If a selection crosses declarations, only a real enclosing module
may remain, with an explicit module-only notice. Meaningful containing
declarations take precedence over module candidates; ambiguous declarations are
ranked deterministically and offered in a picker.

## Architecture and behavior

Editor metadata -> centralized client -> POST /api/ide/resolve-selection ->
existing component-grounded Mentor -> escaped panel rendering -> checked local
or read-only indexed source navigation.

The new route uses existing SQLite graph JSON, Zod validation and backend error
handling. Requests reject invalid snapshot IDs, absolute/traversal/malformed
paths, non-positive/reversed/oversized ranges and unexpected fields. End line is
bounded at 1,000,000, range span at 10,000, path at 1,000 characters, and output
at 20 candidates with bounded labels/IDs. No filesystem reads, external requests,
AI inference or new parsing occur in the resolver.

The extension validates resolver IDs against authoritative stored components and
references. It checks returned citations against snapshot, ID, path, range and
immutable GitHub URL; prose never becomes a command or source identifier. Full
evidence envelopes are temporary; history stores at most five bounded answers
and their selected metadata/citations, not an unbounded graph or database.

Phase 2 bindings and Git identity checks are reused. Different/unknown revision,
dirty files or unsaved source require explicit indexed-source acknowledgement.
The editor/Git adapters still read no source text automatically. Only explicit
explanation/citation actions compare local text with fetched indexed text; no
buffer content, absolute path or Git remote credentials are uploaded.

The original native Focus/Map/Changes views remain. Focus adds Explain Selection
and Open Mentor actions. One small framework-free panel beside the editor is
used because native trees cannot reasonably display wrapped answers plus a
follow-up field. The panel shows actual facts/AI mode and notice, scope, pinned
repository/snapshot/commit, question, answer, citations and previous/latest
history. Each follow-up is a new stateless request to the same existing Q&A
endpoint; no conversation-memory claim is made.

The panel uses escaped text, an immutable nonce-CSP shell, local assets only,
no command URIs, no direct HTTP, and checked host-side messages. State updates
are posted into the existing document after a readiness handshake, avoiding
iframe/script reloads and lost clicks. Loading/cancel/error/empty states retain
the previous answer. Stale binding actions are rejected with a clear message.

Request guards cover backend URL, workspace/snapshot/binding identity, selection,
editor version, HEAD, file modification state, and the original source version
while the webview owns focus. Cancellation and superseded results cannot replace
newer answers. Only explicit user actions request explanations; cursor events
make no backend requests.

Source navigation obtains the actual complete backend text. Local highlighting
requires matching repository and HEAD, a clean/non-dirty target, safe physical
path without symlink redirection, and equal local/indexed text (LF/CRLF
equivalence allowed). Bounds and context are checked again before highlighting.
Otherwise, the exact backend text opens through TextDocumentContentProvider in
a read-only tab labelled `filename (indexed SHA).ext`, preserving line numbers.
An unavailable source can offer an explicit, validated immutable GitHub fallback.

## Commands executed and results

Environment: Windows; Node 24.15.0; npm 11.12.1; installed VS Code 1.143.1.

| Directory | Command | Result |
| --- | --- | --- |
| backend | `npm.cmd test` | **56/56 passed**, including all 49 pre-existing tests |
| backend | `node --test test/ideSelection.test.js test/workspace.test.js` | Focused resolver and unchanged Q&A/source tests passed |
| vscode-extension | `npm.cmd run check` | Strict TypeScript check passed |
| vscode-extension | `npm.cmd test` | **52/52 passed**, preserving original Phase 1/2 scenarios |
| vscode-extension | `npm.cmd run build` | Passed; bundle 53,206 bytes, approximately 51.96 KB |
| vscode-extension | `npm.cmd run test:host` | Real desktop end-to-end plus empty/single/restart/multi regressions passed |
| vscode-extension | `npm.cmd run package:vsix` | Passed; 25,976-byte VSIX, nine archive entries |
| vscode-extension | `npm.cmd run package:list` | Exactly the seven extension files listed below |
| vscode-extension | `code.cmd --user-data-dir .host-test/vsix-user --extensions-dir .host-test/vsix-extensions --install-extension .\codebase-mentor-0.1.0.vsix --force` | Final VSIX installed in isolated test profile |
| root | `git diff --check` | Passed, with only Windows line-ending conversion notices |

Packaged extension files: package.json, README.md, LICENSE.txt,
dist/extension.js, resources/icon.svg, media/mentor.css and media/mentor.js.
The other two archive entries are VSIX metadata. No tests, generated test
companion, source tree, backend modules, development dependencies, profiles,
databases or credentials are packaged. The extension has no runtime npm deps.

## Test coverage and real integration evidence

Backend tests exercise exact/partial/cursor containment, module specificity,
nested declarations, deterministic ties and result caps, cross-function spans,
unknown/out-of-range files, wrong snapshot/reference associations, invalid IDs,
paths, lines, extra fields, real router persistence, 404, 400 and oversized 413.
Existing facts-only, valid AI, invalid-AI fallback and source tests still pass.

Extension tests cover the typed POST/GET payloads and actual HTTP transport;
facts/AI/fallback provenance; malformed IDs/citations/source/coordinates/URLs;
400/404/429/500; body timeout/cancellation; zero/one/multiple candidates; trust;
missing or changed bindings/backends; same-component follow-ups; old-answer
retention; history; Retry; selection/HEAD/dirty-file/source-version races; local
and pinned navigation; missing files; LF/CRLF policy; safe fallback; HTML escaping;
and lifecycle/disposal. Existing workspace, Git, binding and health suites remain.

The backend integration fixture invokes the **existing** analyzer, documentation
(generateAI:false), persistence and server on deterministic source in an in-memory
database. Q&A credentials are explicitly removed. It verifies real resolver IDs,
actual Q&A response/provenance, stored complete source, and offline/restart state.
It adds no alternative analyzer or test endpoint to production.

The desktop runner creates real on-disk Git repositories with actual commits
and GitHub-format fixture remotes, then indexes their exact source with those
commits through existing backend services. These fixture remotes are not live
GitHub repositories; public downloading/permalink availability is not claimed.
All assertions use real parser IDs, real HTTP responses and actual editor APIs.

The normal isolated Development Host and CDP-driven UI verified:

1. Phase 2 connection through the real folder/input/confirmation UI.
2. Selection of an actual function and invocation of Explain Selection.
3. Real resolver component ID and existing Q&A facts-only answer/provenance.
4. Rendered panel text and actual citation button activation.
5. Correct local file and exact 1-based-to-0-based source range navigation.
6. Follow-up submitted through the real panel form, retaining snapshot/component.
7. Previous/Latest actions restoring the expected answers.
8. A saved local modification while HEAD still matches, explicit indexed-source
   acknowledgement, and a new indexed-only explanation.
9. Clicking that citation opens actual backend text in a read-only indexed tab;
   text equality, scheme, non-dirty state and exact line selection are asserted.
10. Phase 2 real branch/HEAD changes, Change Snapshot, restart restoration,
    independent multi-root bindings and selective disconnect remain working.

The runner uses the test-only companion introduced in Phase 2 because VS Code's
extension-test mode refuses modal dialogs. The companion and generated Git
mutations exist only under ignored .host-test/, with hooks/templates disabled.
No normal user settings/extensions or project Git branches are changed. Owned
test windows and backend are stopped on completion/failure.

Passing desktop markers include MENTOR_PHASE3_UI_PASS for local citation,
follow-up, history, modified-source acknowledgement and indexed-source proof;
and the single/restart/multi MENTOR_DEVELOPMENT_HOST_PASS markers.
The log is `.host-test/phase3-run.log`. A visually inspected passing artifact is
`.host-test/phase2-7pdhqw/single/mentor-indexed.png`, showing the modified working
file beside the separately labelled indexed tab and actionable source evidence.
The inherited run-directory prefix is a fixture name, not the implementation phase.

## Problems found and corrected

- The guide's overlap-only proposal could imply the wrong declaration. The new
  backend uses containment and explicit module-only scope instead.
- Source text is actually returned as excerpt with complete:true. Client/source
  contracts use these verified existing fields, not invented content fields.
- HEAD equality alone cannot prove an unchanged file. Local navigation compares
  actual source text, checks dirty state and rejects physical symlink redirection.
- Independent review reproduced stale Explain Retry targeting an old selection.
  Retry now uses current context where available; history browsing clears stale
  follow-up retry actions. Regression tests prove both behaviors.
- The native follow-up input can remain open while answer selection changes.
  Its submission now checks the captured answer ID before any request, preventing
  a question prompted for one component from being sent for another.
- Independent review reproduced a HEAD-change race during Q&A. Fingerprints now
  include revision/file state/HEAD, plus an original-source version token while
  the panel has focus. Late results are cancelled/ignored.
- Real UI testing exposed controls becoming inactive while full webview HTML
  reloaded. A stable CSP shell, posted updates and ready handshake fixed the
  lifecycle; subsequent actual citation/form/history tests pass.
- A desktop test retained a closed preview TextEditor after indexed navigation.
  The test now reopens/reacquires the actual source document/editor before the
  remaining Phase 2 checks. This was a test-lifecycle defect, not a navigation claim.

Independent read-only review inspected resolver, contracts, physical-path checks,
context races, CSP/escaping/message validation and disposal. Its final targeted
controller/render suites passed 11/11; earlier controller/source suites passed
15/15. No remaining concrete blockers were reported, and the full suites were
rerun after fixes.
The final narrow review of the native follow-up answer-ID guard also found no
defects; its regression passed independently.

## Files created or extended

New backend: src/ideSelection.js (validation/selection matching), src/ideRoutes.js
(stored snapshot adapter), test/ideSelection.test.js. Modified backend: the two-line
server route import/mount and README contract documentation. No analyzer, storage,
workspace Mentor, provider/prompt or frontend code changed.

New extension modules: src/api-client/mentorContracts.ts, src/mentorController.ts,
src/selection.ts, src/vscode-adapters/sourceNavigation.ts,
src/views/mentorContent.ts, src/views/mentorPanel.ts,
src/commands/mentorCommands.ts, media/mentor.js and media/mentor.css.

Extended extension modules: centralized client, extension activation/exported
context API, editor/Git adapters, Focus tree, manifest, README and test scripts.
The line conversion was extracted from the existing editor adapter into a pure
module and re-exported, preserving its Phase 2 interface.

New extension tests: mentor-client.test.cjs, mentor-contracts.test.cjs,
mentor-controller.test.cjs, mentor-render.test.cjs, source-navigation.test.cjs.
Existing test fixture, real-backend integration, desktop UI driver/host and editor
API substitute were extended. New docs: phase-3-plan.md and this report.

## Remaining limitations and Phase 4

- No live LLM provider request was made. Actual facts-only behavior works without
  credentials; AI and fallback contracts have controlled-response/backend tests.
- Live public GitHub permalink opening was not tested; validation and explicit
  fallback action are covered by deterministic tests.
- Real SSH/WSL/container and non-Windows hosts, minimum VS Code 1.100 runtime,
  screen readers and comprehensive light/high-contrast visual testing remain
  unverified. Native theme tokens, semantic labels and keyboard-native controls
  are used; dark-theme desktop screenshots were visually checked.
- Remote or unverifiable local source opens indexed text rather than claiming a
  verified local range. Line-only metadata cannot disambiguate multiple symbols
  on one line; the picker preserves that uncertainty.
- Current evidence validation bounds broad snapshot payloads at 10,000 components
  and 20,000 references. Larger snapshots fail explicitly; a future bounded API
  may improve scale without moving retrieval logic into the extension.
- Backend auth/ACLs and Marketplace publishing remain outside scope. The server
  remains loopback/public-repository oriented. Client abort ignores obsolete
  results; already accepted provider work may finish under existing server limits.

Phase 4 can reuse guarded selected-component context, typed API/evidence records,
answer rendering and version-aware source navigation. No Atlas graph, PR UI,
handoff, checkpoints, voice, autonomous agent or other future feature was added.

## Git status

All original Phase 1/2 changes remain uncommitted. Final changes are confined to
backend/ and vscode-extension/; frontend/ and shared/ are unchanged. Tracked
modifications: backend/README.md, backend/src/server.js, and the four pre-existing
extension scaffold files (.vscodeignore, package.json, src/extension.ts,
tsconfig.json). New/untracked files include the resolver/service/tests, Mentor
modules/media/tests/docs and the preserved Phase 1/2 files. Generated artifacts
remain ignored. No commits were created. Use git status --short and
git ls-files --others --exclude-standard for the full current inventory.
