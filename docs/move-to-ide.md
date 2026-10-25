# Move to IDE

Hover over a repository source line number for 500 ms to show **Move to IDE**.
The popup contains only this action. Move onto it to keep it open; moving away
closes it after one second. Clicking a source line pins the action open until an outside click, Escape, or navigation. Keyboard users can focus a line, wait for the action,
then press Tab or Down to focus it. Escape closes it before a containing dialog.
A touch tap selects the line and opens the same action immediately; it stays
available until an outside tap, Escape, or navigation. Clicking a line and
Shift-clicking a range retain their existing behavior.

## Setup

1. Build/install `vscode-extension/codebase-mentor-0.1.6.vsix` and reload VS Code.
2. Open and trust the intended local repository. Configure the extension to use
   the same Codebase Mentor backend as the web app.
3. Click **Move to IDE**. If the snapshot is not connected, the extension finds an open folder with a verified matching Git remote and offers **Connect & open source** using the link's snapshot ID; no manual ID entry is required. Canceling leaves the existing connection unchanged. Check out that
   snapshot's commit for direct local navigation. Changed, dirty or missing local
   files open immutable indexed source instead.
4. In the web source viewer, hover over a line and select **Move to IDE**.
   Allow the browser's request to open VS Code if prompted.

The viewer receives an explicit `ideTarget` with `snapshotId`, `repository` and
`commit`. The action is hidden if this context is missing or conflicts with the
source permalink. Repository analysis, workspace, repository journeys and shared
handoff viewers pass their real saved snapshot. Illustrative journeys without
repository snapshot context do not expose the action.

The existing extension receives a `vscode://codebase-mentor-local.codebase-mentor/moveToSource`
URI containing the snapshot ID, repository identity, full commit hash, repository-relative
file path, and absolute one-based source line. No code, credentials, filesystem
root, or arbitrary command is sent in the link. Excerpt offsets use
`source.startLine + rowIndex`, not the displayed row index alone.

## Validation and navigation

The URI handler rejects missing, duplicate, unknown or oversized parameters.
It restores existing workspace bindings without analyzing or downloading the
repository again, retrieves validated evidence for the requested snapshot, and
requires a connected binding matching that exact snapshot ID, repository and
commit. When none exists, a verified local checkout can be connected after reviewing the snapshot confirmation. If several matching checkouts are open, choose one. No new repository scan occurs. Multiple matches require a workspace choice. Canceling opens nothing.
The file must appear in that snapshot's real source references.

`SourceNavigation.openWorkspaceLine` checks the requested line against complete
indexed source and creates a single-line reference with its own pinned permalink.
It reuses `openWorkspaceSource`, which performs the existing path, Git identity,
commit, complete source-content, dirty-buffer, and binding checks. Its new exact
line mode avoids applying historical line numbers to different local code. A
verified file opens in a regular editor tab at column zero of the requested line.
If local source is missing, unsafe, changed, or dirty, the existing immutable
indexed-source path opens a regular tab labeled with the commit and reveals the
same line. Existing Atlas and Mentor navigation retain their existing behavior.

Disconnected/mismatched bindings, unavailable evidence and invalid lines produce
actionable errors in VS Code. Unverifiable local files use validated indexed
source; no local file or line is guessed. The browser cannot determine whether the OS has a working VS Code
protocol handler; its inline status explains installation and connection steps
without claiming that navigation succeeded. The OS/browser launch prompt remains
a manual check. No unrestricted localhost command endpoint is added.

## Files and verification

- `RepositorySource.tsx`, `useDelayedHover.ts`, `repository-source.css`: shared
  delayed/touch action, cleanup, keyboard interaction and viewport positioning
  updated on scroll/resize. The popup stays outside the source scroller; expanded
  readers retain their dialog focus scope. The native manual-popover top layer
  prevents transformed parent dialogs from clipping the action.
- `frontend/src/domain/moveToIde.ts`: pinned source-to-URI validation.
- `vscode-extension/src/commands/moveToIde.ts`: protocol handler and command;
  both use the same validation and source navigation.
- `vscode-extension/src/vscode-adapters/sourceNavigation.ts`: exact verified
  local navigation, preserving other callers' behavior.

Run frontend tests/build and extension tests/type checks with their existing npm
scripts. `node backend/scripts/verify-move-to-ide-ui.js` uses the existing
`backend/data/http-verification.sqlite` fixture (prepare it with `verify:http`)
to check delay, hover persistence, keyboard/Escape, selection/ranges, and mobile
positioning in Chrome/Edge. It does not launch the user's normal VS Code window.

For the real isolated editor check, run from `vscode-extension` in PowerShell:

```powershell
$env:MENTOR_TEST_SCENARIOS = 'move-to-ide'
npm.cmd run test:host
```

The focused host scenario uses a generated repository and isolated VS Code
profile, invokes the same validated URI navigation path, and asserts the actual
  editor document, cursor line, visible range, regular tab, out-of-range
  rejection and dirty-file indexed fallback. `npm.cmd run test:vsix` runs it against the packaged extension when
the same scenario environment variable is set.

Verified for v0.1.6: 107 frontend tests, 198 extension tests, TypeScript checks,
frontend production build, browser interaction checks, and the focused real
VS Code scenario against both development code and the installed VSIX. Browser
checks include early-hover cancellation, touch selection/action persistence,
scroll/resize, normal and expanded keyboard handling, transformed-dialog clipping,
mobile viewport bounds, line/range selection and unmount cleanup.
