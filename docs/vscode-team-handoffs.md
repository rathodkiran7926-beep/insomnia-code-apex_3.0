# VS Code sessions and shared Context Handoffs

The extension now uses the existing collaboration identity and web Context
Handoffs backend. The web UI, web login flow, and existing access checks were
not changed. F17 Agent Context Bridge was not added.

## Local demo setup

The backend contains an explicit local development seed. It does not put a
password into the extension bundle or prefill credentials into the web app.

1. In ignored `backend/.env`, set `CODEBASE_MENTOR_IDE_DEMO=1`.
2. The native IDE connection creates the local demo workspace automatically. The seed command remains available but is not required.
3. Restart the backend using `npm.cmd start`.
4. Start the existing frontend and set extension `codebaseMentor.apiBaseUrl`
   and `codebaseMentor.webBaseUrl` to the correct backend and web roots.
5. Install `codebase-mentor-0.1.3.vsix` and reload VS Code. In a trusted workspace, handoffs connect automatically without email/password prompts.

Local development accounts:

| Account | Email | Password | Demo team role |
| --- | --- | --- | --- |
| Junior | `junior@demo.com` | `Demo@12345Local` | developer |
| Senior | `senior@demo.com` | `Demo@12345Local` | reviewer |

The password has the extra `Local` suffix to satisfy the existing 12-character
authentication minimum; web password rules were not weakened. Seeding refuses
production mode and email/ID collisions. Repeated seeding does not overwrite an
existing user's password, saved work, or membership. All automatic local IDE connections use the same Junior Developer identity, so this mode does not isolate different people using the same backend. Previously saved records keep their original owners; they are not reassigned. An already restored account session remains usable, but the extension no longer offers Sign In or Sign Out controls.

## Save and resume a session

1. Connect an analysed repository and select indexed source in the editor.
2. After the automatic local connection, select **Save Session** under Saved Tasks.
3. Review the title, completed work/discovery, blocker, next action, local branch,
   HEAD, and source attachments in the existing checkpoint editor.
4. Save. The backend associates the checkpoint with the authenticated user.
5. Use **Resume**, **Details**, **Ask Senior**, or **Delete** from Saved Tasks.

The existing resume implementation restores version-aware source navigation and
saved notes and reports changed/unchanged/unknown captured source evidence.
It never overwrites local files, checks out commits, uploads editor buffers, or
claims the saved source matches unsaved changes. It restores saved context,
not the complete VS Code window or terminal state.

Old explicit single-user checkpoint and handoff APIs remain available under
their existing opt-in flags. Anonymous records are not silently reassigned to
the first account. Signed-in checkpoint actions use the authenticated route
and cannot see another developer's checkpoints or anonymous records.

## Share directly with a senior

1. Select **Share Context** near the source selection, or **Ask Senior** on a
   saved task. Existing mentor/map/PR handoff launch actions use the same bridge.
2. Choose the team workspace and a reviewer/maintainer in that workspace.
3. Enter or review a task title, question/blocker, completed work, and next action.
4. Review the author, recipient, repository, pinned commit, selected file/range,
   local context, and optional saved checkpoint reference.
5. Select **Generate Handoff Link**. No share happens before this confirmation.
6. Select **Copy Link** or **Open in Browser**.

The link uses the configured web root and the existing `/#/handoffs/<id>` route.
It contains no token or password. The backend first creates the real web handoff,
then returns its existing authorized share path. The senior signs in to the
existing web application, reads pinned code and repository architecture, adds
feedback, and uses the existing review/resolution workflow.

The handoff includes the existing backend repository snapshot, selected source,
authored notes, and any saved checkpoint reference. It does not upload local
workspace files, an unsaved editor buffer, or uncommitted code. Source ranges
are capped at the existing 300-line backend limit and shown in the preview.

**Saved Handoffs** shows the current developer's authored and assigned handoffs
for the connected repository and chosen team. Refresh retrieves current status.
Open displays pinned source and senior comments in a plaintext editor. Copy Link
and Browser actions remain available. Browse accesses all items in a loaded page;
Next/Previous load older pages. Resolution details and the complete repository
explorer remain in the existing web interface.

## Identity and storage

- Native `POST /api/ide/team/connect` establishes the local developer session without credentials. It requires the explicit development flag, a loopback socket and host, and the native IDE header; browser Origin/fetch-metadata and forwarded requests are rejected. Production mode and remote backend hosts are unsupported. Existing `/me` and workspace member APIs remain in use. Web login routes and membership checks are unchanged.
- Session cookies stored only in VS Code SecretStorage, keyed by backend identity.
  Passwords are never stored. Tokens never enter webview HTML/model/messages or links.
- Requests reject redirects and unsafe API paths; switching backend URLs does not
  forward a cookie from another backend.
- Existing `task_checkpoints` table receives a nullable `user_id` column. Existing
  anonymous records retain `NULL`. Owner checks cover list/get/create idempotency,
  resume, and delete. No separate checkpoint or handoff database is created.
- Existing collaboration, handoff session/snapshot/comment/activity tables and web
  handoff membership checks are reused unchanged. Workspace members must be explicitly
  admitted to the team; the URL alone grants no access. Demo workspace has only the
  two seeded users. This does not add private GitHub repository ingestion.

New authenticated checkpoint APIs: `GET /api/ide/team/checkpoints/capabilities`,
`GET/POST /api/ide/team/checkpoints`, `GET/DELETE /api/ide/team/checkpoints/:id`,
and `POST /api/ide/team/checkpoints/:id/resume`. They retain the existing checkpoint
request/response contracts, with capability mode `authenticated-user`.

Shared handoffs use existing `POST/GET /api/handoffs`, `GET /api/handoffs/:id`,
`POST /api/handoffs/:id/share`, and the web's existing comment/review endpoints.

## Verification

Backend integration tests perform demo login, personal checkpoint save/resume/
delete, unauthorized access checks, handoff creation, generated-link checks,
senior source review, senior feedback, and junior feedback retrieval. Extension
tests verify SecretStorage/session restoration, authenticated checkpoint routing,
backend isolation, expiry, and safe destinations, plus existing extension flows.
These tests do not replace an installed VS Code host test or deployment test.
