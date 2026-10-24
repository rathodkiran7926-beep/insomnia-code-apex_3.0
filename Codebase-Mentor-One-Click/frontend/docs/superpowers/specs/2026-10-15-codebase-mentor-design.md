# Codebase Mentor frontend design

Approved in conversation on 15 October 2026. The supplied product specification defines the product vision; the attached UI brief and subsequent approval scope this implementation to a working frontend with explicitly identified fixtures, without production repository analysis, AI infrastructure, or sandbox execution.

## Experience

Create a workspace-first developer tool. A quiet light shell frames an interactive architecture atlas, contextual mentor, and source viewer. A selected node, journey step, source range, and explanation share identity and version. The signature is a source-linked request path that pauses at a prediction and continues into contribution practice and change-aware relearning.

Navigation: Repository, Mentor Workspace, Journeys, Learn, Practice, Changes, Progress; Knowledge is a secondary team destination. Preserve repository/version and learner state between destinations. Support direct URLs, search, keyboard stepping, collapse controls, small screens, and reduced motion.

## Visual system

Canvas #f7f8fb, surface #ffffff, text #182234, secondary #697386, primary #5855d9, border #e6e9ef, semantic green #16866a. Geist Sans for interface, Geist Mono for source and version metadata. Use restrained 8–12px corner radii, fine borders, and purposeful spatial hierarchy. The graph uses clearly labelled technical nodes and orthogonal typed relationships. Avoid ornamental charts, decorative imagery, and oversized metrics.

## Data and architecture

React, TypeScript, Vite, XYFlow, Lucide, Prism and accessible Radix dialogs. A typed fixture model represents the synthetic relay-api repository at two demo revisions. Source strings provide resolvable inclusive source ranges. Signup and login journeys share files and functions; a prepared verification PR changes signup, login, configuration, lessons, and a maintainer record. No fixture is represented as a real inspected public repository.

A React context and event reducer own navigation-independent state: repository, snapshot, active journey/step, selected node/source, predictions, completed journeys, learner preferences, practice result, and maintainer states. Persist minimal schema-versioned local data. Pure domain functions enforce journey gating, source resolution, first-attempt learning evidence, targeted review, and draft/review/approval transitions. A demo service interface supplies simulated asynchronous operations and is replaceable by a backend.

## Supporting workflows

Repository connection is a simulated flow with validation, indexing, errors, retry and capability limits. Journeys provide selection, progress, branch prediction, scenario and explanation controls. Learning routes change with profile and goal. Practice provides editable prepared code, progressive hints, acceptance checklist and labelled simulated checks. Changes provide PR selection, base/head comparison, changed-step source navigation, direct versus possible impact, setup delta and targeted lessons. Knowledge provides draft, review, explicit approval, publication and stale/superseded states. Progress reflects recorded local interactions and includes reset/export controls.

## Verification

Domain tests protect reference integrity, branch gating, first attempt retention, route personalization, approval transitions and targeted invalidation. Verify production build. Use a real browser to exercise the end-to-end workflow and inspect desktop and mobile screenshots, graph readability, code ranges, keyboard/focus behavior, overflow and console errors. Document real checks separately from simulated in-product outcomes.
