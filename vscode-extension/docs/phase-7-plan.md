# Phase 7 - local Smart Context Handoff implementation plan

Specification: user attachment 90eb6992-fb8a-4a75-91ed-b186d18b5e4e/Pasted text.txt.
User explicitly authorizes implementation now, forbids commits and future phases.
Preserve existing uncommitted work in this shared workspace. No frontend changes,
new runtime dependencies, source uploads, public links, outbound sharing or auth fiction.

## Audit and design

Fresh baseline: backend79/79, extension122/122 and strict TypeScript pass.
Existing SQLite DatabaseSync additive CREATE IF NOT EXISTS; checkpoint notes are
exact strings. Component/reference IDs are snapshot-scoped; canonical GitHub URL
and full commit SHA identify snapshots. Existing source validator pins immutable
file/line URL; readNeighborhood supplies bounded original direct edges and docs.
Existing selection resolver/candidate picker, temporary context registries, panels,
private centralized HTTP and native tree patterns are reusable. Backend server
has no inbound authentication or repository ACLs. Provider Bearer tokens are
outbound provider credentials, not user authentication. Only local preparation
mode is authorized/supported; hosted sharing remains a documented dependency.

## Global constraints

- Same existing shared backend and SQLite; no extension persistence/intelligence.
- Separate CODEBASE_MENTOR_LOCAL_HANDOFFS=1, disabled default; safe loopback gate.
- Preview is explicit transmission of question/attempts/context to shown backend.
- Backend builds evidence; no AI call, no source fetch, no graph copy.
- Source excerpts default off; bounded approved ranges only, sensitive path deny.
- User selects references/relationships/docs/checkpoint notes; final backend Markdown
  is displayed before Save. Save rebuilds and hashes exact package to prevent drift.
- Saved approved package/Markdown immutable, survives missing original snapshot.
- Every list/get/delete/export is repository scoped and guarded, no bearerless share.
- Original snapshot and feature origins preserved, no workspace binding mutation.
- Copy/file export only explicit actions; no delivery/response/maintainer claims.
- No commits, worktree replacement, env secrets, or changes to existing test counts.

## Frozen cross-task API contract

All endpoints /api/ide/handoffs. Every data route has existing direct safe-loopback
checks plus independent flag; capabilities is readable and returns disabled.
Types used by backend and client/UI below (camelCase, exact fields):

```ts
interface HandoffInput {
 snapshotId:string; componentId?:string; sourceReferenceIds:string[];
 question:string; attemptedSteps:string; additionalContext:string;
 origin:{type:'editor'|'mentor'|'map'|'pr'|'checkpoint';checkpointId?:string;comparisonId?:string;comparisonSide?:'before'|'after'};
}
interface HandoffSelection {
 referenceIds:string[]; relationshipIds:string[]; excerptReferenceIds:string[];
 includeDocumentation:boolean; includeCheckpointNotes:boolean;
}
interface HandoffContext {
 schemaVersion:1; snapshotId:string; repositoryIdentity:string; indexedCommit:string;
 component?:{id:string;name:string;role:string;referenceId:string};
 question:string;attemptedSteps:string;additionalContext:string;origin:HandoffInput['origin'];
 references:SourceReference[];
 components:Component[];
 relationships:{id:string;source:string;target:string;type:string;referenceId:string;certainty?:string;inferred?:boolean}[];
 documentation:{componentId:string;explanation:string;inferred:true;referenceIds:string[]}[];
 excerpts:{referenceId:string;text:string;startLine:number;endLine:number}[];
 checkpointNotes?:{discovery:string;unresolved:string;nextStep:string};
 limitations:string[];warnings:string[];
}
interface HandoffPreview {
 input:HandoffInput; selection:HandoffSelection;
 candidates:{references:SourceReference[];components:Component[];relationships:HandoffContext['relationships'];documentation:HandoffContext['documentation'];checkpointNotesAvailable:boolean};
 context:HandoffContext;markdown:string;digest:string;
}
interface SavedHandoff {id:string;schemaVersion:1;status:'ready';createdAt:string;updatedAt:string;context:HandoffContext;markdown:string;digest:string}
interface HandoffSummary {id:string;question:string;snapshotId:string;indexedCommit:string;createdAt:string;status:'ready'}
```
Limits question1500, attempts/additional2000 each; <=16 source/reference IDs,
<=5 direct relationships, <=11 components, <=1 doc1200; excerpt<=20 lines/3000
characters each <=4 excerpts; package/Markdown <=64000 UTF8 bytes each;
API responses<=256KB; request<=24KB. IDs snapshot safe150/ref200 UUID record;
question nonblank, exact strings preserved. Candidate reference validation same
immutable path/range rules as checkpoints. Inputs strict, server-derived metadata.

- GET /capabilities -> {enabled:boolean,mode:'local-single-user',schemaVersion:1,notice:string}.
- POST /preview {input:HandoffInput,selection?:HandoffSelection} -> HandoffPreview.
  Omitted selection defaults bounded candidate refs/edges, docs false, no notes/excerpts.
  Explicit selection must be subset; exclude edges lacking selected reference coverage.
  Checkpoint origin uses only approved saved IDs; include notes only explicit true.
- POST / {requestId:UUID,input,selection,digest:64hex} -> SavedHandoff,201/200 replay.
  Rebuild preview, compare digest;409 drift; transaction stable idempotency.
- GET /?snapshotId=...&limit=10&offset=0 -> {repositoryIdentity,items:HandoffSummary[],limit,offset,hasMore}.
- GET /:id?snapshotId=... -> SavedHandoff (historical same repo).
- GET /:id/export?snapshotId=... -> {id,markdown,digest} exact stored canonical content.
- DELETE /:id?snapshotId=... -> {id,deleted:true} only handoff row.
Export does not mark delivery or successful clipboard/file writing. UI can show
local operation success after actual write. No public links or reply endpoints.

## Execution tasks / ledger

1. Backend implementer: failing-first SQLite/HTTP tests, evidence builder using
   readNeighborhood and shared checkpoint identity/ref helpers, schema/routes,
   local gate reuse and credential-free docs. Own backend files only.
2. Contract implementer: matching runtime DTO validators and centralized client
   methods handoffCapability, previewHandoff(binding,input,selection?,signal?),
   createHandoff(binding,{requestId,input,selection,digest},signal?),
   listHandoffs(binding,limit=10,offset=0,signal?), handoff(binding,id,signal?),
   exportHandoff(binding,id,signal?), deleteHandoff(binding,id,signal?).
   Own handoffContracts.ts, client additions and matching contract/client tests.
3. Root integration: guarded controller, compose/review/save/export panel, current
   repo saved-list and six context entry points using existing target resolvers;
   user-visible destination before preview, explicit redaction choices, no drift.
4. Tests/harness: previous eight desktop regressions plus handoff save/restart/
   export/source/delete/disabled cases; real p-limit evidence, origins tested,
   uncertain writes/clipboard/save cancellation/stale guards tested.
5. Independent review: code diff and untracked modules reviewed for spec and
   correctness/security; fix findings and rerun targeted then full suites.
6. Final checks: dev/prod builds, VSIX/list/archive/install/diff; README and report
   exact counts/evidence/hosted limitations; final A-H. No Phase8 implementation.

Baseline complete. Backend/context/routes task complete:96 tests. Contracts/UI/controller integration complete:150 extension tests and strict check. Independent review findings fixed and scoped closure recorded; desktop harness in progress. User authorization already supplies the
implementation approval; skill-driven commit/extra approval steps do not apply.

Review ledger: sixteen-reference off-by-one and control-character contract parity
fixed with failing-first backend regressions. Historical missing-snapshot export/
delete now uses current same-repository scope while preserving fork scope; new
regression failed first then passed. Async UI completions require same draft and
ready exact preview; no Save after failed refine. Pending review selections and
hidden compose fields retained. Independent review closure: no unresolved Critical
or Important findings. Current full totals await final desktop and package checks.

Final checks complete: root backend96/96, extension152/152, strict check, dev/prod
builds; full twelve real desktop scenarios, dark/light proof, exact canonical file
export, independent disabled capability, VSIX/list/archive and isolated install.
See phase-7-verification.md. No unresolved Critical/Important review findings,
no commits, no hosted sharing, no Phase8. Additional other-repository editor privacy negative check passed in four focused
desktop scenarios, with exact restoration after returning; evidence recorded
separately from the complete suite.
