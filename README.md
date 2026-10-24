# Codebase Mentor

## CodeJourney

Open **Explore → Code Journeys** (`/#/journeys`) to explore actual routes and components from the repository already analyzed in Repository and Mentor workspace. The purple rope timeline keeps each selected component, complete source file, code highlight, illustrated mentor and explanation synchronized. Choose another source connection path, adjust explanation depth, ask an event-specific question and resume saved progress. Browser narration is optional. Cards load 60 at a time with a Load more option; no example cards appear when an analysis is missing.

**Explained path** follows saved static call/handler evidence at the real commit; it does not establish execution order, branch outcomes or runtime values. There is no approved runtime capture for arbitrary analyzed repositories. The separate controlled signup example runner remains developer infrastructure and is never substituted for your repository. See [the CodeJourney implementation and setup guide](docs/codejourney-implementation.md) for APIs, source boundaries, setup and verification status.

## Change impact explorer

In **Mentor workspace**, select a component and click **Change impact**. Choose a component or an entire analyzed file to see direct and transitive incoming dependencies, affected HTTP routes, and a source-linked explanation of each path. Search by name, file, or full route path; filter to routes or direct/transitive connections; trace up to 20 hops; and export the complete impact report as JSON. Clicking a component opens its source in the workspace.

For a saved PR comparison, open **Changes → Change impact**. The default selection includes all changed components for the selected before/after snapshot. Switch versions to review removed code in the before snapshot and added code in the after snapshot. A dependency-only PR can have no changed source components; the explorer lets you choose a source component or file manually.

Impact uses the saved static graph and requires no model key. It follows callers, route handlers, database dependencies, module importers, and recorded middleware/router registrations. Ordinary caller traversal does not expand to unrelated sibling routes. Middleware and router changes include potentially affected registered routes; middleware path matching and execution order are unverified. Each result shows one shortest path from a changed component, with source evidence for every connection. Depth limits, unresolved relationships, and missing analyzed source can leave gaps. Local draft edits do not update the graph; reanalyze the committed repository to refresh it. These results identify places to review, rather than verified runtime failures.

Validation: `npm.cmd test` and `npm.cmd run build` in `frontend`; `npm.cmd run verify:pr-ui` in `backend` checks browser flows using the saved PR verification fixture (created by `verify:pr`).

## Real pull request comparison

Analyze your repository once in Repository, then open `/#/changes`. PRs load automatically from that repository: choose an open or closed/merged PR and select **Analyze PR**. No pasted PR link is needed. The page now reads actual PR metadata and patches, pins the common-ancestor/head commits, analyzes both source snapshots, and persists the comparison. Its five tabs show an overview, before/after architecture, source-derived request paths, real unified diffs, and manifest-derived setup recipes. The old prepared example is available only through **View prepared demo**. A **Merge simulator** tab previews per-file integration of captured target-branch and PR changes, shows conflicts, and supports local draft editing/export. Git on the backend PATH is required for three-way text merges. It never applies the preview to a branch or creates/merges a GitHub PR.

PR discovery uses `GET /api/pr/pulls?repository=<encoded GitHub URL>&state=all&page=1` with the URL shared from the Repository section, filters, refresh and 30-item pagination. The selected URL survives navigation and reload; listing PRs does not require a completed source analysis and never falls back to a saved comparison's repository. Existing callers can still provide `snapshotId` instead of `repository`; exactly one selector is required. The comparison endpoints are `POST /api/pr/analyses` (`{url}`), `GET /api/pr/analyses/:id`, and `GET /api/pr/comparisons/:id`. Jobs, progress and results use SQLite; the browser restores the latest job. Public GitHub access is required. Core comparison does not use configured AI or execute project scripts. Component discussion reuses the existing mentor with one selected version at a time.

Run `npm.cmd run verify:pr` in `backend` for read-only verification against a real public PR, then `npm.cmd run verify:pr-ui` for the Chrome/Edge smoke check. Tests use an isolated database under ignored `backend/data/`. See [the implementation and setup guide](docs/pr-impact-and-setup-guide.md) for code ownership, actual APIs/tables, setup, and limitations. Webhooks, combined two-version AI context, semantic delta walkthroughs and execution-verified setup are not implemented.

The React/Vite app has a Node.js/Express backend for public repository analysis. Open **Repository** (`/#/repository`) to analyze a repository, then **Mentor workspace** (`/#/workspace`) to inspect real files and components in a separate editor workspace, follow callers and dependencies, ask source-grounded questions, and download local code drafts. Architecture and documentation stay on the Repository page. Both pages share one analysis session; the workspace restores it after reload and never substitutes demo data. Existing bundled learning/practice workflows use an explicit `/#/demo-workspace` route.

Requires Node.js 24 or newer. On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm`.

## Run locally

Start the API in one terminal:

```powershell
cd backend
npm.cmd install
Copy-Item .env.example .env
npm.cmd run dev
```

Start the frontend in another:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Visit `http://127.0.0.1:5173/#/repository`. Vite proxies `/api` to `127.0.0.1:3001`. Try `https://github.com/heroku/node-js-getting-started` and optionally specify a branch, tag, or commit. Public GitHub access is required. No account or model key is required. Optional GitHub and LLM credentials belong in `backend/.env` only.

For a single local production server, run `npm.cmd run build` in `frontend`, then `npm.cmd start` in `backend`, and open `http://127.0.0.1:3001/#/repository`. The server binds to loopback; hosted multi-user authentication and deployment are outside this implementation.

## Implementation

```text
backend/
  src/github.js          Public URL validation, commit resolution, bounded downloads
  src/analyzer.js        TypeScript Compiler API, Express rules, evidence graph
  src/documentation.js   Fact documentation, validated optional LLM commentary, Mermaid
  src/storage.js         SQLite schema and transactional snapshot persistence
  src/worker.js          Background download / parsing / documentation worker
  src/server.js          HTTP jobs, progress, snapshots, export, frontend serving
  scripts/               Public-repository and end-to-end HTTP verification
  test/                  Small in-memory source fixtures and evidence assertions
  data/                  Generated SQLite databases and verification output (ignored)
frontend/src/pages/Repository.tsx
                         Real job progress, React Flow graph, details, docs, report
```

Every component and relationship has a source-reference ID. Source links are built by the backend from the repository, exact commit, file, and line span. Repositories, snapshots, components, relationships, source references, jobs, and documentation have SQLite tables. Jobs run in worker threads; restarts mark interrupted jobs as failed. The latest job ID is retained in browser local storage.

The UI offers folder overview and grouped component views, pan/zoom/fit controls, a minimap, component search and role filters, source-linked details, complete Markdown documentation and export. Inferred roles have dashed node borders; unresolved call targets have orange dashed edges. The report lists every unresolved item, including those omitted from the graph's 30-node unresolved preview.

## Supported analysis

- JavaScript and TypeScript declarations, import/export symbols, aliases, re-exports, and statically resolved calls.
- Express default/namespace imports, named `Router` imports, and `require('express')` constructors.
- Literal `app/router.get/post/put/patch/delete/head/options/all` registrations with resolvable or inline handlers.
- Static `use()` router mounts, including cross-file ES module imports; middleware is recorded separately.
- Likely service functions called by registered handlers, explicitly labelled as an inference.
- PostgreSQL `query()` on a local instance constructed from a named `pg` `Pool`/`Client` import. SQL effects are not executed or inferred.

README purpose statements are presented as author claims. Code findings document extracted declarations, registrations and relationships. With no model key, basic fact documentation is fully available and AI explanations are explicitly unavailable. The optional OpenAI-compatible adapter receives bounded code facts, treats repository content as untrusted data, and validates structured output with Zod. It rejects unknown components, unrelated or cross-snapshot references, and prose attempting to provide source coordinates. AI prose is labelled inferred and not correctness-verified; citation validation alone does not establish correctness. The backend supplies all clickable source coordinates.

## Limits

- Only public GitHub HTTPS repository URLs. GitHub API quotas apply; an optional server-side token improves rate limits. Same-origin redirects are bounded; credentials are never forwarded to another origin.
- Two concurrent jobs, five minutes per job, and 384 MB worker heap. Up to 200 eligible files, 256 KB per file, and 5 MB selected source. Archive limits: 12 MB compressed / 32 MB decompressed; API responses: 8 MB. Large repositories may be incomplete or rejected.
- Dependency/generated folders, declaration output, minified files, sensitive paths, symlinks, binary content and oversized files are excluded. Repository scripts are never executed and dependencies are never installed. Archives are read in memory, without filesystem extraction.
- Dynamic paths/calls, route chains, arrays, wrappers, unsupported CommonJS export patterns, framework-specific routers and database clients beyond the explicit `pg` rule can remain unresolved. Conditional registration, middleware order, runtime mutation and virtual dispatch are not modeled.
- The first tsconfig's direct compiler options are used; config inheritance/project references are not expanded. Missing dependency types limit symbol resolution. Business purpose, exact response schemas and validation behavior are not invented when unavailable.
- AI commentary covers at most 20 components and requires a configured compatible endpoint/key. The live LLM path is not exercised without credentials.
- No runtime tracing, repository execution, deployment discovery or microservice inference. Repository analysis remains a local public-source tool. Team handoffs have separate account and workspace access controls; job cancellation and a retention UI are not included.

## Smart Context Handoff

Handoffs and **Living Engineering Memory** share one Collaborate workflow. Keep senior Q&A in Handoffs, then optionally approve an accepted answer as a linked decision or failure lesson. Team Knowledge also supports standalone source-linked drafts, exact-revision maintainer approval, immutable history, supersession/withdrawal and source applicability checks. Relevant records appear beside workspace/journey code and before creating a handoff. See [the combined implementation guide](docs/collaboration-and-engineering-memory.md). Existing sessions, shared code and diagrams remain available.

Open **Collaborate → Context Handoffs** to create an account and invite a senior reviewer through **Team access**. In Workspace, select a component or click source line numbers (Shift-click for a range), then choose **Create Handoff Snapshot**. Developers can ask questions and follow up; senior reviewers can answer, annotate code, request clarification and propose solutions. The author confirms an answer, and a maintainer can approve it for searchable Team Knowledge.

Snapshots and conversations persist in SQLite and stay pinned to their original commit. Shared links require team membership. Both teammates must connect to the same backend; a localhost link only works on its own computer. Optional configured AI briefings reuse the existing `LLM_*` configuration; human discussion works without AI credentials.

Practice now includes repository-based tasks, saved coding drafts with syntax feedback, and quick concept quizzes alongside the existing guided sample. Repository tasks use the shared custom model configuration; quizzes use a reviewed question bank. See [Practice setup and implementation](docs/practice-implementation.md) for usage, endpoints, checks, and limitations.

See [the implementation and setup guide](docs/smart-context-handoff.md) for permissions, APIs, migrations, verification and limitations. The original prepared knowledge demo and Agent Context Bridge remain under Settings & Integrations.

## Verify

```powershell
cd backend
npm.cmd test
npm.cmd run verify:public
npm.cmd run verify:http
# Optional Windows Chrome/Edge smoke check (run verify:http first):
npm.cmd run verify:ui
cd ../frontend
npm.cmd test
npm.cmd run build
```

Fixture tests cover route-to-handler mapping, cross-file alias/re-export and tsconfig path-alias resolution, duplicate names, dynamic calls, ES module and CommonJS default-export router mounting, exact source lines and commit links, citation rejection and shared graph/documentation snapshots. Public checks use Heroku's real Express application. HTTP verification starts its own local server on port 3002 and checks worker completion, persisted snapshots, invalid URLs and Markdown attachment export. Optional UI verification uses a hidden local Chrome/Edge session on Windows to check graph rendering, component inspection, source links and documentation/report tabs against that real snapshot. Generated verification evidence and a browser screenshot are saved under `backend/data/`.

Component documentation now generates a detailed configured AI guide when opened. The project documentation tab generates a separate guide for the selected frontend, backend, or full-repository scope. Set `LLM_API_KEY` in `backend/.env`; the existing `LLM_BASE_URL` and `LLM_MODEL` select the OpenAI-compatible endpoint and model. Successful guides are cached in SQLite per snapshot and selection, with source-linked sections, and project guide downloads include the generated content. Missing credentials or provider errors are shown explicitly while recorded source facts remain available. Older snapshots can use the new guides without reanalysis; new analyses additionally retain eligible package manifests to ground setup instructions.
