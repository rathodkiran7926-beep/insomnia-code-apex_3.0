
## Phase 7 contract/client implementation evidence

Owned files: src/api-client/handoffContracts.ts; additions to src/api-client/client.ts;
test/handoff-contracts.test.cjs; test/handoff-client.test.cjs. No commits, dependencies,
secrets or backend changes.

The client reuses immutable citation/path checks and checkpoint binding/capability
validation. Inputs are strict, text preserves exact whitespace, identifiers and byte
limits are bounded. Response candidates and selected context validate repository,
snapshot, full commit, evidence endpoints and citation range/URLs. Excerpts and notes
require explicit approval; unavailable opted-in excerpts require a stated limitation
or warning. Historical same-repository saved packages remain readable.

Preview approvals live only in a three-entry per-client memory cache scoped to
backend/repository/snapshot/commit/digest. Save requires a matching validated preview
and exact returned context, Markdown and digest, preventing authored-text or approved
excerpt substitution without duplicating backend package generation or hashing.
Every handoff method uses the centralized private-response transport and bounded
responses; server error messages cannot echo private notes. POST bodies are <=24KiB.

Failing-first evidence:
- node --test vscode-extension/test/handoff-contracts.test.cjs: 3 expected assertion
  failures for missing validateHandoffInput/Preview/SavedHandoff exports.
- node --test vscode-extension/test/handoff-client.test.cjs: 1 expected assertion
  failure for missing previewHandoff method.
- Later redaction compatibility and unsafe origin tests: 2 expected failures before
  allowing an excluded component/missing excerpt and enforcing safe component + UUID PR.
- Default-selection privacy regression: 1 expected failure before preventing opt-in
  excerpts/docs/notes when selection was omitted.

Verification:
- npm.cmd run check: passed after initial contract/client implementation.
- Standalone esbuild test bundle exporting client and handoffContracts, then node --test
  test/handoff-contracts.test.cjs test/handoff-client.test.cjs: 9/9 pass (before final
  backend-scope preflight test addition; final count recorded below).
- npm.cmd test: prior Phase 1-6 tests 122/122 pass while root script integration pending.
- Subsequent check found an independently changing root integration error in
  src/commands/handoffCommands.ts: component is not a SourceTarget field; root notified.

Environment notes: npm.ps1 execution policy blocks npm; use npm.cmd. rg.exe cannot
execute in this environment; used Select-String/Get-Content fallback. A broad recursive
file search encountered denied test-profile paths; stopped using broad searches.

Backend clarifications incorporated: checkpoint and PR comparison IDs are UUIDs;
component may be omitted after its evidence is excluded; opted-in stored excerpts
may be unavailable with explicit limitations. No remaining contract questions.

Final shared-suite verification (root script now includes handoff exports/tests):
- npm.cmd run check: pass.
- npm.cmd test: 145/145 pass, including 10 contract/client tests and concurrent
  Phase 7 controller/render/action additions. The root SourceTarget error is resolved.
