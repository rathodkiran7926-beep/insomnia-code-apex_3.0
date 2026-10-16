# Judges live demo: 4:00–8:00

Use the built app at **http://127.0.0.1:4173/#/workspace**. This guide describes the working prototype as verified on 17 October 2026. It supersedes the older demo guide and the feature-status findings in the 16 October readiness audit for the changes listed below.

## Prepare before presenting

From `frontend/`:

```powershell
npm.cmd install
npm.cmd test
npm.cmd run build
npm.cmd run preview -- --port 4173 --strictPort
```

Use one host and port throughout; learning data belongs to that browser origin. Use a separate browser profile for rehearsals. To start fresh in that profile, choose **My progress → Reset local learning data → Reset local data**. This clears that profile’s learning history. Open **Mentor workspace** and confirm **Repository version: main**.

Use 1366×768 or a larger desktop viewport. Check **Read this step** with the actual laptop speakers/projector before judging. The journey uses browser speech and requires no API key. Keep your external coding editor open if you plan to paste the exported prompt there. The homepage’s separate voice demo is not part of this walkthrough.

## Click-through and pitch

| Time | Exact on-screen actions | Commentary |
| --- | --- | --- |
| 4:00–4:45 | In **Mentor workspace**, click **Map** to show the Architecture atlas. Click **Follow a request**, then **Read this step**. Play a few seconds; **Stop narration** or **Next step** stops the old step’s audio. Answer the input-validation checkpoint with **No, the handler returns before next()**. Continue through the controller to **Check existing email**. Click **Code** to show the deciding source beside the mentor. | “Here is the Architecture Atlas. In this sample repository, Mentor follows User Signup across the router, validation, service, and database boundary, with source-linked evidence and narration for the current step.” |
| 4:45–5:30 | At the duplicate-email checkpoint choose **No, the error stops this path**. Optionally try the wrong answer first and show its retained first attempt. Continue through hashing and saving; click **Complete journey**, then **Continue to practice**. Click **Run checks**: baseline is 2/3. Click **Apply guided example**, then **Run checks**: 3/3. | “The existing-email condition stops the insert. The practice exercise then checks password behavior with real local Zod assertions. An equivalent digit rule also works; removing the length check fails.” |
| 5:30–6:30 | Open **Changes**. The default PR is **#402 Require email verification for new accounts**. Click **Email verification** in the changed steps to update the diff. Open **Setup drift** and highlight the **Setup Drift Guard** alert naming `MAIL_PROVIDER` and `MAIL_FROM`. | “This prepared PR comparison shows the account lifecycle change and the new environment entries. The alert comes from the environment-template diff; local setup and mail delivery have not been executed.” |
| 6:30–7:15 | Click **Export PR #402 context**. This explicitly selects the PR’s head revision. Show **JSON snapshot**, its revision and citations, then **Download JSON**. Switch to **Prompt slice → Copy prompt**. Paste into your pre-opened external editor if desired. | “Feature 12 exports revision-bound source snippets, architecture constraints, and setup variable names. The coding agent receives the selected snapshot and its limitations, so it can check the revision before changing code.” |
| 7:15–7:40 | Show the **Targeted Relearning Card** beside the export. Because signup was completed on main, it says **1 studied concept needs review** and offers **Relearn signup**. Click **View learning summary** to show the retained first answers and pending review. Use your prepared final slide for the wrap-up. | “The update targets the signup flow I actually studied. My previous evidence is retained while the changed revision is flagged for review. Understand the flow. Prove the rule. Keep people and coding agents current.” |
| 7:40–8:00 | Leave this as a navigation or question buffer. | Thank the judges. |

**Finish the base signup journey before changing revisions.** Answering a checkpoint alone does not record a completed study revision; the targeted card uses completed study history.

If showing relearning itself, choose **Relearn signup**, answer its head-version checkpoints, visit the new **Request email verification** step, and complete the journey. Progress then retains both base and head study evidence and clears signup’s review flag. This can be shown after the timed segment.

## Claims to keep precise

- PR #402 is the **email verification** example. Multi-currency is not implemented in this sample.
- The repository, commits, and PR are bundled synthetic fixtures. The app does not listen for real merges or analyze a live upstream repository.
- Practice runs actual assertions on parsed, supported `.min()` and digit `.regex()` password rules. It does not run arbitrary JavaScript, a full backend, or database integration tests. Keep the email/name schema structure intact.
- The bridge provides a real file/clipboard handoff. Automatic Cursor/Claude Code ingestion and a guarantee against hallucination are not established.
- Setup drift identifies names added to the environment template. It does not inspect the presenter’s `.env` or prove that startup will fail.
- Per-step browser speech was tested programmatically; audible output on presentation hardware still needs your check.
- No final slide deck is included in this repository. Use your existing presentation for the wrap-up.

## Repeat the browser verification

These Playwright CLI scripts use a real browser and the production preview. The rehearsal **resets learning data in its browser session**, runs the complete sequence, tests negative cases, and saves screenshots plus an actual context download under `output/playwright/`.

In a second terminal from `frontend/`:

```powershell
npx.cmd --yes --package @playwright/cli@0.1.22 playwright-cli open http://127.0.0.1:4173/#/workspace --headed
npx.cmd --yes --package @playwright/cli@0.1.22 playwright-cli snapshot
npx.cmd --yes --package @playwright/cli@0.1.22 playwright-cli run-code --filename scripts/demo-rehearsal.cjs
npx.cmd --yes --package @playwright/cli@0.1.22 playwright-cli run-code --filename scripts/demo-layout.cjs
```

The browser automation verifies actions and state, not the duration of a spoken human presentation. Rehearse your narration with a timer.
