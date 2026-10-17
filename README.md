# Codebase Mentor

The existing React/Vite app now has a Node.js/Express backend for public repository analysis. Open **Repository** in the sidebar (`/#/repository`) to analyze a repository and inspect its real graph and documentation. Other existing workspace screens continue to use their labelled demo data.

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
- No runtime tracing, repository execution, deployment discovery or microservice inference. No authentication, job cancellation, retention UI, or cross-user access control is included; the service runs locally.

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
