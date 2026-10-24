# VS Code extension merge

The vs-extension branch was merged into main using Git. Existing web features, the My Progress navigation edit, Learning Path recommendations, source-derived function labels, Practice, contribution analysis, impact previews, MCP tools, authenticated handoffs and approved team memory were retained.

## Conflict resolution

- Existing provider configuration and validated discussion handling remain the main backend implementation. Extension provider compatibility helpers were retained without changing the configured endpoint, credential, or default model. The real backend/.env was not changed.
- Existing authenticated collaboration stays at /api/handoffs. Local IDE preparation is additive at /api/ide/handoffs using ideHandoffContext.js and ideHandoffRoutes.js. Its independent context_handoffs table does not replace authenticated handoff sessions, senior replies, approvals or knowledge records.
- IDE saved tasks use /api/ide/checkpoints and the separate task_checkpoints table. Both local features retain their original explicit enable flags and direct-loopback checks. They remain disabled unless configured by the user.
- IDE selection resolution and source neighborhoods are mounted under /api/ide alongside these local routes.
- Both web and IDE test suites are retained. The incoming local handoff tests were renamed ideHandoffs.test.js; the existing authenticated handoffs.test.js is preserved. Local provider helper tests were retained separately as llmCompatibility.test.js.
- The mentor keeps its source-based behavior while bounding high-degree fact answers and citing the selected source first. Exact digest-bearing IDE saved exports bypass display-only relabeling to preserve their approved payload contracts.

## Verification

- 196 backend tests passed.
- 77 frontend tests passed and the frontend production build succeeded.
- 181 extension tests passed, including contract checks and real shared-backend startup/restart integration; the extension TypeScript check and bundled build succeeded.
- Browser regressions passed for journeys, saved callback labels, source highlighting, cursor resume, completion, mobile views, authenticated handoffs, reviewed knowledge and the Impact tab.
- Extension dependencies were installed from their lockfile with lifecycle scripts disabled. No actual VS Code extension-host UI session, installation or marketplace publishing was performed during this merge.

See vscode-extension/README.md for development and installation commands, and backend/README.md for the merged endpoint layout.
