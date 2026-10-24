# Phase 4 implementation plan

Goal: a native one-hop Quick Architecture Atlas using the shared backend only.
User's Phase 4 task is the specification and authorizes implementation. No commits.

## Audit and design

- [x] Inspect extension, Phase 1–3 reports, guide, backend storage/analyzer/docs,
  frontend graph and hash routing, Git status; run fresh 56/52 test baselines.
- [x] Verify native tree APIs against official VS Code documentation.
- Existing snapshot endpoint is broad; no neighborhood endpoint exists. Use the
  existing normalized SQLite components/relationships/source_references tables,
  with snapshot-scoped joins and server limits; avoid serializing the full graph.
- Response carries snapshot/repository/commit, selected and related components,
  original directed edges and optional certainty/inference metadata, exact edge
  evidence, existing inferred documentation, limitations and truncation.
- Reuse Mentor selection resolution through a shared method without asking Q&A.
  Map history holds only five target descriptors, not five graphs; no cache.
- One native tree replaces the Map placeholder. Actions carry opaque current-view
  tokens; stale/cross-binding actions fail. Editor, Map and Mentor stay distinct.
- SourceNavigation gains a general citation entry point; Mentor uses the same path.
- Full Atlas opens configured web root + actual /#/workspace route, with an honest
  notice that browser state controls repository selection. No frontend changes.

## Execution checklist

- [x] Backend tests first: direction/types/certainty, refs, empty/missing/malformed,
  query limits, truncation and real HTTP using persisted analyzer graphs.
- [x] Implement bounded endpoint in existing IDE router and document contract.
- [x] Typed neighborhood validation/transport and meaningful rejection tests.
- [x] Shared resolution and explicit Map-component Mentor workflow, regression tests.
- [x] Atlas state/history/cancel/context guards and native tree/commands/manifest.
- [x] Tests for history, error/retry, stale binding/selection, source/edge evidence,
  exact Mentor target, tree commands and lifecycle.
- [x] Real public repository analysis and desktop integration, plus controlled
  unknown/possible/truncation fixtures where public source lacks such edges.
- [x] Independent review; fix confirmed issues; rerun complete suites and desktop.
- [x] Check/build:dev/build/VSIX/list/installation/diff; final report and Git inventory.

Validation commands: backend `npm.cmd test`; extension `npm.cmd run check`,
`npm.cmd test`, `npm.cmd run build:dev`, `npm.cmd run build`,
`npm.cmd run test:host`, `npm.cmd run package:vsix`, `npm.cmd run package:list`;
isolated `code.cmd --install-extension`; root `git diff --check`.
