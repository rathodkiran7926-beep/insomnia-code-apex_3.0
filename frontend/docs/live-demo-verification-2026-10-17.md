# Live demo verification — 17 October 2026

The five demo beats are connected in the frontend prototype. Use [the current demo guide](live-demo-guide.md) for the tested sequence and pitch boundaries.

## Repairs

- Added browser narration to the current journey step, with pause/resume, cancellation on step or revision change, and transcript fallback.
- Kept duplicate-email prediction gating and retained first-attempt evidence. Reset the mentor’s scroll when changing journey steps so the current checkpoint is discoverable.
- Replaced exact-string practice outcomes with actual Zod validators and input assertions for the supported schema subset. Equivalent `\\d` and `[0-9]` rules work; removing the length check fails. Acceptance criteria now reflect each assertion separately.
- Aligned the verification PR number to #402 throughout the app. Added a Setup Drift Guard alert derived from the bundled environment-template delta.
- Added a navigable Agent Context Bridge with revision-bound JSON and prompt views, actual downloads, clipboard copying, checked source slices, environment names, and explicit evidence limits.
- Replaced fixed login relearning with a card that selects the affected journey the learner studied. Completing head signup retains base history and clears signup’s review flag.
- Corrected head account-creation evidence and technical explanation to show unverified account creation and the pending response.
- Made the source pane scroll to its highlighted citation instead of returning to the top of the file.
- Fixed mobile journey-card and Changes-tab overflow; wrapped the context-export panel heading.
- Fixed GSAP “Invalid scope” warnings on rapid navigation by capturing each mounted DOM element as the animation scope, including a fixed target list for section animations.

## Verification performed

`npm.cmd test`: **27 tests passed in four files**. Regression checks cover equivalent practice solutions, missing length guards, unsupported executable input, selected-revision source evidence, environment-value exclusion, relearning selection, and existing learning/publication rules.

`npm.cmd run build`: TypeScript and production bundling passed.

The production app at `http://127.0.0.1:4173/` was exercised with Playwright CLI and a real Chrome browser. [The repeatable rehearsal](../scripts/demo-rehearsal.cjs) checks:

1. Atlas and signup launch; actual browser speech starts, pauses, resumes, and stops when the step changes.
2. Unanswered validation and duplicate-email checkpoints block advancement; an incorrect first answer survives a correct retry.
3. Base signup completion records the studied revision before practice.
4. Baseline 2/3, equivalent solution 3/3, missing-length failure, matching acceptance checklist, unsupported syntax, and guided 3/3 outcomes.
5. PR #402 changed-step selection and setup drift alert with both new environment variable names.
6. Actual JSON download and clipboard prompt copy. PR export selects head; base export excludes head-only configuration; template values are absent.
7. Signup-specific relearning, the added verification step, retained base/head study history, cleared review state, and persistence after reload.
8. The deciding duplicate-email condition is inside the visible source pane at presentation size.

The connected rehearsal recorded **zero page errors**. Screenshot artifacts and the downloaded `mentor-agent-context-b84f3d2.json` are under `output/playwright/`.

[The layout script](../scripts/demo-layout.cjs) checks Workspace, Journeys, Practice, Changes, Agent Context Bridge, and Progress at **1366×768** and **390×844**. All twelve route/viewport combinations fit within document width. Timelines, source, and tabs retain intentional internal scrolling. It also exercises rapid navigation with normal motion: **zero page errors and zero console warnings** after the animation fix.

An independent read-only review found the per-assertion checklist and stale Progress wording; both were corrected and retested. It found no additional important security, snapshot consistency, or narration-lifecycle issues.

## Practical limits

This is a bundled synthetic repository demo. There is no live PR merge listener, multi-currency implementation, executed local setup, real email delivery, full API/database test runner, or automatic external coding-agent integration. Practice checks supported password-schema rules using real Zod; arbitrary JavaScript is rejected.

The bridge is a manual file/clipboard handoff. Exported citations are checked against bundled snapshots, not a live upstream repository. No guarantee against external-agent hallucination is established.

Browser speech state was observed; sound from the presentation laptop/projector still needs a hardware rehearsal. The final slide is external to this repository. Browser automation does not establish that a human can finish the spoken presentation within four minutes.
