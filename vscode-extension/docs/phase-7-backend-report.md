# Phase 7 backend implementation and verification

Implemented against the frozen phase-7-plan.md API. No commits, new runtime
dependencies, source fetches, AI calls, authentication substitutes, or frontend
changes were made by this task.

## Audit and reuse

Read the user specification, frozen plan, checkpoint persistence/routes/tests,
neighborhood projection, SQLite initialization and snapshot storage, existing IDE
routes/server parser, and the full tracked backend working diff before edits.
Earlier backend work included Phase 4 neighborhood and Phase 6 checkpoint files;
it was preserved. SQLite uses additive CREATE TABLE IF NOT EXISTS, with built-in
DatabaseSync and snapshot-scoped components/references. Checkpoint notes preserve
exact text. There is no inbound authentication or repository ACL system.

Reused exported checkpoint snapshot/reference validators (only added export
keywords), and extracted the existing safeRequest loopback predicate to
localSingleUser.js without changing its behavior. Checkpoint flag and route
semantics remain independent. Reused readNeighborhood for bounded original
direct edges, related components and existing inferred documentation.

## Backend files

- backend/src/handoffContext.js: strict DTO input validation, deterministic
  bounded evidence projection, origin verification (including exact fork PR
  sides), explicit reference/edge/excerpt/docs/checkpoint-note selection,
  sensitive-path denial, warnings, canonical safe Markdown and preview digest.
- backend/src/handoffs.js: additive versioned SQLite table/index, transactional
  idempotent creation, preview rebuild/drift rejection, immutable saved package,
  bounded repository-scoped listing/get/delete.
- backend/src/handoffRoutes.js: independent disabled-default capability and
  safe-loopback guard on every data route, preview/save/list/get/export/delete.
- backend/src/localSingleUser.js: unchanged shared checkpoint safe-request rule.
- backend/src/checkpointRoutes.js: import shared safe-request rule.
- backend/src/checkpoints.js: export existing snapshot/reference helpers.
- backend/src/ideRoutes.js: additive /handoffs mount.
- backend/test/handoffs.test.js: actual HTTP and SQLite integration coverage.
- backend/.env.example and backend/README.md: independent flag, API, limits,
  review/privacy boundary and missing hosted authorization/delivery.

## Commands and observed results

1. `node --test backend/test/handoffs.test.js` before implementation: failure
   observed because capabilities returned 404 instead of the expected 200.
2. `node --test test/handoffs.test.js` (backend cwd): initially 13/13 passed;
   expanded final coverage is 15/15 in the full suite.
3. `node --test test/handoffs.test.js test/checkpoints.test.js` (backend cwd):
   25/25 passed before two final handoff coverage additions.
4. `npm.cmd test` (backend cwd): final observed **94/94 passed**, zero failures
   (79 prior tests plus 15 handoff tests). Includes real PR worker regressions.
5. Existing installed frontend Prettier used to format only new backend files
   and handoff tests; no formatter/runtime dependency was installed.
6. `git diff --check`: backend was clean; a concurrently edited extension client
   blank EOF line was reported to the parent/contract owner for correction.

Coverage includes independent disabled flags; hostile Origin/Host/forwarding;
all guarded saved reads/exports/deletes; strict malformed fields and size limits;
cross-snapshot unique refs; unsafe citation paths/URLs; sensitive-path denial;
exact user text; default no excerpts/docs/notes; redaction to zero references;
explicit bounded excerpts and suspicious source strings; safe HTML/Markdown and
variable fences; unavailable excerpt honesty; edge endpoint evidence coverage;
inferred-doc opt-in and source coverage; checkpoint saved approval and notes
opt-in; exact fork PR before/after identity; drift from authored text and changed
stored component evidence; idempotent concurrent requests; SQLite rollback;
bounded pagination; repository isolation for get/export/delete; separate-process
file SQLite restart preservation; missing original snapshot preservation; and
deletion leaving checkpoints/current analysis untouched.

## Reviewed concerns and fixes

- Markdown excerpt fences grow beyond every embedded backtick run, and authored
  syntax/HTML is escaped. Canonical source URLs percent-encode parentheses in
  Markdown destinations. Included supporting component metadata is visible in
  canonical Markdown rather than hidden only in structured context.
- All selected relationships require source and endpoint reference coverage.
  Removing all refs removes selected component metadata and supporting evidence.
- Context component projections omit neighborhood-only metadata outside frozen
  contract. Documentation is omitted if its component/source coverage was
  excluded. Limitations are bounded to thirty strings of at most 1000 characters.
- Saved content is read from stored approved JSON/Markdown, without regenerating
  missing historical evidence. Save retries reuse the exact immutable result;
  changed payload under the same requestId returns 409.
- Test fixture correction: reference IDs repeat across snapshots by design;
  cross-snapshot negative tests therefore use a unique original-only ID.

Hosted authentication, protected cross-user links, repository authorization,
authenticated senior replies, expiry/revocation and delivery are deliberately
absent. The local flag and loopback gate are development safeguards, not per-user
authentication. Secret heuristics are basic warnings, not complete detection.
Manual export is not delivery. Desktop/extension packaging are parent task scope.

## Independent review fixes

Review reproduced a candidate-bound defect using sixteen distinct valid supplied
references plus a different selected declaration: the pre-fix preview returned
seventeen candidates. Regression test failed `17 !== 16`. The selected declaration
now occupies the first candidate slot, all submitted references are validated,
extras remain within sixteen slots, and an omission limitation explains any
bounded supplied reference. The regression previews, explicitly selects and saves
all sixteen candidates, and verifies default selection retains the declaration.

A second regression proved a NUL question was accepted (`200 !== 400`). Authored
handoff question/attempts/context now reject C0, DEL and C1 controls except tabs,
LF and CR. Explicitly included checkpoint notes use the same validation; omitting
notes leaves existing checkpoint persistence semantics untouched. Regression
checks NUL/ESC/DEL/C1 across all three fields, exact tab/LF/CR preservation, and
checkpoint notes rejected only when explicitly included.

`node --test backend/test/handoffs.test.js backend/test/checkpoints.test.js`
after these fixes: **29/29 passed** (17 handoff plus 12 checkpoint).
Final rerun `npm.cmd test` in backend: **96/96 passed**, zero failures.
`git diff --check -- backend`: passed (only Git line-ending notice).
