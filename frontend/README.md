# Codebase Mentor

A React frontend for understanding an unfamiliar codebase. The Repository page now connects to the Node.js backend for real public GitHub analysis, architecture diagrams and source-grounded documentation. Existing learning and practice screens retain their demo fixtures. See the [project README](../README.md) for backend setup and analysis limits.

## Run locally

Requires Node.js 22.12 or newer and npm. Development was verified with Node.js 24.15.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. On Windows PowerShell with script execution restricted, use `npm.cmd` instead of `npm`.

```sh
npm test           # Domain and state-transition regression checks
npm run build     # TypeScript validation and production build
npm run preview   # Serve dist at http://127.0.0.1:4173
npm run format    # Format maintained source and configuration
```

The application uses hash-based routes, so static hosts do not need a history fallback. Repository analysis requires the backend: Vite proxies `/api` to port 3001. For production, the Node server serves `dist/` and the API together. No model key is required for extracted-fact documentation.

## Explore the prototype

The default route opens Home. Open **Mentor workspace** to inspect components and source, or choose **Follow a request** to start signup. Journey steps, selected components, source ranges, explanations, and predictions share the same context. Use **Read this step** for browser narration that stops when the step or revision changes.

| Experience       | What works                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository       | Real GitHub URL/revision analysis, background job progress, commit-linked React Flow architecture, component docs, analysis report, Markdown/Mermaid export                                 |
| Mentor Workspace | XYFlow pan/zoom, component search, focus, system/component/function views, node and relationship inspection, source/evidence tabs, source copying and collapse, contextual prepared answers |
| Code Journeys | Signup and login, success/failure scenarios, synchronized stepping, play/pause/restart, keyboard arrows, explanation depth, gated predictions, retained first attempts |
| Learning path | Beginner/experienced profiles, three goals, explainable prerequisite selection, connected lesson completion, personalization opt-out |
| Practice | Editable sample patch, progressive hints, real local Zod assertions for supported password rules, per-assertion criteria, unsupported-syntax handling, self-reflection |
| Changes | Verification PR comparison, independent proposed test patch, unified source diff, selectable changed steps, direct versus possible impact, static setup delta, targeted relearning |
| Team knowledge | Source-linked question, editable draft, explicit review/approval/publication, revision-bound invalidation, superseded state, published rationale in mentor context |
| Progress | Completed scenarios and journeys, first/retry answers, studied revisions, pending relearning, local export and reset |
| Agent Context Bridge | Revision-bound JSON and prompt export with checked source slices, environment names, clipboard/file handoff, and a targeted relearning card |

Use **Ctrl/⌘ K** for global search. Journey arrows work outside input fields, dialogs, and the graph. Narrow screens use a modal navigation drawer, stacked panels, and a readable component list with an optional interactive map. Motion respects reduced-motion preferences.

## What is simulated

**`acme/relay-api` is a synthetic, bundled sample used outside the Repository page.** Its apparent commit identifiers are demo revision labels, not public Git commits. The Repository page instead uses real analysis tied to exact Git commits; optional AI commentary is configured on the backend. Repository code is never executed.

- Source snippets, graph relationships, explanations, PRs, and answer keys are prepared fixtures.
- “Explained path” describes possible sample-source behavior. No recorded runtime scenario or real intermediate state is fabricated.
- The Repository page analyzes public repositories without connecting a GitHub account. Other sample workspace screens continue to show bundled fixtures.
- The mentor supports prepared validation, duplicate-email, and design-rationale responses. Other questions show an explicit limitation.
- Practice parses a supported schema subset and constructs actual Zod password validators. Input assertions check digit and length behavior, including equivalent digit rules. Arbitrary JavaScript is never evaluated; unsupported syntax is reported explicitly. No full API or database tests are run.
- Setup findings are derived from the bundled environment-template diff. No local setup check or email delivery is presented as verified.
- Agent exports resolve every included source slice against the selected bundled revision. They contain variable names, not environment values or learner history. External-agent ingestion is manual; no live agent connection or guarantee against hallucinations is provided.
- Maintainer authorship, review, and approval are local demo actions, not production authentication. Only explicitly published explanations enter mentor context.
- Lesson completion records activity, not broad mastery. Actual source-location accuracy, independent explanation assessment, sandbox outcomes, and peer-study results remain unassessed.

## Structure and integration boundaries

```text
src/
  components/   Shell, accessible dialogs, architecture atlas, journey player,
                source/evidence viewer, mentor panel, code diff
  data/         Typed repository, source, graph, journey and PR fixtures
  domain/       Pure source/learning/approval rules and regression tests
  pages/        Eight connected product screens
  services/     MentorService interface and explicit asynchronous demo adapter
  state/        Shared context, versioned local persistence and user actions
  styles.css    Shared visual system and responsive layouts
docs/           Approved design, implementation plan, demo guide and verification
```

Replace `src/services/demoService.ts` with authenticated API calls and replace fixture loading with a snapshot/evidence service. Preserve immutable version identity, resolvable source spans, evidence kinds, unsupported boundaries, and reviewed answer keys. The reducer helpers in `src/domain/progress.ts` keep assessment history separate from display state; UI components do not infer successful execution or approve model-generated rationale.

Production integration will additionally need authenticated maintainer identity, transactionally stored approvals, real source/content hashes, server-side citation validation, actual test/run evidence, repository capability negotiation, and a reviewed analysis service. This prototype intentionally does not implement those backend systems.

Minimal learner activity is saved under `codebase-mentor.workspace.v1` in browser local storage. No network analytics or remote persistence are used. Export and reset controls are in **My progress**.

## Design and attribution

React, TypeScript, Vite, XYFlow, Radix Dialog, Lucide, Prism, Geist, and Vitest are used under their respective package licenses. Fonts are bundled locally. No reference screenshot, third-party product UI, repository code, or community architecture skill was copied into the implementation. Sample source and product copy were created for this prototype with AI assistance.

Implementation references: [XYFlow custom nodes](https://reactflow.dev/learn/customization/custom-nodes), [XYFlow component API](https://reactflow.dev/api-reference/react-flow), [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog), and [Vite setup](https://vite.dev/guide/).

See [the judges live demo guide](docs/live-demo-guide.md) for the tested click-through, precise pitch wording, and repeatable Playwright commands. [The 17 October verification report](docs/live-demo-verification-2026-10-17.md) records the current checks and limits; older audit documents describe earlier revisions.
