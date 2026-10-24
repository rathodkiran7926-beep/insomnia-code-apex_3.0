# Phase 8 - Final release verification

Date: 2026-10-24. Scope: finish the existing Phase 8 audit, verify the frozen
local MVP end to end, and validate the packaged VSIX. No feature, backend
business-logic, dependency or architecture changes were made.

## Verdict

**READY WITH LIMITATIONS**

All required local workflows passed, including the installed VSIX. Remaining
items are documented platform/scope limitations, not reproducible product
blockers. Hosted authentication, private-repository assurance, cross-device
sharing and Marketplace publication remain outside this local MVP.

## Fixes in this continuation

Only verification-harness defects were found and fixed:

1. `test/host.ts` (multi-root handoff): the scenario hid the Focus sidebar on
   purpose, then expected the final native assertion to find `Codebase Mentor`
   in sidebar DOM. The product assertions (anchor retained, draft retained,
   revalidated actions) already passed; the run timed out on that assertion.
   Restore sidebar visibility before the final check. Hidden-Focus recovery is
   still exercised before restoration.
2. `scripts/test-host.mjs` (offline scenario): the preceding `public` scenario
   intentionally creates a local commit to test revision mismatch. The shared
   public fixture then stayed at that commit, so `offline` saw a different HEAD
   and the confirmation button became `Connect different revision`. Reset the
   shared fixture to the pinned `p-limit` revision before `offline`, matching the
   existing reset already used by `pr` and `handoff-save`.

Previous Phase 8 product fixes remain in place and were re-exercised:
source-navigation cancellation guards, draft retention across connection
revalidation and repository restoration, and multi-root handoff anchoring with
no active editor.

## Verification evidence

| Check | Command | Result |
|---|---|---|
| Backend tests | `npm test` in `backend/` | **98/98 pass**, 0 fail/skip |
| Extension tests | `npm test` in `vscode-extension/` | **163/163 pass**, 0 fail/skip |
| Strict TypeScript | `npm run check` | pass |
| Production build | `npm run build` | pass |
| Development Host | `npm run test:host` | 13/13 scenarios pass |
| Installed VSIX | `npm run test:vsix` | 14/14 scenarios pass from clean profiles |
| Live public PR (development) | `MENTOR_TEST_LIVE_PR=1 MENTOR_TEST_SCENARIOS=pr npm run test:host` | pass |
| Live public PR (installed) | `MENTOR_TEST_LIVE_PR=1 MENTOR_TEST_SCENARIOS=pr npm run test:vsix` | pass |
| GitHub PR list/metadata | `node scripts/test-pr-live.mjs --inspect` | pass, PR 106 with fork head |
| Whitespace/conflict markers | `git diff --check` | pass |
| Package contents | `npm run package:list` | 11 intended files only |

Development and installed scenarios: `empty`, `single`, `restart`, `multi`,
`multi-handoff`, `public`, `offline`, `checkpoint-save`, `checkpoint-resume`,
`checkpoint-delete`, `handoff-save`, `handoff-reopen`, `handoff-delete`,
`handoff-disabled`; plus live `pr`.

Critical paths re-verified:

- Offline recovery: backend stop leaves the draft intact; restart revalidates
  the repository; explicit preview retry succeeds.
- Multi-root handoff: hidden Focus, no active text editor, repository anchor and
  draft survive a same-binding connection check.
- Source navigation: cancellation and checkout changes never reveal a stale or
  wrong local editor (9/9 source regressions).
- Cross-feature identity: Mentor, Map, Changes, Time Machine and Handoffs retain
  repository/snapshot/component identity through the integrated host suite.
- Privacy: checkpoint and handoff capabilities default disabled; installed
  `handoff-disabled` passes; no telemetry, uploads or credentials added.
- Packaging: actual archive installed and loaded from isolated extension
  directories (version 0.1.1), not development source.

Logs: `vscode-extension/.host-test/phase8-dev-host-final.log`,
`phase8-installed-final.log`, `phase8-live-pr-host.log`,
`phase8-live-pr-installed.log`, `phase8-final-unit.log`,
`phase8-final-backend.log`.

## Final VSIX

`C:\Users\shrey\Everything\insomnia-code-apex_3.0\vscode-extension\codebase-mentor-0.1.1.vsix`

Version 0.1.1, 64,336 bytes, 11 files. SHA-256
`5d38d1d50e0a3817c56553906f894b97d6b2df002bba9eeca2f9fd02f1133c0b`.
Packaged `extension/dist/extension.js` matches the current production build
(SHA-256 `902eff76c3e2a4ea0e841e61a1fd14597ec1560fbee9ecd24cc62ee7a4e61f27`).
Excluded: source, tests, scripts, docs, maps, dependencies, logs, VSIX files and
environment files; no secrets are bundled.

Install:

```powershell
code --install-extension C:\Users\shrey\Everything\insomnia-code-apex_3.0\vscode-extension\codebase-mentor-0.1.1.vsix --force
```

## Remaining limitations

- Windows desktop VS Code and Node 24 are the verified environment; macOS,
  Linux and remote extension hosts are unverified.
- Live GitHub checks require external network access and are subject to
  GitHub availability/rate limits. No such failure occurred in this run.
- The shared backend must be started and configured separately; no hosted
  identity, ACLs, private-repository assurance or secure team sharing exists.
- The local checkpoint/handoff gates are single-user, loopback-oriented
  controls, not production authentication.

No commits or Marketplace publication were performed. All prior uncommitted
work remains untouched.
