# Phase 3 implementation plan

Spec: complete Phase 3 task and implementation guide; user authorizes inline
implementation, verification and independent review, without commits.

Audit: fresh extension check/build and all 30 tests pass; all 49 backend tests
pass. Q&A already accepts componentId/question and returns answer, referenceIds,
citations, snapshotId, componentId, mode and notice. Source returns complete text
in excerpt (not content), file, startLine:1, endLine, complete:true, snapshotId
and a pinned URL. The existing guide's overlap-only resolver is insufficient:
only source ranges containing the selection may claim to cover it. No analyzer,
storage-schema, prompt/provider or frontend change is needed.

Design:
- Add one bounded /api/ide/resolve-selection route in the existing backend using
  stored snapshot/component/reference records. Prefer containing declarations
  over enclosing modules; deterministically rank by range specificity and ID.
  Crossing declarations may resolve only to the explicitly labelled module.
- Extend the existing API client with validated snapshot evidence, resolver,
  grounded question and pinned source methods. Validate structured citations
  against authoritative references; never interpret answer prose as commands.
- Add one cancellable Mentor controller keyed by backend/workspace/snapshot/
  component. Reuse Phase 2 identity, binding and editor context. Confirm indexed
  explanations for dirty/different/unknown source; never upload buffers.
- Preserve all native trees. Add a single small, framework-free Mentor webview
  panel beside the editor because trees cannot reasonably display wrapped
  paragraphs plus a follow-up field. Escape all backend text, strict nonce CSP,
  no direct HTTP/command URIs, validated extension-host messages only.
- Navigation validates reference membership, path, pinned URL and coordinates.
  Compare locally opened text with fetched indexed text before highlighting;
  otherwise use a read-only virtual document for the exact backend text. Never
  resolve an arbitrary filesystem path or trust a dirty HEAD alone. A validated
  immutable GitHub fallback is explicit if indexed source is unavailable.
- Keep a bounded in-memory answer history with prior-answer navigation; questions
  are independent component-scoped requests, not persistent chat memory.

Checklist:
- [x] Resolver tests first, minimal route/service, existing backend regression.
- [x] Transport contracts/security tests and typed client methods.
- [x] Controller tests: trust, context changes, candidates, provenance/errors,
  follow-ups, cancellation, previous answers, stale backend/bindings.
- [x] Source adapter tests and real local/virtual navigation in Desktop Host.
- [x] Panel/commands/Focus action, safe rendering and disposal.
- [x] Existing suites plus real-backend integration, real desktop workflow,
  typecheck/build/VSIX/archive/install checks and independent critical review.
- [x] Verification report, limitations and Git inventory; no Phase 4 features.
