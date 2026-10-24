# Codebase Mentor for VS Code — Phase 3

A desktop IDE companion using the **same backend** as the web platform.
Focus connects each workspace folder to an existing analyzed snapshot and shows
Git identity, branch, HEAD, indexed revision and local/unsaved changes. Explain
Selection opens a small Mentor panel beside the editor, with grounded answers,
follow-ups, provenance and clickable source citations. Map and Changes retain
honest empty states for future architecture and PR features.

## Development

Use Node 24+ and npm. From `vscode-extension/`:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd run test:host
npm.cmd run package:list
npm.cmd run package:vsix
```

Open this directory in VS Code and press F5 to launch an Extension Development
Host. The build task runs first. `npm.cmd run watch` rebuilds while developing.
The host test uses the installed VS Code desktop executable; set
`VSCODE_EXECUTABLE_PATH` if it is installed elsewhere. It launches isolated
empty, single-folder, reopened and multi-root windows, using generated Git
fixtures with hooks disabled. The existing backend analyzes deterministic test
fixtures and stores snapshots in an in-memory database. No provider credentials
or GitHub access are needed. A generated test-only companion permits real modal
confirmation testing outside VS Code's dialog-blocking extension-test mode.
CDP drives the actual picker, input, confirmation and rendered sidebar; artifacts
live under ignored `.host-test/`. The runner stops its backend and test windows.

Start the existing backend separately using `npm.cmd start` from `backend/`.
Its default URL is `http://127.0.0.1:3001`; health is `GET /api/health` returning
`{"ok":true}`. Health needs no LLM credentials; repository connection needs an
existing analyzed snapshot from the web platform.

## Commands and settings

- **Codebase Mentor: Open Workspace** opens the Mentor sidebar and Focus view.
- **Codebase Mentor: Check Backend Connection** checks health and revalidates saved bindings.
- **Codebase Mentor: Open Settings** opens this extension's settings.
- **Codebase Mentor: Connect Repository** selects a folder (in multi-root
  workspaces), asks for an existing snapshot ID, and previews identity/revision
  before explicit confirmation. A confirmed repository mismatch is rejected.
- **Codebase Mentor: Change Snapshot** repeats that workflow for another snapshot.
- **Codebase Mentor: Refresh Repository Context** re-reads Git metadata and
  revalidates the selected folder's snapshot. It never starts analysis.
- **Codebase Mentor: Disconnect Repository** removes only that folder's local
  binding and cancels its requests. Backend snapshots and Git are unchanged.
- **Codebase Mentor: Explain Selection** resolves selected lines (or the cursor)
  to an indexed component, then calls the existing shared Mentor Q&A endpoint.
  Available in the Command Palette, editor context menu and Focus view.
- **Codebase Mentor: Open Mentor** shows the latest answer in the singleton panel.
- **Codebase Mentor: Ask Follow-up** asks a new question about that component.
- **Codebase Mentor: Open Source Citation** chooses a citation to inspect.
- **Codebase Mentor: Cancel Mentor Request** cancels explanation/source requests.

## Grounded explanations and source navigation

Analyze the repository in the web platform, connect its snapshot in Focus, then
select a function or place the cursor inside it and run Explain Selection. The
backend's `/api/ide/resolve-selection` uses stored source ranges: containing
declarations rank by specificity; ambiguity offers a picker. If only an enclosing
module covers a broad selection, the UI labels that scope explicitly. It never
claims expression-level analysis or guesses symbols inside the extension.

Answers use the existing `POST /api/snapshots/:id/questions` service. The panel
shows the actual facts-only/AI-assisted mode and backend notice. It keeps at most
five answers in memory, with Previous/Latest actions. Follow-ups are independent
component-scoped questions, not persistent chat history. Failed requests retain
the previous answer. Retry, cancellation and stale-context guards are supported.

Different revisions, dirty files, unsaved buffers or unknown identity require
explicit acknowledgement before explaining the **indexed** component. No buffer
is uploaded. Git HEAD, file state and editor version changes cancel obsolete
requests, including when a follow-up is submitted from the panel.

Citations are checked against stored snapshot reference IDs, file/range metadata
and exact immutable GitHub locations. Complete indexed text comes from
`GET /api/snapshots/:id/source?referenceId=...`. Local files open at cited lines
only when repository, revision, path, file state and actual text agree. Text
comparison accepts LF/CRLF differences and rejects symlink redirection. Otherwise,
a read-only **indexed SHA** tab displays the actual backend text without shifting
its lines. Unavailable source can offer an explicitly chosen validated permalink.

The panel uses no framework, direct HTTP or command URLs. Backend text is escaped,
scripts use a nonce CSP, assets stay local, and messages carry only checked
actions/answer/reference IDs or bounded questions.

Git identity uses the official built-in `vscode.git` API v1, preferring the
branch's upstream remote, then origin, then an unambiguous single remote. HTTPS,
SSH and `.git` GitHub forms normalize to credential-free canonical identities.
Missing/ambiguous Git evidence stays **Unverified**, requiring acknowledgement.
Matching repositories with different commits remain connectable and show
**Different revision**. Only full, equal commit SHAs establish **Matched**;
uncommitted and unsaved changes receive separate warnings.

Bindings use versioned `workspaceState` records keyed by workspace-folder URI.
Only snapshot ID, canonical identity, indexed commit, normalized backend base
URL and connection time are saved. They survive restart and are revalidated.
Changing backend host **or URL prefix** hides old bindings until you switch back
or explicitly connect another snapshot. No graph or source content is persisted.

Configure `codebaseMentor.apiBaseUrl` in User/Remote settings. This machine
setting cannot be overridden by repository workspace settings. The backend
root URL may include a reverse-proxy prefix; `/api/health` is appended to it.
Only loopback HTTP or HTTPS is accepted. Embedded credentials, query strings
and fragments are rejected. Redirects are not followed. Checks time out after
five seconds for health; questions allow 45 seconds and indexed-source retrieval
35 seconds to accommodate existing backend limits. All can be cancelled. No
retries or polling run automatically:
checks run at activation, configuration changes and explicit user requests.
In SSH, WSL or containers, localhost means the extension host's machine.

## Privacy and current limits

The extension sends health/snapshot/source GETs and explicit resolver or Q&A
POSTs. Resolver payloads contain only snapshot ID, relative file and line range;
Q&A contains only component ID and question. Local Git URLs, absolute paths and
source contents are never uploaded. Git metadata
comes from the built-in API; the extension runs no shell commands or repository
scripts, stores no secrets and adds no telemetry. Restricted Mode allows health
and settings; snapshot restoration/connection and Git/editor context require trust.

`src/vscode-adapters/editorContext.ts` exposes metadata for later phases, with
0-based editor positions and an explicit 1-based line-range conversion. It reads
no document text. URI containment checks handle Windows casing and remote
authority boundaries. Nested repositories cannot inherit a parent's binding.
Selection events debounce local UI refresh and do not request backend data.
Source text is read locally only during an explicit explanation or citation
action to compare it with indexed text; it is never sent back to the server.

The current backend has **no production authentication or repository ACLs**.
Keep its loopback binding. HTTPS configuration alone does not add authorization.
Future authentication can supply transport headers from VS Code SecretStorage;
no login or fake token system is included here.

Architecture/PR analysis, checkpoints and handoffs remain outside Phase 3. No demo results
are rendered. The publisher ID is for local packaging; obtain the project's
publication identity and redistribution permission before distributing.

The bundle has no runtime npm dependencies. The VSIX contains the manifest,
bundle, monochrome Activity Bar icon, Mentor JS/CSS, README and license notice. Sources,
development dependencies, test profiles and logs are excluded.

The MSAL dependency override pins a security fix for VSIX development tooling.
It crosses Azure Identity's declared major range; local packaging is verified,
but Marketplace sign-in/publishing is not tested or part of Phase 3.

Implementation references: [Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view),
[Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust),
[Bundling extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension).
Git compatibility references: [API v1 in VS Code 1.100](https://github.com/microsoft/vscode/blob/1.100.0/extensions/git/src/api/git.d.ts)
and [current Git API declarations](https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts).
See also [Webview security](https://code.visualstudio.com/api/extension-guides/webview)
and [read-only virtual documents](https://code.visualstudio.com/api/extension-guides/virtual-documents).
