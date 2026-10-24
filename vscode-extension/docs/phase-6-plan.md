# Phase 6 — Work Context Time Machine plan

Spec: user's Phase 6 attachment. No commits or Phase7 work. Preserve all current
Phase4/5 uncommitted files and all existing runtime behavior.

- [x] Audit task, guide, Phase1–5 reports, backend storage/routes/source/comparison,
  extension bindings/Git/editor/Mentor/Atlas/temporary contexts/Focus/navigation.
- [x] Fresh baseline: backend67, extension98, strict check/build passed.
- [x] Backend worker: checkpoint SQLite migration/service/routes and real tests.
- [x] Contract worker: validated bounded client/checkpoint DTOs + transport tests.
- [x] Root: checkpoint controller, save preview, Focus saved tasks, resume detail,
  confirmed delete, temporary saved-snapshot Source/Map/Mentor integration.
- [x] Persistence test harness: real public repository, approved note/reference,
  VS Code restart, backend restart, version mismatch, deletion, original binding.
- [x] Independent security/correctness review, fix confirmed issues, rerun tests.
- [x] Final backend/extension/check/dev/prod/host/VSIX/list/install/diff/report.

Design rulings:

- Existing SQLite CREATE IF NOT EXISTS pattern is authoritative; introduce one
  versioned checkpoint table/idempotency metadata, no extension checkpoint DB.
- CODEBASE_MENTOR_LOCAL_CHECKPOINTS=1 deliberately enables local-only access.
  Disabled by default; capability reports disabled; reject unsafe Host/Origin and
  forwarded proxy headers. This is not hosted authentication or secure sharing.
- Checkpoint owns original verified snapshot/repository/commit and approved refs.
  Local Git is explicitly extension-reported; notes are explicitly user-authored.
- Bounded same-path stored-file comparison only; no PR impact engine reuse for
  arbitrary snapshots, no name-based symbol matching, no implicit local analysis.
- Generalize the existing temporary-context registry with independent scopes,
  preserving Phase5 before/after contexts while adding a checkpoint context.
- Save preview and resume details use small escaped native-themed panels, not a
  task manager. No background polling, code edits, Git mutations or source uploads.

Completed verification: backend79, extension122, eight desktop scenarios, dev/prod
builds, VSIX/list/archive inspection and isolated installation. See
[phase-6-verification.md](phase-6-verification.md) for evidence and limitations.
