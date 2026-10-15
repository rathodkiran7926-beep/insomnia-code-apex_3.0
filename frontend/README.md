# Codebase Mentor

A frontend prototype for understanding an unfamiliar codebase through a connected architecture map, source-linked journeys, contribution practice, and change-aware relearning.

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

The application uses hash-based routes, so static hosts do not need a history fallback. The generated `dist/` directory can be hosted as a static application. No credentials or environment variables are required.

## Explore the prototype

The default route opens the Mentor Workspace. Select a component to inspect its responsibility and source, or choose **Follow a request** to start signup. Journey steps, selected components, source ranges, explanations, and predictions share the same context.

| Experience | What works |
| --- | --- |
| Repository | Sample selection, input validation, connection failure/retry, simulated indexing, base/head revision selection, capability limits |
| Mentor Workspace | XYFlow pan/zoom, component search, focus, system/component/function views, node and relationship inspection, source/evidence tabs, source copying and collapse, contextual prepared answers |
| Code Journeys | Signup and login, success/failure scenarios, synchronized stepping, play/pause/restart, keyboard arrows, explanation depth, gated predictions, retained first attempts |
| Learning path | Beginner/experienced profiles, three goals, explainable prerequisite selection, connected lesson completion, personalization opt-out |
| Practice | Editable sample patch, three progressive hints, original source, baseline and guided outcomes, unsupported-edit handling, self-reflection |
| Changes | Verification PR comparison, independent proposed test patch, unified source diff, selectable changed steps, direct versus possible impact, static setup delta, targeted relearning |
| Team knowledge | Source-linked question, editable draft, explicit review/approval/publication, revision-bound invalidation, superseded state, published rationale in mentor context |
| Progress | Completed scenarios and journeys, first/retry answers, studied revisions, pending relearning, local export and reset |

Use **Ctrl/⌘ K** for global search. Journey arrows work outside input fields, dialogs, and the graph. Narrow screens use a modal navigation drawer, stacked panels, and a readable component list with an optional interactive map. Motion respects reduced-motion preferences.

## What is simulated

**`acme/relay-api` is a synthetic, bundled sample.** It is not an inspected upstream repository. Its apparent commit identifiers are demo revision labels, not public Git commits. The original project specification's real-repository analysis, AI orchestration, isolated execution, and peer study are outside this approved frontend implementation.

- Source snippets, graph relationships, explanations, PRs, and answer keys are prepared fixtures.
- “Explained path” describes possible sample-source behavior. No recorded runtime scenario or real intermediate state is fabricated.
- Repository connection and indexing are simulated. No GitHub account is connected.
- The mentor supports prepared validation, duplicate-email, and design-rationale responses. Other questions show an explicit limitation.
- Practice outcomes recognize the original schema and the guided example after whitespace/comment normalization. Arbitrary edits return **unsupported**. No edited code is evaluated or executed.
- Setup findings come from a static sample diff. No setup check or email delivery is presented as verified.
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

See [the demo guide](docs/demo-guide.md) for a connected walkthrough and [verification](docs/verification.md) for the actual checks and limits.
