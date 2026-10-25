# Move to IDE

Hover over a repository source line number for 500 ms to show **Move to IDE**.
The popup contains only this action. Move onto it to keep it open; moving away
closes it after 180 ms. Keyboard users can focus a line, wait for the action,
then press Tab or Down to focus it. Escape closes it. Clicking a line and
Shift-clicking a range retain their existing behavior.

## Setup

1. Build/install `vscode-extension/codebase-mentor-0.1.4.vsix` and reload VS Code.
2. Open and trust the intended local repository. Configure the extension to use
   the same Codebase Mentor backend as the web app.
3. Connect its existing analyzed snapshot in the extension. Check out that
   snapshot's commit and keep the target file unchanged.
4. In the web source viewer, hover over a line and select **Move to IDE**.
   Allow the browser's request to open VS Code if prompted.

The existing extension receives a `vscode://codebase-mentor-local.codebase-mentor/open-source`
URI containing the repository identity, full commit hash, repository-relative
file path, and absolute one-based source line. No code, credentials, filesystem
root, or arbitrary command is sent in the link. Excerpt offsets use
`source.startLine + rowIndex`, not the displayed row index alone.

## Validation and navigation

The URI handler restores existing workspace bindings without analyzing or
downloading the repository again. It selects a connected binding with the
requested repository and commit; multiple matches require a workspace choice.
That binding supplies the snapshot ID. The handler retrieves the existing
snapshot evidence and finds the file's real source reference.

`SourceNavigation.openWorkspaceSource` performs the existing path, Git identity,
commit, complete source-content, dirty-buffer, and binding checks. Its new exact
line mode rejects unverified targets rather than applying historical line numbers
to different local code. It opens a regular editor tab, places the cursor at
column zero of the requested line, and reveals the line. Existing Atlas and
Mentor navigation retain their existing fallback behavior.

Missing files, unsafe paths/symlinks, disconnected bindings, unavailable evidence,
different revisions, and changed source produce errors in VS Code. No file is
guessed. The browser cannot determine whether the OS has a working VS Code
protocol handler; its inline status explains installation and connection steps
without claiming that navigation succeeded. The OS/browser launch prompt remains
a manual check. No unrestricted localhost command endpoint is added.

## Files and verification

- `RepositorySource.tsx`, `useDelayedHover.ts`, `repository-source.css`: shared
  delayed action, cleanup, keyboard interaction and portal positioning outside
  the source scroller, including the expanded reader.
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
editor document, cursor line, visible range, regular tab, and out-of-range
rejection. `npm.cmd run test:vsix` runs it against the packaged extension when
the same scenario environment variable is set.
