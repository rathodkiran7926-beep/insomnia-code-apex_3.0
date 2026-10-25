# Codebase Mentor: LLM and processing efficiency audit

Date: 25 October 2026. Scope: current backend generation and analysis paths, frontend request triggers, SQLite reuse, MCP retrieval, and relevant IDE consumers. This is an audit and proposed implementation sequence; application code was not changed. Findings come from local source inspection, read-only database aggregates and query plans, and an in-memory fake-provider experiment. No repository content was sent to an AI provider for this audit. Recommendations are not claims of measured production savings.

The highest-value change is to make saved, versioned repository evidence the shared input to every feature. Today, several features independently assemble evidence, invoke the same model, and keep incompatible or short-lived caches. A longer first pass can help, but durable reuse and correct invalidation must come first. Otherwise a 30-minute indexing job simply adds more generation to the existing workload.

## Evidence collected

The latest completed local analysis has 96 components, including 85 non-module components; 52 relationships; 377 references; and 14 stored source files. Its graph JSON is 299,656 bytes, its reference excerpts contain another representation of 77,692 bytes of source, and its stored source files contain 54,467 characters. Those byte and character measures are deliberately distinguished.

The database contains ten completed analysis jobs pointing to the same snapshot ID. That establishes repeated processing of the same analyzed identity, not ten distinct commits. The current analysis route starts a fresh worker without first resolving and reusing an existing snapshot.

Measured context payloads, excluding system instructions, JSON Schema and output:

| Current feature | Serialized context characters | Coverage |
| --- | ---: | --- |
| Project guide, all | 10,393 | 16 of 96 components |
| Frontend guide | 7,322 | 16 of 53 components |
| Backend guide | 8,670 | 16 of 43 components |
| Component question | 891 minimum; 2,357 median; 17,992 maximum | 85 non-module components checked |
| Guide for the component with the largest question context | 20,815 | One component plus file/neighborhood evidence |

These are payload sizes, not tokenizer counts. Current guide coverage is explicitly sampled. The component-guide sample above is not a measured maximum across all component guides.

An isolated experiment used synthetic source, SQLite `:memory:`, and a fake `fetch` response. It exercised real application functions twice with identical inputs:

| Operation repeated twice | Provider calls observed | Interpretation |
| --- | ---: | --- |
| `listPracticeTasks` | 2 | Three tasks were stored, but the second listing regenerated them |
| `answerQuestion`, asking about inputs | 2 | A deterministic answer was built, but AI still ran both times |
| `generateGuide`, same project scope | 1 | Existing persistent documentation cache works |
| `documentGraph`, same graph | 2 | Initial commentary generation does not reuse the first result itself |

There are no saved practice tasks, discussion messages or journey-question records in this local database. Consequently, their real traffic volume and billing impact cannot be inferred here. The call-count experiment establishes behavior, not user workload frequency or model answer quality.

## Existing mechanisms worth keeping

- [generatedGuides.js](../backend/src/generatedGuides.js): successful guides are persisted by snapshot and component/scope; concurrent identical requests share a promise. This is a useful pattern to extend.
- [handoffRoutes.js](../backend/src/handoffRoutes.js): successful briefings are persisted per handoff; concurrent requests for the same handoff are coalesced. Handoff creation also has request-ID protections. This is already better than regenerating on every read.
- [prWorker.js](../backend/src/prWorker.js): PR comparison explicitly disables AI commentary and derives code/setup differences from static evidence.
- [practice.js](../backend/src/practice.js): learning-journey quizzes come from a review bank; syntax checks use TypeScript. Neither needs a model.
- [agentContextBridge.js](../backend/src/agentContextBridge.js): lexical retrieval, bounded graph traversal, merged source ranges, estimated token ceilings and a small retrieval cache already exist. Retrieval does not require an LLM.
- [setupPlans.js](../backend/src/setupPlans.js): setup guidance is derived from captured files and metadata; legacy metadata discovery is saved for reuse.
- [handoffContext.js](../backend/src/handoffContext.js): handoffs already look up saved component documentation. Reuse exists here, but is not shared by most other AI paths.
- [generatedGuides.ts](../frontend/src/services/generatedGuides.ts) and [useJourneyExplanation.ts](../frontend/src/state/useJourneyExplanation.ts): short delays prevent requests for some transient selections; identical requests are coalesced in the current browser session.

## Highest-priority changes

**1. Return complete factual answers before considering generation.**

In [workspace.js](../backend/src/workspace.js), `answerQuestion` constructs answers about incoming/outgoing connections, inputs, outputs and validation, then calls the model whenever a key exists. Similarly, [journeyService.js](../backend/src/journeyService.js) constructs `sourceQuestionGuidance` before trying AI.

Route precise queries such as “show direct callers,” “list declared parameters,” and “which routes use this handler?” to deterministic responses with citations. Keep AI for interpretation, explanations at a chosen level, ambiguous questions, and proposed changes. Do not just return early for every current regex match: broad words such as “call,” “change” or “safe” can occur in questions requiring reasoning. Use explicit question intents and a completeness test. An unresolved static call remains unknown; zero resolved callers is not proof that none exist.

Expected effect: zero provider calls for supported factual intents, including the first request. Effort: low to medium. Verify with a provider spy and separate tests for ambiguous questions.

**2. Read saved practice tasks before generating new ones.**

In [practice.js](../backend/src/practice.js), `listPracticeTasks` always assembles evidence and invokes `generateJson`. The `inFlight` map only shares work while a request is running. `practice_tasks` is written afterwards, but is not used as a task-list cache. [RepositoryPractice.tsx](../frontend/src/components/RepositoryPractice.tsx) reloads tasks when difficulty, learning context or refresh changes.

Create a persistent generated task-bank artifact keyed by snapshot/evidence identity, difficulty, generation version and relevant curriculum context. Select and order tasks for individual learners using saved attempts; do not regenerate the underlying bank for every learner or minor progress update. Keep “new tasks” as a deliberate operation. Do not drop curriculum context from the key unless personalization has been moved into deterministic selection.

Expected effect: repeated identical listings become zero-call reads. Effort: low to medium. Existing attempt IDs and task references must remain stable.

**3. Reuse repository analyses and PR snapshots by immutable identity.**

[server.js](../backend/src/server.js) starts a worker for every `/api/analyses` request. [worker.js](../backend/src/worker.js) downloads/parses again and runs `documentGraph`. [prWorker.js](../backend/src/prWorker.js) downloads and analyzes both sides of every comparison, even when the same commit may already exist.

Resolve the requested ref to a commit first. Reuse `(repository, commit, analyzerVersion, extractionPolicyVersion)` when complete; coalesce in-flight work for that key. A moving branch name must still be checked for a changed commit. Reuse before/after snapshots across PRs; cache comparisons by immutable base/head identities and comparison version. Live PR title, status and current target-branch metadata need separate freshness checks.

Also separate immutable graph storage from enrichment storage: `saveSnapshot` replaces the documentation row, and PR snapshots deliberately carry AI-disabled documentation. Re-saving an already analyzed commit through that path should not discard useful existing enrichment.

This avoids repeated downloads, compiler work, writes and automatic commentary. The ten same-snapshot completed jobs make this an evidence-backed priority. Effort: medium.

**4. Make initial AI commentary optional and reusable.**

[worker.js](../backend/src/worker.js) calls `documentGraph(graph)` with AI enabled. [documentation.js](../backend/src/documentation.js) generates a batch for the first 20 non-module components. Later, component/project guides and journey explanations can explain overlapping material again.

Finish static analysis first, publish usable source facts immediately, and schedule optional AI enrichment separately. Keep batch commentary only when it feeds a shared artifact store that downstream features read. Otherwise offer it on demand. This also prevents a provider timeout from delaying a source-only scan.

Expected effect: a facts-only analysis performs no AI request; repeated analysis reuses completed enrichment. Effort: low for opt-in commentary, medium for shared reuse.

**5. Persist journey explanations using source validity rather than a one-hour expiry.**

[journeyExplanations.js](../backend/src/journeyExplanations.js) caches at most 200 explanations in memory; successful results expire after one hour, fallbacks after 20 seconds. The browser mirrors those lifetimes. A restart or expiry can regenerate commentary for unchanged source.

Store successful source explanations durably by evidence hash, explanation version, level and relevant path context. Preserve previous/next context in the key when prose depends on it. Separate reusable static explanation from observed runtime values. The current observed-replay trace ID prevents unsafe mixing; retain that protection for runtime-dependent content.

Persist fixed starter questions where appropriate. Custom journey questions currently call `answerEventQuestion` directly and are saved as history rather than read as a response cache. Repeated identical, appropriately scoped questions can reuse validated answers.

Expected effect: unchanged explanations survive restarts and repeated visits. Effort: medium.

**6. Add backend caches for impact explanations and repeated proposed-code analysis.**

[impactPreviewRoutes.js](../backend/src/impactPreviewRoutes.js) recomputes graph impact and generates prose without a persistent response cache. [impactPreview.ts](../frontend/src/services/impactPreview.ts) caches explanations only in a browser-memory map; proposed-code analyses have no analogous cache.

The dependency path is already a deterministic fact. Render it directly by default; make interpretive prose optional or cached. For AI explanations, key by snapshot, target, affected component, scenario, evidence-path hash and generation version. For proposed-code analysis, include the exact proposed-code hash and selected original span. If the submitted code is identical to the snapshot span, return a no-change result without a model call. Do not normalize away whitespace inside strings or otherwise change program meaning to improve cache hits.

Expected effect: cross-tab/restart reuse and elimination of identical comparison requests. Effort: medium.

**7. Stop generation from being an automatic side effect of ordinary browsing.**

[RepositoryDocumentation.tsx](../frontend/src/components/RepositoryDocumentation.tsx) activates generation when a nonempty scope is shown. Each uncached frontend/backend/all selection can start another guide. [CodeJourneyTheater.tsx](../frontend/src/pages/CodeJourneyTheater.tsx) starts with the question panel open; [JourneyQuestion.tsx](../frontend/src/components/JourneyQuestion.tsx) requests the current explanation when open. Debounce prevents some rapid changes but not every normal step visit.

Show saved facts and any existing generated artifact immediately. Use a visible “Generate detailed explanation” action, or a user-selected automatic-enrichment mode backed by a budget. A cache-read endpoint should not create a missing artifact. Component documentation in the main workspace already passes `defaultOpen={false}`; keep that useful restraint rather than treating every component selection as a model trigger.

Expected effect: fewer unwanted first-time calls. Effort: low to medium; this changes product behavior and should be deliberate.

**8. Introduce a shared generation gateway with actual usage accounting.**

Generation request construction is duplicated across documentation, guides, questions, discussions, practice, handoffs, journey mentoring, impact analysis and contribution planning. They share a model configuration but use separate concurrency counters, response formats, timeouts, retries and validation paths.

Centralize: request identity, cache lookup, pending-work coalescing, priority queue, per-feature input/output budgets, provider capability checks, validation, bounded retries, cancellation and metrics. Interactive chat should have priority over background enrichment. Separate feature limits currently allow several features to saturate the same local model simultaneously; a shared scheduler addresses that.

Record feature, evidence hash, cache hit/miss, estimated and provider-reported input/output tokens, elapsed time, model, queue wait, retry count, finish reason and validation outcome. Do not log keys, raw private conversations or full source prompts. Current `limit` arguments bound response bytes; they are not model generation-token limits. Token usage is generally discarded with the response wrapper, so current bill reduction cannot be quantified honestly.

Effort: medium; this is the foundation for verifying subsequent savings.

## Additional token and generation improvements

**9. Deduplicate evidence by source range, not just reference ID.** [discussion.js](../backend/src/discussion.js) can send selected source, containing-file context, connected components and up to 28 reference excerpts together. These can overlap. [documentation.js](../backend/src/documentation.js) attaches related edges to each component in its batch, duplicating shared edges. [journeyService.js](../backend/src/journeyService.js) can send the selected source both directly and in linked walkthrough evidence. Build one bounded source-chunk table with local citation aliases and reference it from facts. Preserve a server-side mapping to real snapshot citations. Effort: medium.

**10. Use a shared token budget, not independent character slices.** Several features independently permit 16,000 characters of selected source, thousands more of neighboring code, and a large history. Individually bounded fields can still exceed a small model's context. Reserve input space for system instructions, schema, question and output before selecting evidence. Prefer model-specific token counting when available, with an explicit conservative estimate otherwise. Never describe a character or byte estimate as an exact vendor token count. Effort: medium.

**11. Send the selected implementation, not always the beginning of a file.** Practice currently sends `source.slice(0, 3000)` for each candidate, even if its declaration occurs later. Multiple candidates from one file repeat the same prefix. Component guides take the first 18,000 characters of the containing file. Use recorded offsets/line ranges plus a small relevant neighborhood, then expand only for necessary imports/registrations. This improves answer relevance as well as token use. Effort: low to medium.

**12. Compact discussion history.** `discussionTurn` sends rolling memory, fresh source context and the last 12 messages. Assistant history serializes the entire saved answer, including display/spoken prose, claims, alternatives and citation metadata. `draftDecision` also serializes stored history rows whose `data` fields contain JSON strings. Send concise textual turns plus citation IDs; omit display-only objects, repeated URLs and duplicate spoken/display text. Track a summary cursor so the rolling summary covers older turns and a short recent window preserves new details without repeating the same history. Effort: medium.

**13. Reuse approved project knowledge and generated explanations across features.** Component questions, discussions, journey explanations and guides mostly rebuild independent contexts. Reuse a canonical component fact pack, any saved summary and relevant approved engineering-memory records, while retrieving actual source for new or detailed reasoning. Human decisions must retain status, evidence version and access scope; generated prose is an interpretation, not newly established source fact. [handoffContext.js](../backend/src/handoffContext.js) already demonstrates limited saved-guide reuse. Effort: medium to high.

**14. Generate component knowledge once, render multiple views.** Instead of separate 5–8-section explanations for every feature, save a compact structured record: purpose, declared inputs/outputs, source conditions, side effects, dependencies, tests, unknowns and citations. Build project views from module records; build walkthrough introductions from component records; use deterministic formatting for lists and source links. Generate a different reading-level explanation only when needed. Keep source provenance separate from narrative. Effort: high, with broad benefits.

**15. Avoid generating unnecessary output fields.** Brief journey explanations request `answer`, three sentences and walkthrough steps even where a particular UI view may only need part of that response. Discussion replies request both spoken and display text. Inspect the consuming view, then define compact versus detailed response contracts; derive a short speech preview from saved text where suitable. Generating content and truncating it afterwards saves no model work. Effort: low to medium.

**16. Reduce invalid-output retries without weakening validation.** Guides now use schema-constrained output, but most other paths use JSON-object mode plus a prose schema and post-validation. Discussions can regenerate once after validation failure; each `reason` call can also retry a temporary server failure, allowing up to four provider attempts in that combined case. Apply schemas where the actual endpoint supports them, make response requirements match the UI, and record failure categories. Keep a bounded repair strategy; never silently accept fabricated citations to save tokens. Effort: medium.

**17. Make retries and outages budget-aware.** Guide retries currently sleep 800 ms for selected status codes, including 429. Share cooldown/circuit-breaker state for a failing provider, honor available retry guidance, and suppress repeated automatic attempts during a known outage. Cache a failure/cooldown state separately from successful documentation; do not store fallback output as a successful AI artifact. Prevent frontend “retry” loops from multiplying full generation attempts. Effort: medium.

**18. Carry cancellation through uncached interactive work.** Discussion routes already propagate disconnect cancellation. Ordinary component-question, guide and several other generation routes do not. The generated-guide hook stops state updates on unmount, but an already-started request continues. Allow cancellation when a result is no longer useful. For shared work, cancel only after all interested subscribers leave; for intentional background artifacts, finish and persist rather than wasting partial work. Effort: medium.

**19. Cache contribution recommendations and plans separately from live GitHub data.** [contributions.js](../backend/src/contributions.js) performs 12 GitHub reads per opportunity scan, ranks issues deterministically, then optionally generates improved recommendation text. Repeated plans refetch issue/comment/guidance data and ask AI again. Cache repository health signals with a short freshness window; keep user preferences out of shared source data; cache generated ranking prose by issue-content/version, snapshot and normalized preferences. Invalidate plans when the issue, relevant comments or code evidence change. Keep lightweight deterministic ranking available immediately. Effort: medium.

**20. Cache synthesized speech.** [discussionVoice.js](../backend/src/discussionVoice.js) caches the voice list but not speech audio durably. [ComponentDiscussion.tsx](../frontend/src/components/ComponentDiscussion.tsx) retains only one blob for manual playback; the automatic streaming path is separate. Cache completed audio by authorized text hash, voice, synthesis model/settings and format. Replay should reuse it; automatic speaking can be a preference. Do not precompute every voice or transcript. Effort: medium. This reduces speech-provider work rather than text-model tokens.

**21. Give every artifact a real validity key.** Current guide keys use a static `v1` prefix plus component/scope and snapshot. They do not identify model, prompt, schema, language or evidence-selection version. The analyzer's snapshot ID hashes repository plus commit, not analyzer version. Component IDs are sequence-based (`c0`, `c1`, ...), so inserting earlier declarations can change IDs across commits. Use versioned analyzer identities, stable source-symbol matching and explicit dependency hashes. Reuse across commits only after matching source and relevant dependency/configuration evidence, then rebind and validate citations for the new snapshot. A TTL alone is inadequate. Do not invalidate otherwise useful artifacts just because the configured model changed unless the product requires regeneration. Effort: medium to high.

**22. Use a bounded persistent cache rather than browser-session-only maps.** Successful guide promises remain in a module-level frontend map without an eviction policy; impact explanation maps also lack a capacity bound. They save calls during that session but are not durable shared knowledge. Bound browser memory, make backend artifacts authoritative, and separate immutable cache reads from generation requests. Preserve access controls for user/workspace-specific artifacts. Effort: low to medium.

## Processing, storage and retrieval improvements

**23. Precompute component facts during the existing AST pass.** [repositoryJourneys.js](../backend/src/repositoryJourneys.js) reparses component snippets with TypeScript to extract parameters, conditions and return expressions. Its derived-journey cache holds only four entries. Extract reusable facts once during analysis and persist them under a fact-schema version. Reuse them for journeys, mentoring, setup and practice selection. Distinguish nested-function statements from those belonging to the selected declaration. Effort: medium.

**24. Share indexed graph access.** `questionContext`, discussion context, presentation code and impact helpers repeatedly scan arrays with `find`/`filter`, sometimes nested. `workspaceGraph` reloads/deserializes the whole graph for requests. Cache bounded immutable graph indexes per snapshot: component/reference by ID, incoming/outgoing edges, components by file, and source line offsets. The MCP adapter already demonstrates a row-oriented alternative. The measured graph is only about 300 KB, so prioritize correctness and profile before a major storage rewrite. Effort: low to medium.

**25. Improve SQLite indexes for actual lookup patterns.** The current `(snapshot_id,id)` primary-key indexes already scope queries efficiently by snapshot. `EXPLAIN QUERY PLAN` confirmed their use. However, edge endpoints live in JSON and source/name searches use JSON expressions or `LIKE` over serialized rows. At larger scale, add endpoint/file/name columns or exact expression indexes matching the queries; use FTS5 for lexical source/symbol search. Do not claim this database currently performs an unindexed full-table scan for every request. Benchmark with larger snapshots first. Effort: medium.

**26. Reuse incremental file artifacts before attempting incremental whole-program analysis.** Store source blobs and parsed/fact artifacts by content hash, and map snapshots to blobs. On a new commit, identify changed files and affected imports/configuration; reuse unchanged extraction results where valid. Type resolution changes can affect importers and cycles even when their own file bytes do not change. Begin with safe file/source reuse and commit-level snapshot reuse, then implement dependency-aware compiler invalidation. Effort: high for robust semantic incrementality.

**27. Remove repeated source and presentation work.** Graph JSON, per-reference rows and full source files currently duplicate some source content. Store canonical source once and represent references by offsets, loading bounded excerpts when needed. Keep denormalized excerpts only where they demonstrably improve latency or support legacy data. [componentPresentation.js](../backend/src/componentPresentation.js) rebuilds labels for legacy anonymous functions on demand; migrate or cache those labels by analyzer/snapshot version instead. Retain immutable handoff source copies where needed for historical evidence rather than deleting them as apparent duplicates. Effort: medium.

**28. Make MCP results compact at the wire boundary.** [agentContextBridge.js](../backend/src/agentContextBridge.js) returns both structured evidence and a `promptSlice` containing much of it again; [mcp/src/server.js](../mcp/src/server.js) serializes the value as text and also attaches `structuredContent`. Whether both envelope representations reach a model depends on the host, so measure actual tool-message tokens rather than assuming a fixed duplication factor. Offer an output mode with one compact model-facing representation and expandable evidence. Budget the representation actually sent. Preserve identity, freshness and evidence IDs; avoid removing source evidence just to retain redundant formatting.

**29. Coalesce MCP snapshot resolution and retain honest freshness.** [mcp/src/backendClient.js](../mcp/src/backendClient.js) caches latest-snapshot resolution for 30 seconds, but the cache is filled after resolution/initial analysis completes. Concurrent cold requests can independently begin resolution/analysis. Use a pending-resolution promise plus the backend's immutable-analysis deduplication. Looking up the latest saved snapshot is not a check against the current remote branch or local working tree; refresh must be explicit and accurately reported. Effort: low to medium.

**30. Cache immutable reads and poll less.** Global API `no-store` prevents HTTP caching even for commit-pinned source/snapshot responses. Introduce endpoint-specific validators or private caching where the access model permits; keep chat, membership-sensitive data and live job status separate. Analysis and PR status poll about once per second; use backoff, stop when hidden/completed, or stream progress. This mostly saves HTTP/DB/CPU work, not LLM tokens. Effort: low to medium.

**31. Stream archives and avoid unnecessary full downloads.** [github.js](../backend/src/github.js) buffers the compressed archive and synchronously inflates it before tar extraction. It already runs in a worker and enforces limits, so this is primarily a memory/scaling opportunity. Prefer streamed decompression with equivalent decompressed-byte limits. Resolve/reuse an existing commit before downloading any archive; later reuse source blobs for changed-file processing. Conditional GitHub requests and short metadata caches reduce repeated API load. Effort: medium.

A longer job does not automatically expand analysis coverage: ingestion currently caps selected files at 200, individual files at 256,000 bytes and selected source at 5 MiB; source analysis is primarily JavaScript/TypeScript. Deep processing should use explicit staged coverage and report exclusions, rather than silently dropping these limits or implying that more wall-clock time means the entire repository was understood. Practice also excludes files over 20,000 characters, even if their individual functions are short; selecting bounded declarations would improve that coverage.

**32. Add durable enrichment jobs, idempotency and retention.** Process-local pending maps disappear on restart and do not coordinate multiple server processes. Use a small SQLite-backed job/artifact state machine with unique work keys, leases, retries and resumable stages. Separate interactive and background budgets. Add retention/size limits for old source snapshots, failed jobs, generated artifacts and audio while preserving snapshots referenced by handoffs, approved knowledge or learning records. Backups and artifact validity must be considered before cleanup. Effort: medium to high.

## A useful first-processing pass of up to 30 minutes

Treat 30 minutes as a maximum enrichment budget, not a mandatory wait or model training. The current repository is small enough that deterministic indexing should not require a 30-minute delay. Availability should be progressive: facts first, then optional summaries. Existing analysis workers terminate after five minutes, so a long enrichment pass needs a separate resumable job rather than simply extending the current worker timeout.

An illustrative schedule, to be calibrated on the actual endpoint:

| Budget window | Work | Later reuse |
| --- | --- | --- |
| 0–3 min | Resolve immutable commit, reuse/download files, parse and store source facts | Source browser, diagrams, routes, signatures and dependency answers |
| 3–8 min | Build source-range index, symbol search, adjacency indexes, module ownership and test/config mappings | Fast retrieval, setup, impact traversal and practice selection |
| 8–18 min | Generate a bounded set of important module/component summaries, ranked by entry-point role, dependency centrality and expected use | Documentation, common questions, handoff context and journey introductions |
| 18–25 min | Compose project/frontend/backend views from saved facts and summaries; warm a small set of common interpretations | Immediate overview pages and popular explanations |
| 25–30 min | Optionally generate a small practice bank and warm only frequently used journey/level combinations; validate and checkpoint | Repeated learning sessions without regeneration |

These are allocations, not measured task durations or a commitment to fill every slot. Stop when the selected work is complete, the token/call/wall-clock budget is exhausted, or interactive use needs the model. For the local endpoint, begin with one background generation at a time; tune concurrency after measurement.

Do not pre-generate every component at every level, every question, every impact path or every voice. There are 85 non-module components in the local sample; three levels already imply 255 component-level combinations before path/scenario variants. For scale illustration only, 85 calls at an assumed 45 seconds each would take about 64 minutes serially. That is not a measured component-call duration. A targeted warmup is more useful than indiscriminate generation.

Preprocessing cannot establish unknown future code proposals, new user requirements, live GitHub issue updates or observed runtime values. Those need fresh evidence and sometimes new generation. It can eliminate re-analysis of the same source and repeated explanations of stable concepts.

Recommended persisted artifacts:

```text
source_blobs(content_hash, content)
snapshot_files(snapshot_id, path, content_hash)
component_facts(snapshot_id, stable_symbol_key, fact_version, data)
derived_artifacts(kind, input_hash, generation_version, scope, data, provenance)
artifact_dependencies(artifact_id, evidence_hash)
generation_jobs(work_key, stage, status, lease, attempts, progress)
generation_usage(feature, artifact_id, input_tokens, output_tokens, latency, outcome)
```

This is a proposed logical schema, not a migration ready to apply. Appropriate identity dimensions include analyzer/prompt/schema version, source/dependency hashes, response detail/level/language, and authorization scope for private data. Store model provenance, but choose whether a model change invalidates a usable artifact deliberately. Avoid serializing credentials into cache keys or telemetry.

The serving path should be: authorize and identify snapshot → determine intent → answer from facts if complete → read a valid artifact → retrieve the smallest missing evidence → generate only if necessary → validate and persist. Reuse an existing summary as context, not as permission to skip source validation for a new claim.

## Implementation order and how to measure it

1. Add usage/call counters and the common request gateway; establish a representative replay workload using fake and live provider modes separately.
2. Add factual early returns, persistent practice-bank reads and immutable analysis deduplication. These have the clearest direct evidence.
3. Persist journey/impact/custom-answer artifacts with correct identities and deduplicate overlapping source ranges.
4. Reduce discussion history, apply provider-supported output constraints, add global scheduling/cooldowns and explicit generation controls.
5. Add source/fact indexing and targeted warmup. Only then implement cross-commit artifact reuse and deeper incremental analysis.

Track: calls and input/output tokens per user action; warm/cold latency; cache hit rate; duplicate concurrent work; invalid-output and retry rates; unsupported factual-query rate; evidence coverage; and stale/cross-snapshot citation failures. Use identical workloads for before/after comparisons. A successful optimization must preserve answer usefulness and provenance, not only make the prompt smaller.

For a repeated stable artifact requested 100 times, one generation plus 99 cache hits is 99% fewer generation calls for that artifact. That arithmetic is not a forecast of 99% lower application-wide spend. Precomputing an artifact nobody reads increases cost. The break-even question is whether expected avoided future generations exceed the initial enrichment and maintenance cost.

Defer large-model training, a new vector database, distributed caches and blanket repository-wide generation until measurements justify them. Existing SQLite, deterministic analysis and persistent artifacts can address the concrete gaps first. Add embeddings only if a lexical/graph retrieval evaluation shows missing semantic matches; store them by content hash and update only changed chunks.

## External references checked

- [SQLite FTS5](https://www.sqlite.org/fts5.html) documents full-text retrieval and ranking; [expression indexes](https://www.sqlite.org/expridx.html) document exact-expression matching requirements. These support the retrieval/index options above, not a claim that they have been benchmarked in this application.
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) and [structured outputs](https://docs.ollama.com/capabilities/structured-outputs) describe supported generation controls and schemas. The ngrok endpoint's underlying server configuration was not inspected; verify capabilities rather than assuming every compatible endpoint supports the same options.
- [Ollama FAQ](https://docs.ollama.com/faq) documents context-window and model-residency configuration. If this endpoint is backed by Ollama, tune model residency and context against available hardware after fixing application reuse. Keeping a model loaded saves cold-start latency; it does not give a stateless request durable repository memory.
- [GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) recommend conditional requests and efficient polling. Live issue freshness should be handled separately from immutable code artifacts.

Limits: this audit did not inspect provider-side GPU utilization, actual provider token logs, production traffic, every frontend render cost or every possible repository language/framework. It identifies concrete reuse defects and additional engineering opportunities in the inspected paths; the priority order should be refined with usage telemetry.
