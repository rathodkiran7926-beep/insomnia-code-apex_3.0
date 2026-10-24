# Phase 7 independent backend and client security review

Review scope: frozen phase-7-plan.md, user Phase 7 specification, backend/contract reports, phase7-backend-review.txt, current handoff backend modules, reused checkpoint/neighborhood/source validators, routes, client transport and handoff validators. UI integration remains outside this review. Existing suites were not rerun. Implementation files were not edited.

## Verdict

No Critical security finding. The required local mode has the intended independent disabled-default flag and direct safe-loopback boundary. Hosted authentication/repository authorization do not exist and are accurately described as missing; no hosted sharing or delivery claim was introduced.

Spec compliance: substantially compliant, with one Important bounded-response/client compatibility defect below. Quality: sound reuse and immutability design, but correct this boundary case before final signoff. This review does not establish production authentication or guarantee secret detection.

## Important finding

### P2: Component evidence can exceed the frozen candidate-reference cap

Location: backend/src/handoffContext.js:244-247, versus vscode-extension/src/api-client/handoffContracts.ts evidence() (list(d.references,16)).

Scenario: a valid request supplies the allowed sixteen distinct sourceReferenceIds and a valid component whose referenceId is a seventeenth distinct reference in the same snapshot. Initial references are inserted without issue; add(n.component.referenceId) then inserts the seventeenth reference without checking refs.size. Only the subsequent neighborhood loop checks refs.size < 16. The returned candidates.references has seventeen entries, violating the frozen <=16 contract. The client rejects this otherwise valid backend preview, preventing review/save. The default first-eight selection can also omit the actual selected component when unrelated submitted references occupy the initial slots.

Verified with a targeted one-off in-memory DatabaseSync database containing one snapshot, seventeen immutable valid references and a component using reference seventeen: buildHandoffPreview returned {candidateReferences:17, selectedReferences:8} with context.component absent. No unchanged test suites were rerun.

Correction: enforce a single global reference budget that reserves capacity/prioritizes the selected component evidence. Either reject an over-budget union clearly before building the response or choose candidates deterministically within sixteen while preserving the selected component and required explicit references. Add a regression for sixteen submitted references plus a distinct component reference, and verify the real response passes the runtime client validator.

## Minor compatibility observation

Backend handoffInput text fields (handoffContext.js:21-26) accept NUL whereas the client txt() helper rejects it for authored fields, notes, excerpts and Markdown. A direct local API caller can save a question containing NUL that makes the extension's validateHandoffPage reject the entire page containing that row. A one-off preview with question "Why?\\u0000" confirmed backend acceptance. Align the backend's accepted text domain with the client (reject NUL explicitly, preserving all other exact authored text). This is a single-user data compatibility issue, not an authentication bypass.

## Security and correctness checks

- Evidence construction reuses readNeighborhood with limit five and projects bounded original direct relationships rather than rebuilding analysis or copying the graph. References are independently revalidated using immutable snapshot/commit/file/line coordinates; selected edges require both endpoint and relationship evidence. Sensitive paths are excluded before becoming candidates.
- Checkpoint origin verifies the original snapshot and indexed commit, restricts submitted and discovered references to saved approved IDs, and includes exact checkpoint notes only with explicit inclusion. PR origin verifies the stored comparison ID and row snapshot IDs, exact before/after selection, base/head repository and commit identity, and canonical base PR URL. Fork after-side identity is checked against the fork snapshot rather than silently substituted with the base repository.
- Repository identity and immutable commit derive from backend snapshots. List/get/export/delete use a provided valid snapshot to scope to a canonical repository; every data route passes the independent flag plus shared safeRequest. Capability is safe to inspect when disabled. Forwarding headers, unsafe peer/local addresses, Host/Origin and cross-site browser fetches fail the gate.
- Excerpts default off; only explicitly selected reference ranges read bounded already-stored source. No source fetch, provider AI call, source upload, terminal capture or unsaved-buffer capture appears in this service. Basic suspicious-string checks warn rather than claim complete redaction.
- Canonical Markdown escapes authored text and stored descriptions; excerpts use fences longer than embedded backtick runs; source URLs must match immutable GitHub evidence. Text is data and has no command-execution or assistant/tool instruction path.
- Save rebuilds the same input/selection package under a write transaction and hashes input, selection, structured context and exact canonical Markdown. Drift returns 409. Stored context/Markdown are immutable and read without regenerating historical evidence; a current same-repository snapshot can scope retrieval after the original snapshot disappears.
- Additive CREATE TABLE IF NOT EXISTS/index migration matches existing SQLite conventions and has no foreign-key cascade from snapshots. BEGIN IMMEDIATE plus unique request_id makes identical retries stable and rejects changed payloads. Deletion targets only the selected handoff row.
- Client methods use the centralized bounded private-response transport, reject backend-scope mismatch, enforce input/response schemas and evidence coverage, and require a cached matching preview for create. Cached approvals are bounded and scoped to backend/repository/snapshot/commit/digest. Save responses must exactly match approved context, Markdown and digest.
- Besides the reference union issue, authored counts, excerpt ranges, opt-ins, documentation provenance, package/Markdown byte bounds and request bounds match the intended local contract. Client's 256000-byte transport limit is slightly stricter than backend's 256*1024 cap, but the bounded package plus eight-reference defaults does not establish a concrete reachable failure here.

Follow-up verification needed: targeted regression for the reference union defect and backend/client text parity if corrected. Overall backend/extension suite counts are recorded by implementers, not independently reasserted by this read-only review.

## Final root UI/controller review (follow-up)

Reviewed phase7-ui-review.txt and actual handoffController, handoffPanel, handoffContent, media/handoffs.js, handoffCommands, temporary comparison contexts and PR/checkpoint/Mentor entry patches. Existing 149-unit-test result is implementer evidence; unchanged suites were not rerun.

### Important P2: Historical export/delete scopes use the missing original snapshot

Locations: vscode-extension/src/handoffController.ts:32 sets contextBinding to saved original snapshot; :34 passes that binding to exportHandoff; :35 passes it to deleteHandoff when the saved detail is open. backend/src/handoffs.js:121-126 scopes get/export/delete by resolving the supplied snapshotId first.

Reproduction scenario: save a handoff on snapshot A; retain current same-repository snapshot B and delete A; open the saved handoff while bound to B. open succeeds because api.handoff uses B. The panel displays the preserved immutable Markdown, but Copy/Export invokes exportHandoff with A and fails Snapshot not found. Deleting that open handoff also uses A and fails, despite the same item being deletable from the list using B. This violates missing-original-snapshot durability in the actual extension workflow; backend-only historical tests use B and do not exercise the controller mismatch.

Use an existing same-repository scope for stored handoff operations, retaining original identity only for evidence/source navigation. For ordinary same-repository historical records the anchor binding is suitable. Preserve the special fork PR after-side case: when saved repository differs from the persistent base repository, blindly switching all stored operations to the base anchor would fail repository scoping. Select the anchor only when it matches saved repository, otherwise preserve/resolve validated same-repository scope. Add controller/API regressions for both missing-original same-repository export/delete and fork-side export/delete.

### Root security and behavior assessment

- Compose states show backend destination, authored data categories and excerpt defaults before the explicit Build Preview submission. Entry commands check capability and resolve IDs without sending a draft. PR entry preserves exact comparison side; checkpoint entry passes original saved IDs with note inclusion left opt-in.
- Compose controller status changes send status-only messages, preserving unsent textarea contents. Editing returns to original authored input; same-target launch can reveal the existing draft. Context invalidation clears draft/controller records and aborts old requests.
- Starting preview clears the prior controller preview before awaiting capability/network. Save requires ready status and exact current preview object. Panel guards draft identity/view ID and checks identity again after awaited calls. Pending API responses pass signal/current-anchor checks before publishing.
- Changes to review checkboxes disable Save until Apply selection produces a new canonical preview. The exact complete Markdown is rendered as escaped text, alongside references, provenance, limits and warnings. Optional notes/docs/excerpts are explicit. CSP disallows external connections/frames/images and command URIs are disabled.
- Copy and file export are explicit only; clipboard is untouched before Copy. Save-dialog cancellation returns before any export request/write. Export compares backend Markdown/digest with displayed immutable saved content. Current view is checked after destination selection and again before local write. Success messages follow actual clipboard/file completion; thrown writes do not produce success. No delivery is inferred.
- Source navigation resolves only included saved IDs through a session-scoped temporary binding. Workspace repository binding remains unchanged. Handoff session changes clear prior temporary bindings; older context fails navigation guards.
- No new Critical security finding in the reviewed root integration. Important historical scope mismatch above prevents final functional signoff until corrected.

## Backend finding closure after follow-up

The original P2 reference-union issue is **fixed by code inspection**: add() enforces the global sixteen-reference cap; selected component reference is inserted first; only bounded extras are retained, with a limitation for omitted supplied refs. The regression at backend/test/handoffs.test.js:622 checks sixteen candidates, selected component preservation, selected default evidence and successful save after explicit selection.

The original Minor NUL mismatch is **fixed by code inspection**: authoredText rejects NUL/binary controls while preserving tabs/CR/LF. Opted-in checkpoint notes receive the same validation. The regression at backend/test/handoffs.test.js:656 checks malformed authored fields, exact accepted whitespace and previously stored NUL checkpoint notes failing only on explicit inclusion. No independent claim about the reported 96-test run is made; no unchanged suites were rerun.

## Final scoped closure: historical operations

The last Important root finding is **resolved by code inspection**. The formatted handoffController.ts:174 now exports with the current anchor when its repository equals the saved package repository; otherwise it preserves the validated historical/fork context binding. The matching delete branch at :183 applies the same repository condition. Original snapshot identity remains available separately for source navigation. This fixes the missing-original same-repository failure without replacing fork evidence scope with the base repository.

The added handoff-controller.test.cjs:15 regression asserts that a package whose original snapshot is removed exports through the current same-repository snapshot while retaining its original contextBinding. Delete and fork branches were inspected directly; this scoped review did not rerun tests or claim independent observation of the reported 150-test/typecheck pass.

Also confirmed the requested current safeguards: preview clears previous approval before awaiting; panel completion checks the same draft after awaited calls; retainContextWhenHidden preserves unsent DOM text across tab hiding; failed selection refinement retains pendingSelection and cannot save an obsolete preview.

Final review verdict: no unresolved Critical or Important finding from this review. Earlier findings are historical review records and are superseded by their closure notes. Production authentication/hosted sharing and complete secret detection remain deliberately outside the local Phase 7 implementation.
