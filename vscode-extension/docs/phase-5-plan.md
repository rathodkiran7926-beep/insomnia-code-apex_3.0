# Phase 5 implementation plan

Spec: user's Phase 5 attachment. Implement only PR Changes and Impact Tracking;
no commits, no new analyzer/AI/database, preserve all existing uncommitted Phase 4.

## Audit/design

- [x] Read task/guide/reports and actual extension/backend/frontend PR consumers.
- [x] Fresh baseline: backend61, extension68, strict check/build passed.
- Backend routes already satisfy discovery, job creation/status and comparison.
  Keep them unchanged unless a demonstrated defect blocks integration.
- Comparison uses merge base (baseCommit), headCommit and distinct targetCommit.
  Job completion uses comparison_id. Fork headRepository may differ legitimately.
- Existing source API supports complete files only for stored reference IDs.
  Use native read-only diff only when both complete, validated sides are available;
  otherwise open the validated PR files page. Never use patch excerpts as files.
- Add anchored temporary side bindings for Map/Mentor/navigation, separate from
  persistent workspaceState. Clear them when comparison/anchor/backend changes.
- Native Changes tree, bounded sections, explicit discovery/analysis/refresh/resume.
  One current job/comparison, one PR page, no persisted graph/comparison JSON.
- Poll active jobs at 1.5-second intervals, bounded at six minutes, cancellable;
  POST is never retried automatically. Hidden view stops local waiting only.
- Runtime validators strip patch bodies and setup command/value strings; display
  dependency/script names and variable names only, with file evidence and warnings.

## Tasks and ledger

- [x] Contract worker: typed validated PR discovery/job/comparison client and tests.
- [x] Root: controller tests first; discovery/select/start/poll/resume/refresh/cancel.
- [x] Root: temporary comparison context registry and reusable adapter integration.
- [x] Root: native Changes sections/actions, safe source/diff, Map/Mentor side context.
- [x] Backend regression route tests where existing coverage is missing.
- [x] Controlled HTTP/controller/unit/host tests plus actual public GitHub PR job.
- [x] Independent spec/quality review; fix defects and rerun.
- [x] Final check/dev/prod build/backend/extension/host/VSIX/list/install/diff/report.

Ruling: use a temporary, parent-binding-anchored exploration registry rather than
changing saved bindings — comparison sides may be fork snapshots and must remain
valid only while their originating workspace/comparison is active.

Ruling: no new diff endpoint — use supported source-reference APIs when exact
before/after files exist; a validated PR files page is the honest fallback.

Verification: backend67, extension98; default5 desktop scenarios pass. Live PR106
completed in prior focused/full6-scenario runs; later retry returned GitHub403.
Report preserves both outcomes. Final VSIX packaged/installed; no commits.
