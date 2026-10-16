# Judges presentation readiness — 16 October 2026

**Verdict: the frontend can demonstrate the learning workflow, but the attached presentation script is not ready to present as a description of completed functionality.** Several of its central claims have no implementation, and some new homepage/voice content contradicts the bundled source. Presenting those claims while inviting judges to interact would expose substantial gaps.

This review treats the attached script as presentation material to verify, rather than instructions to implement its promises. It also distinguishes the product specification's proposed backend from the approved frontend prototype scope.

## Checks actually performed

- Restored declared dependencies with `npm.cmd install`. Before restoration, the build failed because GSAP was missing. Installation added two packages and reported zero known vulnerabilities at that time.
- `npm.cmd test`: **18 tests passed in two files**, freshly rerun after installation. These test frontend domain/state rules; they do not execute the synthetic Express application or learner patches.
- `npm.cmd run build`: TypeScript and production bundling passed after restoration.
- Served the resulting production build at `http://127.0.0.1:4173/` and exercised it in Chrome through Playwright CLI.
- Selected architecture nodes, launched signup, advanced source-linked steps, answered an incorrect prediction and retried, and completed the base signup journey.
- Revealed a practice hint, ran the baseline, applied the guided example, and obtained the prepared 3/3 example outcome.
- Completed the local maintainer draft → review → approve → publish sequence. Switching to head invalidated that published base explanation.
- Changed the learner experience and goal; the beginner prerequisite disappeared and the testing activity appeared.
- Opened journey comparison, source diff, and setup drift. Starting relearning selected head/login; stored learning retained `signup:success:base` and marked studied signup for review.
- Browser speech synthesis entered speaking state without an API key; pause and stop changed the browser speech state correctly. **Audible output on the actual presentation laptop/projector was not verified.** No paid ElevenLabs request was made.
- Loaded all nine screens at 1366×768 and 390×844. The route sweep recorded **zero page errors**, and the final console had zero errors/warnings. Desktop routes had no document horizontal overflow. Mobile overflow is listed below.
- Read-only independent source review checked claims and implementation boundaries.

## Presentation blockers and risks

### 1. Agent Context Bridge and SQLite storage are absent — high

The script calls Feature 12 a core engine and promises verified exports to Cursor/Claude Code. There is no bridge route, task-specific context export, external-agent integration, or SQLite implementation in the frontend. The available JSON export contains learner activity, not architectural agent context.

Evidence: `src/App.tsx:44`, `src/pages/Progress.tsx:52`, `src/state/WorkspaceContext.tsx:81`, and `src/services/demoService.ts:3`.

**Presentation correction:** “Our next integration is an Agent Context Bridge backed by versioned evidence storage.” Show an architecture proposal if available, but do not demonstrate learner-activity export as this bridge. The specification contains proposed contracts; that is separate from an implemented agent runtime or database.

### 2. Voice is separate scripted narration, not the flagship synchronized voice journey — high

The homepage has four fixed narration topics. It can use browser speech synthesis or optional ElevenLabs synthesis. The actual Workspace JourneyPlayer does not narrate its steps. “Talk to AI” runs timers and always plays the overview; it does not capture or recognize speech. No voice input selects a journey or answers an arbitrary question.

Evidence: `src/components/VoiceAgentDemo.tsx:333`, `:400`, `:460`; `src/components/JourneyPlayer.tsx:1`.

The browser audit confirmed another visible mismatch: `hasApiKey: false` and browser speech active, while the UI said **“Speaking · ElevenLabs Rachel.”** The engine label and branded voice names do not identify the actual browser fallback voice. Pending ElevenLabs fetches also have no cancellation/request identity, creating a source-reviewed risk of superseded narration starting after stop or navigation. That external-provider path was not exercised.

**Presentation correction:** “Prepared spoken product explanations are available on Home; the source-linked journey is interactive. Per-step voice synchronization and live voice questions are planned.” Do not speak into the microphone expecting query recognition. Rehearse audio on the real presentation hardware.

### 3. Signup narration contradicts the deciding source — high

The voice workflow says signup issues a signed JWT. In the canonical fixture, base signup returns account ID/email; the preview adds pending verification. **Login issues the token.** The unused pipeline component repeats signup token issuance, refers to an absent `auth.service.ts`, and includes validation rules inconsistent with the practice baseline. Home's prepared signup explanation also mentions unverified accounts without selecting the head revision.

Evidence: `src/components/VoiceAgentDemo.tsx:112`, `src/components/InteractivePipeline.tsx:77`, `:114`, `src/pages/Home.tsx:40`, and `src/data/fixtures.ts:41`, `:49`, `:77`, `:88`.

**Required correction before showing the workflow narration:** align the descriptions with the canonical snapshot. Until corrected, demonstrate signup in Workspace and explain the token boundary through the separate login journey. `InteractivePipeline` is not imported/rendered by the current routes, so do not plan a live demo around it.

### 4. “Verified starter task with automated checks” overstates practice — high

The editor is functional, but checking only compares normalized text against the initial and guided fixture strings. Other patches are unsupported, including potentially valid alternative solutions. No Zod schema, test process, sandbox, or repository code is executed. The practice screen correctly discloses this; the homepage's sandbox/verification claims do not.

Evidence: `src/services/demoService.ts:24`, `src/pages/Practice.tsx:201`, `src/pages/Home.tsx:369`.

**Presentation correction:** “This editable exercise demonstrates acceptance criteria with simulated baseline and guided-example outcomes. The real execution adapter is a backend integration.” Say “3/3 prepared outcomes,” not “we ran three tests on this patch.”

### 5. Public repository, immutable evidence, and automatic drift claims are not delivered — high

`acme/relay-api` and the apparent commits are synthetic fixtures. Source citations resolve within those fixtures. There is no inspected public upstream repository, content-hash verification, live PR ingestion, merge listener, repository parser, SQLite graph, or automatic exact-line dependency analysis. Changed steps and affected concepts are authored explicitly. Setup drift displays a prepared environment diff; it does not establish requiredness or execute setup.

Evidence: `src/data/fixtures.ts:11`, `src/data/types.ts:1`, `src/pages/Changes.tsx:36`, `:287`, `src/state/WorkspaceContext.tsx:356`, `src/domain/model.ts:108`.

Targeted review does work as frontend state: learning a base concept and choosing the changed head adds that concept to review. It does **not** monitor new PRs in the background. The current relearning CTA opens a fixed login journey even when signup is the studied concept marked stale; do not claim it generates an individually tailored lesson for every affected artifact. Reviewing login alone will not clear a pending signup review.

**Presentation correction:** “Two prepared revisions demonstrate PR comparison, configuration differences, and revision-aware review state. Automated analysis and verified repository evidence are planned.” Replace “can never contradict” with “designed to share versioned evidence”; current copy already demonstrates why validation is needed.

### 6. Homepage inquiry and attachment controls imply unavailable functionality — medium

Custom input is stored but not used when launching the workspace; submit always starts signup. The attachment button also launches signup rather than opening a file picker. The homepage must not be presented as arbitrary repository Q&A or file ingestion. Workspace supports explicitly prepared response categories.

Evidence: `src/pages/Home.tsx:133`, `:202`, `:233`.

**Presentation workaround:** use “Open Workspace” and the existing prepared question buttons. Avoid inviting an arbitrary spoken or typed judge question as a supported feature.

### 7. Homepage metrics and novelty claims lack evidence — medium

The new homepage asserts 200+ parsed endpoints/boundaries, 50+ mastered checkpoints, ten-second tracing of any route, and “the first AI-Native” platform. There are no measurements establishing these claims. They conflict with the script's promise not to quote unverified statistics. The script's “What doesn't exist…” statement also asserts an unproven market absence.

Evidence: `src/pages/Home.tsx:193`, `:418`.

**Presentation correction:** describe the integration as your proposed differentiation. Replace the metric cards with actual demo inventory or clearly labelled evaluation plans. GitHub's 180M+/36M figures are supported as **2025 Octoverse figures**, not independently verified current 2026 totals: [official GitHub Octoverse article](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/).

### 8. Layout and accessibility need a final presentation pass — medium

At 1440×900 and 1366×768, the map, source, and prediction choices often require scrolling between regions. Large headers use valuable projector space. Do not assume judges will simultaneously see the map, deciding line, and prediction. The new homepage voice section also extends below one screen.

The current 390px route sweep found document scroll widths of **439px in Workspace**, **394px in Journeys**, and **410px in Changes**. Other routes remained at 390px. These are regressions relative to yesterday's verification document. The mobile workspace screenshot visibly clips its mode tabs. The custom voice key dialog and clickable orb also need keyboard/focus review; the orb lacks a keyboard activation handler.

**Presentation workaround:** use the rehearsed desktop viewport, deliberate scrolling, and the source-link button to bring the deciding code into view. Do not claim a complete mobile/accessibility audit has passed.

## Feature-to-demo map

| Pitch feature | Current observable behavior | Honest status |
| --- | --- | --- |
| Architecture Atlas | Select/search nodes, zoom/pan, inspect linked source and evidence | Working with bundled fixtures |
| Code Journey | Signup/login, scenarios, stepping, playback, source selection | Working explained paths; no runtime trace |
| Voice-guided synchronized journey | Separate Home narration; no journey audio linkage | Partial; synchronization absent |
| Predict, explain, verify | Choice feedback, first-attempt history, deciding source link | Working predictions; no learner citation/explanation verification |
| Starter task | Editable text, hints, baseline/guided/unsupported results | Simulated; no execution |
| PR impact and diff | Prepared PRs, selectable changed steps, source diff | Working fixture comparison |
| Setup Drift Guard | Static `.env.example` additions and limitations | Prepared illustration; no setup checks |
| Targeted relearning | Studied-version state and review invalidation | Working local logic for predefined concepts |
| Maintainer explanation | Draft/review/approve/publish, source context, invalidation | Working local identity simulation |
| Personalized route | Experience and three contribution goals change lesson selection | Working deterministic rules |
| Progress | First attempts, completed scenarios, studied revisions, export/reset | Working local activity, not measured mastery |
| Agent Context Bridge | No architectural context export/integration | Absent / roadmap |
| Evidence graph and public snapshot | Typed in-memory fixtures and localStorage | Backend design, not implemented engine |

## A defensible opening statement

> “This is our frontend prototype using a synthetic TypeScript/Express repository. We will demonstrate the connected learning loop: source-linked architecture and journeys, recorded predictions, a simulated contribution exercise, local maintainer review, and relearning across two prepared revisions. Repository analysis, live voice Q&A, verified execution, and the external-agent context bridge are the next backend integrations.”

## Rehearsal and live-demo route

Before judging, use one browser profile and the same host/port throughout. Local state is origin-specific: switching between localhost, 127.0.0.1, or ports changes the stored demo. Start the built app using:

```powershell
npm.cmd install
npm.cmd test
npm.cmd run build
npm.cmd run preview -- --port 4173 --strictPort
```

Open `http://127.0.0.1:4173/#/workspace` directly. On a disposable rehearsal profile, **My progress → Reset local learning data → Reset local data** resets answers and approvals. This clears that profile's learning history; export it first if needed. Do not clear all browser storage or assume refreshing resets the demo. Recheck that `main` is selected and predictions are unanswered. Preload each required route and rehearse with the actual screen/speaker configuration.

| Demo beat | Exact interaction | What to say |
| --- | --- | --- |
| Learn | Select Input validation, inspect highlighted guard, choose Follow a request | “The same source connects the component and the journey.” |
| Predict | Next step; answer invalid-email checkpoint; continue to duplicate-email checkpoint | “We retain the first answer and show the deciding condition.” A recorded answer permits advancing even when incorrect; completion is activity, not proof of mastery. |
| Finish base | Answer duplicate check, step to Save the account, Complete journey | Finish this before changing revisions so there is learned base context to invalidate. |
| Contribute | Practice → Run demo checks → Reveal hint → Apply guided example → Run demo checks | “These are prepared outcomes; production execution is behind a clean service boundary.” |
| Capture rationale | Knowledge & decisions → prepared explanation → Save draft → Submit → Approve → Publish | “Only explicitly published local rationale enters mentor context.” Do this on base before changing revisions. |
| Relearn | Changes → PR #42 → changed steps / source diff / Setup drift → Start the relearning journey | “The preview adds verification and changes the login guard. Selecting it marks prior studied concepts for review.” |
| Keep knowledge current | Knowledge & decisions / My progress | Show Needs review, retained first answers, and base study history. Do not confuse activity export with Agent Context Bridge. |
| Optional support | My learning path → experienced profile / testing goal | “Explicit experience and goal change prerequisites.” |

Keep the full live click-through as a separate rehearsed segment or significantly shorten the speech. The attached script already budgets almost the entire eight minutes for speaking. There is no measured rehearsal proving that navigation, scrolling, voice playback, and nine slides fit its time boxes. Have saved screenshots as a fallback. The current source mismatch means the “How It Works” voice topic should not be used until corrected.

## Artifacts and remaining work

Screenshots captured for this review are in `output/playwright/presentation-*.png`; audit scripts are alongside them. These local artifacts are ignored by version control. `docs/verification.md` records 15 October checks and should not be treated as verification of the updated homepage/theme. README still describes Workspace as the default route; the updated app defaults to Home.

**Completed during this audit:** dependency restoration, fresh test/build/browser checks, this report. **No product feature code was changed.** Correct the misleading copy and narration, decide which absent features belong explicitly on the roadmap, address the voice cancellation/provider labeling and responsive regressions, and rehearse the revised pitch before declaring the whole presentation ready. Adding live speech, execution, public-repository analysis, or the bridge is separate implementation work, not something established by a passing frontend build.
