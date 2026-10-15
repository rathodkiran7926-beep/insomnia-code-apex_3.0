# Codebase Mentor Implementation Plan

> **For agentic workers:** Execute inline using executing-plans; the user authorized independent implementation through all phases. Request a focused reviewer after implementation.

**Goal:** Deliver a coherent frontend prototype connecting source exploration, learning, contribution, and change.

**Architecture:** Typed fixtures and pure domain transitions feed a persistent React provider. Shared source, badge, button, dialog and page components serve route-based screens. XYFlow handles the atlas interaction; source references drive all code highlighting.

**Tech Stack:** React, TypeScript, Vite, XYFlow, Lucide, Prism, Radix Dialog, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-codebase-mentor-design.md` and `Codebase_Mentor_Final_Project_Specification.md` with the approved frontend-only scope.

## Global constraints

- Clearly identify sample source, explanations, comparisons, and simulated checks.
- Preserve repository, version, source and learning identity across screens.
- No real AI infrastructure, external messages or repository execution.
- Responsive layout, keyboard support, reduced motion and readable source.

## Task 1: Domain and source integrity

Files: `src/data/{types,fixtures}.ts`, `src/domain/{model,model.test}.ts`, `src/state/WorkspaceContext.tsx`.

- [x] Install local dependencies and configure Vite/TypeScript/Vitest.
- [x] Write failing tests for unresolved/out-of-range citations, branch prediction gating, first-attempt retention, distinct goal routes, approval-state enforcement, and change-targeted review.
- [x] Implement the smallest typed domain functions and coherent base/head fixture to pass those tests.
- [x] Add schema-versioned local persistence and shared actions. Validate persisted data before restoring it.

Interfaces: `resolveSource(snapshot, ref)`, `getRoute(profile, goal)`, `canAdvance(step, predictions)`, `recordPrediction(attempts, answer)`, `transitionDecision(record, action)`, `affectedConcepts(completed, changed)`; fixtures expose nodes, edges, files, journeys and PRs.

## Task 2: Core developer workspace

Files: `src/App.tsx`, `src/components/{Shell,UI,CodeViewer,Atlas,JourneyPlayer,MentorPanel}.tsx`, `src/pages/Workspace.tsx`, `src/styles.css`.

- [x] Build light shell, repository/version controls, navigation, global search and accessible dialogs.
- [x] Build interactive typed architecture graph with pan, zoom, focus/search, three detail levels and node/edge inspection.
- [x] Bind source viewer and contextual explanation to graph selection.
- [x] Add journey selection, previous/next/play/pause/restart, scenario, explanation mode and gated prediction feedback. Preserve shared selection across views.
- [x] Verify the core flow and supporting screens in the browser.

## Task 3: Connected product workflows

Files: `src/pages/{Repository,Journeys,Learn,Practice,Changes,Knowledge,Progress}.tsx`, `src/services/demoService.ts`.

- [x] Add repository setup states and capability summary.
- [x] Add journey library and two profile/goal-sensitive routes.
- [x] Add editable practice code, progressive hints, task checklist and explicit simulated test results.
- [x] Add PR selection, versioned source comparison, changed-step inspector, possible-impact distinctions, setup patch and relearning navigation.
- [x] Add maintainer inbox, draft/review/approval/publication, source links and invalidation.
- [x] Add activity-derived progress, first/retry evidence, export and reset.

## Task 4: Verify and deliver

Files: `README.md`, `output/playwright/`, `docs/verification.md`.

- [x] Run domain tests and `npm run build`.
- [x] Exercise all advertised controls and the integrated demo in a real browser.
- [x] Inspect desktop and mobile screenshots; repair layout, focus, contrast, overflow or synchronization defects.
- [x] Request focused code review, fix material findings and rerun affected checks.
- [x] Document setup, integration boundaries, fixture limitations, real verification and demo script.

