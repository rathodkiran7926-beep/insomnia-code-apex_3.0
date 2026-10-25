# Codebase Mentor for VS Code

A local desktop companion to the **same backend used by the web platform**.
Connect a workspace to an analyzed public GitHub snapshot, understand indexed
code, explore relationships, review PRs, resume saved tasks, and prepare context
for manual sharing. One Activity Bar container contains **Focus**, **Map** and
**Changes**; larger Mentor, Architecture Diagram, checkpoint and handoff forms open beside the editor.

## Install and connect

Requires desktop VS Code1.100+ with a Node24+ shared backend and Git on its PATH.
The extension uses the built-in VS Code Git API; it never runs repository scripts.
The verified release environment is Windows VS Code1.143.1 and Node24.15.0.

1. Install `codebase-mentor-0.1.6.vsix` using **Extensions: Install from VSIX?**, or:

   ```powershell
   code --install-extension .\codebase-mentor-0.1.6.vsix --force
   ```

2. Start the existing backend from this project's `backend/` directory:

   ```powershell
   npm.cmd ci
   npm.cmd run dev
   ```

   Configure optional provider credentials in the backend environment only.
   Fact-based Mentor answers work without an LLM key. Keep the server's loopback
   binding and retain its SQLite database path across restarts.

3. Set `codebaseMentor.apiBaseUrl` in User/Remote settings if needed. The default
   is `http://127.0.0.1:3001`. It is a machine setting; repository settings cannot
   override it. Open **Codebase Mentor** in the Activity Bar and check connection.

4. Obtain an analyzed snapshot. Start the existing frontend and open
   `http://127.0.0.1:5173/#/repository` to analyze a public GitHub repository, or
   use the same backend API:

   ```powershell
   $job = Invoke-RestMethod http://127.0.0.1:3001/api/analyses -Method Post -ContentType application/json -Body '{"url":"https://github.com/sindresorhus/p-limit"}'
   Invoke-RestMethod "http://127.0.0.1:3001/api/analyses/$($job.id)"
   ```

   Check job status until `status` is `complete`. The completed job returns
   `snapshot_id` (not `snapshotId`). In the web app, copy the snapshot ID shown
   beside **Analysis ready**. The extension also accepts the completed analysis
   **job ID** and resolves it to its stored snapshot automatically.
   Both must refer to the **same backend instance and SQLite database** as the
   extension's `codebaseMentor.apiBaseUrl` setting. A healthy server on a
   different port or database does not contain the snapshot. The extension
   does not start a separate repository analyzer.

5. Open and trust the local repository folder. Run **Codebase Mentor: Connect
   Repository**, enter the snapshot ID (or completed analysis job ID), and
   review its repository/commit.
   Multi-root workspaces retain a separate binding per folder. Missing or
   ambiguous Git identity stays unverified. Different revisions are explicit.

## Daily workflows

| Goal | Action |
| --- | --- |
| Understand code | Select a declaration and run **Explain Selection** |
| Ask more | Use the Mentor panel's component-scoped follow-up |
| Open evidence | Click a source citation for the exact indexed location |
| Explore one component | Select code and run **Show Related Code**; the one-hop diagram opens in an editor tab |
| Explore the entire repository | Choose **Full architecture** in Focus; a separate VS Code tab renders the complete indexed repository graph (not a web link) |
| Review a PR | Open **Changes**, select/enter a matching PR, then **Start Analysis** |
| Resume work | Use **Save Task Checkpoint** and Focus ? **Saved Tasks** |
| Prepare a question | Use **Ask Senior with Context** and Focus ? **Saved Handoffs** |

**Focus dashboard (webview):** responsive repository status card, four main actions,
current editor selection, and collapsible Saved Tasks / Saved Handoffs. The
**Repository details & settings** section contains longer technical metadata and
connection management. Saved-item menus retain Resume, Details, Ask Senior,
Delete and historical-source workflows through the existing extension commands.
Disabled local-only features display a small 'Off' label until expanded. The
webview communicates with the trusted extension host through a validated command
allowlist, without direct backend requests, source uploads or credentials.

**Architecture Diagram:** the Map sidebar leads with **Open Architecture Diagram**;
advanced tree navigation remains available under **Detailed Map Tree**. A lightweight,
local SVG editor-tab webview displays the
backend's bounded one-hop JSON neighborhood. Click a node to inspect it;
double-click or choose **Explore Node** to request the next backend
neighborhood. The inspector provides Open Source, Explain with Mentor, Ask
Senior and relationship evidence. Zoom/Fit are view-only. No Mermaid CDN,
LLM call, extra graph analyzer, direct webview networking, or duplicated
backend business logic is used. The existing native Map tree remains available
for keyboard-focused navigation and as a fallback.

Mentor and Map reuse the backend resolver and candidate picker. Relationships
retain their stored type, direction and uncertainty. They are static evidence,
not observed execution. Citations open local files only when repository, commit,
path, dirty state and actual text agree; otherwise they open read-only indexed
source or offer a validated immutable permalink. Unsaved buffers are not uploaded.

PR results distinguish merge base, target tip and head. Before/after Source,
Map, Mentor and handoff actions retain the exact comparison side, including forks,
without changing your saved workspace binding. **Stop Local Waiting** stops local
requests, not the backend worker. Resume waiting explicitly. **Refresh** reads the
stored comparison; **Reanalyze Selected PR** explicitly creates a new job.
Unavailable complete source offers the real PR files page rather than a patch
presented as full source. GitHub availability and API quotas can limit live PRs.

**Full architecture** in Focus opens an **entire-repository architecture diagram inside VS Code**, based on the already-analyzed `GET /api/snapshots/:id` graph. Modules/files and their backend-defined relationships are grouped for presentation only. Large repositories open at a folder overview; click folders to expand and search indexed file paths. Click a file to inspect its indexed components, **Open source** to navigate to its working file, or **Explore 1-hop** to open the focused Map. The diagram supports mouse pan and wheel zoom. There are no additional model calls and no browser navigation. The snapshot response is bounded to 24 MB, 10,000 components and 50,000 relationships; exceptionally large analyses display a clear error rather than silently inventing or omitting graph data.

**Open Full Architecture Atlas** opens the web workspace configured by
`codebaseMentor.webBaseUrl` (default `http://127.0.0.1:5173`). Select the repository
there; that browser route does not restore the IDE's selected component.

## Local checkpoints and handoffs

## Authenticated sessions and team handoffs

Handoffs connect automatically to a trusted local backend with `CODEBASE_MENTOR_IDE_DEMO=1`. No email or password is requested. All automatic connections use the shared Junior Developer identity in the IDE Local Demo workspace. Web sign-in remains unchanged.
Session cookies use VS Code SecretStorage and are scoped to the configured backend.

After connecting, **Save Session** stores a personal checkpoint in the existing backend.
Saved Tasks retains Resume, Details, Share/Ask Senior and Delete. **Share Context**
prepares a question, completed work and next action, lets you choose a senior, and
requires **Generate Handoff Link** confirmation. Copy Link and Browser open the
existing authenticated web Context Handoffs page. Saved Handoffs shows authored and
assigned sessions, live status and feedback; Open retrieves senior comments.

No web login defaults were changed. A backend-only opt-in local demo seed is
available; see the repository's docs/vscode-team-handoffs.md for setup and accounts.
The demo password is not embedded in this extension. Source attachments use the
saved repository snapshot, not unsaved buffers. Workspace members require existing
authorization; a link alone grants no access. F17 is not part of this change.

The team flow was checked with backend integration and extension action/transport
tests. An installed VS Code host check for this change remains a manual step.

### Legacy local preparation (advanced)

The following flags apply only to the retained anonymous local APIs, not to signed-in
sessions. **Prepare Local Handoff (Advanced)** opens the original preview/Markdown
workflow. Existing Open Handoff and export commands remain available.

Both features are **disabled by default**. Deliberately enable each one in the
backend environment and restart the same server:

```dotenv
CODEBASE_MENTOR_LOCAL_CHECKPOINTS=1
CODEBASE_MENTOR_LOCAL_HANDOFFS=1
```

The flags are independent. All data routes require direct safe loopback requests;
forwarding headers and unsafe Host/Origin are rejected. Localhost is not per-user
authentication. Do not enable these features on a hosted/proxied deployment.

**Checkpoints:** write your own task title, discoveries, unresolved question and
next step. Review optional source references and indexed/local Git metadata before
Save. Focus lists backend records; Resume restores original notes and snapshot.
Stored-file comparison is bounded text comparison, not semantic impact or a local
checkout diff. Unknown evidence stays unknown. Delete requires confirmation and
retains repository snapshots. Branch/HEAD are explicitly extension-reported.

**Handoffs:** start from Editor, Mentor, Map, PR side or checkpoint. Enter your own
question and attempts. The form shows the backend destination before **Build
Preview** transmits fields. Review the complete backend-generated Markdown and
exclude unnecessary evidence. Excerpts, inferred documentation and checkpoint
notes default off. **Apply selection** rebuilds the preview; Save requires that
exact approval. There is no extra AI agent or silent source upload.

Saved handoffs survive restarts. **Copy Markdown** and **Export Markdown file**
require explicit actions and use exact canonical content; export is not delivery.
Deletion retains checkpoints and snapshots. No email, issue, PR comment, chat
message, public link or authenticated senior response is created. Fork handoffs
belong to the original fork repository; reconnect that repository to list them
later. Missing historical snapshots keep approved Markdown readable/exportable
through a current same-repository binding, with source unavailable when missing.

Title200 chars; checkpoint notes2000 each. Handoff question1500 chars; attempts/
extra context2000 each; up to16 reference candidates, five direct relationships
and four selected excerpts (20 lines/3000 chars each). Package and Markdown64KB
limits apply. Sensitive paths are excluded and suspicious strings raise warnings;
these checks cannot detect every secret. Review all content before manual sharing.

## Recovery and privacy

- Backend offline: **Check Backend Connection**, then refresh the intended view.
  Same-repository drafts survive temporary revalidation; actions remain blocked
  until the snapshot is ready. Actual workspace/backend/snapshot changes clear
  obsolete private context. Normal tab switches preserve local drafts.
- Save/Delete unconfirmed: the server may have completed it. Refresh before
  deliberate retry. Identical approved Save retries retain the same request ID.
  Mutating POSTs are never automatically retried.
- Missing snapshot: reconnect an existing analyzed version. The extension never
  guesses identity from names or silently substitutes the current checkout.
- Different/dirty revision: acknowledge indexed explanations and inspect indexed
  source. Reanalyze committed source in the shared platform to update evidence.
- PR failures: inspect the actual backend message and GitHub quotas. Retry
  explicitly; no fabricated comparison or successful test execution is shown.
- Remote window: localhost refers to the extension host's machine. WSL, SSH and
  containers require endpoint reachability and are not verified release targets.

HTTP is restricted to loopback; other destinations require HTTPS. Embedded URL
credentials, query/fragment configuration and redirects are rejected. HTTPS alone
does not add authentication. Webviews use escaped text, local assets and nonce
CSPs; no command URLs or direct webview HTTP. No telemetry, credentials, terminal
history, editor buffers or whole repositories are uploaded by the extension.
User-authored preview fields go only to the explicitly configured backend.

This release supports the **local single-user public-repository MVP**. Hosted
identity/ACLs, secure team sharing, private-repository assurances, authenticated
senior replies and runtime tracing are absent. macOS/Linux and remote extension
hosts are unverified. The local publisher ID is not a Marketplace release; no
publication or third-party redistribution permission is implied.

## Development and verification

From `vscode-extension/`, use `npm.cmd ci`, `npm.cmd run check`, `npm.cmd test`,
`npm.cmd run build:dev` and `npm.cmd run package:vsix`. The prepublish hook runs the
production build. `npm.cmd run package:list` shows shipped files.

`npm.cmd run test:host` exercises development source. After packaging,
`npm.cmd run test:vsix` installs the actual archive in clean isolated profiles and
runs the integrated desktop suite. Tests create ignored clones/databases, use the
shared backend, and drive native confirmations. They never target your workspace
Git history or normal VS Code profile. Optional `MENTOR_TEST_LIVE_PR=1` exercises
live public PR analysis; normal tests label controlled PR fixtures clearly.
Source maps, dependencies, source trees, tests, profiles, logs and environment
files are excluded from the VSIX. See `docs/phase-8-release.md` for final evidence.

## Move to IDE from the web source viewer

Hover over any source line number for 500 ms, then select **Move to IDE**. The extension opens the exact line in a regular editor tab after checking the connected repository, saved commit and complete local file contents. A changed revision, dirty buffer, or missing local file opens labeled immutable indexed source at the requested line. Snapshot/repository mismatches are rejected. Touch users can tap a source line to reveal the action. Connect the matching snapshot first and allow the browser to open VS Code. See `docs/move-to-ide.md` in the repository for details and verification commands.
