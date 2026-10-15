# Frontend verification

Verified locally on 15 October 2026 with Node.js 24.15, TypeScript 7.0.2, Vite 8.3.4, Vitest 5.0.4, and Chromium through Playwright CLI. These checks concern the actual frontend implementation. They are separate from the explicitly simulated outcomes inside the product.

## Automated checks

- `npm test`: 18 passing domain/state regression tests in two files.
- `npm run build`: TypeScript and optimized production build pass.
- Route splitting keeps the production entry chunk below the build warning threshold; graph and supporting screens load as separate chunks.
- Dependency installation audit reported no known vulnerabilities at installation time.

Tests cover citation existence and inclusive ranges, version-specific source, all prepared scenario source spans, prediction gates and timeline jumps, retained first answers, profile/goal prerequisites, targeted relearning, explicit publication transitions, scenario/version-aware completion, originating lesson completion, unrelated lesson rejection, and stale practice-response protection.

## Browser verification

Actual interactions were exercised in Chromium on the development server, then the core workflow was repeated against the production preview at port 4173.

| Area | Observed check |
| --- | --- |
| Atlas and source | Node selection updates the file/range and selected component; system/function scopes work; source/evidence views resolve the fixture reference |
| Global search | Ctrl K opens search, no-match state appears, and selecting a component returns to its workspace context |
| Journey | Playback stops at a prediction; timeline jumping respects the earliest unanswered check; correct and incorrect answers show feedback; first attempts survive retries |
| Panel modes | Prediction remains available with the mentor hidden and on its Inspector tab; the full player is the hidden-panel fallback |
| Completion | Signup success completes; revisiting an already completed run can complete its originating routing lesson; active selection survives reload |
| Practice | Hints reveal progressively; original/guided examples show distinct simulated outcomes; resetting while a response is pending discards that older result |
| Personalization | Switching to the experienced profile removes the middleware prerequisite; selecting testing adds the regression-test activity |
| Changes | Selecting a changed journey step changes its source diff; setup shows unverified status; the second PR opens an independent proposed test patch |
| Relearning | Head login introduces and gates its verification question; completion preserves prior-version learning and clears only applicable review |
| Knowledge | Draft → review → approve → publish requires separate actions; selecting the changed head invalidates a base explanation |
| Progress/data | First-attempt evidence remains visible; JSON export downloads successfully; reset clears local completions and answers |
| Responsive | All eight routes have no document-level horizontal overflow at widths 390, 768, and 1366 px |
| Mobile navigation | Modal drawer opens, Escape dismisses it, and focus returns to its trigger after the dialog callback |
| Mobile atlas | Readable component list is the default; an explicit interactive-map view remains available |

The final production route sweep and core workflow reported **zero page errors**. The production console was also inspected and had zero errors or warnings after the fix below.

## Problems found and corrected

Browser review led to larger utility typography, stronger secondary-text contrast, tighter graph spacing, responsive comparison-grid constraints, readable mobile component navigation, source-panel focus/expansion, labelled mobile search, and accessible modal navigation.

Independent source review found checkpoint skipping, revision/scenario identity problems, originating-lesson completion gaps, source-context mismatch, stale asynchronous results, and pending approval revision mismatch. The state transitions and focused regression checks address these findings.

A clean production preview caught a Prism 1.30 grammar-registration error not present under development dependency prebundling. The narrow Vite transform in `vite.config.ts` gives the TypeScript and JSON grammars an explicit Prism binding. This matches the failure described in the [upstream Prism report](https://github.com/PrismJS/prism/issues/4088). The actual production application was rebuilt and rechecked after the fix.

## Artifacts and limits

Final screenshots are in `output/playwright/`: `workspace-desktop-final.png`, `workspace-mobile-final.png`, and one `*-final.png` for each supporting screen. They are local review artifacts and excluded from version control. The JSON export was saved there as a check artifact as well.

Chromium is the only browser tested. This was focused usability, responsive, and keyboard verification, not a comprehensive accessibility certification. No real repository parser, AI service, authenticated maintainer account, sandbox, database, email provider, or peer study was run. Synthetic file references resolve within the bundled sample and must not be represented as upstream evidence.
