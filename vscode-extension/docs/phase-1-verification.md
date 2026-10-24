# Phase 1 verification — 24 October 2026

Environment: Windows, Node 24.15.0, npm 11.12.1, installed VS Code 1.143.1.

## Results

| Command (from vscode-extension/) | Result |
| --- | --- |
| `npm.cmd install --save-dev typescript@^5.9.3 @types/node@^22 @types/vscode@~1.100.0 esbuild @vscode/vsce @vscode/test-electron --fetch-retries=0` | Passed after enabling network access |
| `npm.cmd audit fix --fetch-retries=0` | Did not resolve two transitive development-tool advisories |
| `npm.cmd install --fetch-retries=0` after MSAL override | Passed; zero vulnerabilities |
| `npm.cmd ci --fetch-retries=0` | Passed; 155 packages installed, zero vulnerabilities |
| `npm.cmd run check` | Passed strict TypeScript checking |
| `npm.cmd test` | Passed 14/14 tests |
| `npm.cmd run build:dev` | Passed; JS and source map generated for F5 debugging |
| `npm.cmd run build` | Passed; production bundle approximately 7.34 KB |
| `npm.cmd run test:host` | Passed two real Extension Host runs, empty window and open folder |
| `npm.cmd run package:vsix` | Passed; codebase-mentor-0.1.0.vsix, 7 archive entries, approximately 8.03 KB |
| `npm.cmd run package:list` | Only LICENSE.txt, package.json, README.md, dist/extension.js, resources/icon.svg |
| `code.cmd --user-data-dir .host-test/vsix-user --extensions-dir .host-test/vsix-extensions --install-extension .\codebase-mentor-0.1.0.vsix --force` | Successfully installed in isolated test directory |
| `git diff --check` | Passed; Git emitted only its Windows line-ending conversion notices |

Unit/integration tests cover URL restrictions and redirects; GET/POST JSON;
400/401/403/404/429/500; non-JSON and malformed health; whole-request timeout;
caller cancellation; changing configuration; unreachable endpoints; all five
connection states; retry; stale response cancellation; disposal; real activation
against an editor API substitute; contributed command/view parity; actual
registered Focus provider states; command destinations; notification silence;
and cleanup of listeners, requests and registrations.

The backend integration test starts the **existing backend/src/server.js** on a
temporary loopback port with DATABASE_PATH=:memory:, validates connection,
stops it, verifies Disconnected, restarts it and verifies recovery. It loads no
.env and performs no repository analysis or provider calls.

Real VS Code host tests activate the extension, focus Focus/Map/Changes, invoke
all three commands, check the real backend contract, change the URL to invalid,
and recover. Both logs contain MENTOR_HOST_PASS and exit code 0. Isolated user
data and extensions live under ignored .host-test/. Normal editor settings and
extensions were not changed.

## Problems found and resolved

- The four original tracked extension files were empty; no implementation was overwritten.
- PowerShell blocks npm.ps1/npx.ps1; commands use npm.cmd/npx.cmd.
- Sandboxed npm network access failed; dependency installation succeeded with network access enabled.
- Context7 could not reach npm in the sandbox; official VS Code Tree View,
  Workspace Trust and Bundling documentation was checked through the web tool.
- Initial test bundling preserved subdirectories and the test import path was
  wrong; tests now share a bundle, preserving ApiError class identity as well.
- Electron could not read its installation under the filesystem sandbox;
  isolated host testing succeeded outside that sandbox without changing ACLs.
- The first host test retained an old getConfiguration snapshot; tests now
  re-read configuration per request, as production already did.
- Packaging tooling pulled vulnerable MSAL; an explicit 7.1.1 override produces
  zero audit findings. It crosses Azure Identity's declared major range; local
  VSIX packaging and installation pass, but publishing/auth paths are untested.
- Independent read-only review found no blockers. Its state-observation test
  gap was addressed with actual activation/provider integration coverage. Its
  follow-up identified an unbounded test wait; a ten-second timeout was added.

## Limits and next phase

No manual visual review across light/dark/high-contrast themes was performed.
Native TreeItems/ThemeIcons inherit VS Code themes. Extension Host tests are
automated functional checks, not screenshot or accessibility certification.
VS Code emitted unrelated built-in Copilot/API-proposal and deprecation logs;
both test windows nevertheless exited successfully.

No Marketplace publication or authentication was attempted. The local publisher
and license notice require project-owner review before distribution. The
backend remains unauthenticated and loopback-only. Remote/WSL/container hosts
and the minimum supported VS Code 1.100 version were not tested.

Phase 2 can add explicit snapshot association using existing snapshot APIs.
Selection explanations require a backend selection resolver; hosted sharing
requires real authentication and repository authorization. No Phase 2 code,
backend logic, uploads, telemetry or fake feature results were added.

Git: the initial tree was clean on branch vs-extension. All final tracked
changes and new files are under vscode-extension/. No commits were created.
Generated bundles, profiles, dependencies and VSIX files are ignored.
