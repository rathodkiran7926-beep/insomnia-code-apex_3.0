# Codebase Mentor — Living Code Journeys
## Final product concept and AI-agent implementation specification

**Hackathon:** CODE APEX 3.0 — iMocha Track  
**Problem statement:** Codebase Mentor: AI Onboarding for Developers  
**Prepared:** 11 October 2026  
**Revision:** 3 — maintainer knowledge capture, autonomous agent roles, repository adapters, learner adaptation, and defined deterministic tool contracts.  
**Status:** Proposed product and implementation plan. No feature or evaluation result is claimed as completed.  
**Inputs consolidated:** Codebase_Mentor_10_Features.md, Setup_Drift_Guard_Simple.md, the supplied problem statement, and the proposed architecture-as-code visualization.

> **Pitch:** Understand a repository by following a real feature through its code, prove your understanding with a small contribution, and see exactly what you need to relearn when the code changes.

> **Instruction to the implementing AI agent:** Treat this document as the product specification. Build the staged scope below. Preserve code grounding, version identity, and honest evidence labels throughout. Keep architecture, lessons, practice, and change analysis connected through the same evidence model.

---

## 1. Problem, users, and product goal

A newcomer can read a function and still have no idea where it fits into the application. Documentation may describe an old version. Setup instructions may fail. The reasons behind decisions may exist only in old PR discussions or a senior engineer’s memory.

The product must answer five practical questions:

1. **Where am I?** What are the major components and where does this feature live?
2. **What happens next?** How does a request move through functions, decisions, storage, and external boundaries?
3. **How do we know?** Which source code, tests, traces, or documented decisions support the explanation?
4. **What can I contribute?** Which small task can I attempt, and how will I check it?
5. **What changed?** Does a new PR invalidate my setup or what I previously learned?

Primary users are interns, new developers, open-source contributors, and engineers joining an unfamiliar team. Maintainers benefit from reusable explanations and fewer repetitive onboarding questions.

**First supported use case:** A beginner exploring one real public TypeScript/Express repository with manageable scope, clear entry points, tests, and reproducible setup. The exact repository must be selected and verified before implementation; no particular repository has already been inspected for this specification.

**Product goal:** Help a newcomer explain a real feature, locate the deciding code, make a small contribution, and keep that understanding current.

## 2. How the original idea is improved

The original ten-feature plan covers the expected solution well. Its weakness is that separate features can look like a standard repository chatbot plus a dashboard. The improvement is to make every feature operate on the same code journey.

### Core experience

A learner asks, “What happens when a user signs up?”

The mentor opens an architecture view, focuses the relevant components, and starts a source-linked walkthrough. The learner follows validation and function calls, inspects the duplicate-email branch, predicts whether the database insert happens, and attempts a small validation task.

A prepared change later adds email verification. The same journey shows the changed functions, a new integration boundary, the tests actually run, the setup changes, and a short lesson for this learner.

**The distinctive connection is:**

**Source evidence → visual journey → prediction → contribution → PR change → targeted relearning.**

Interactive architecture diagrams, repository Q&A, and PR analysis already exist. Do not claim these components are individually new or that this project is the first of its kind. The proposed differentiation is their integration into an evidence-backed learning workflow. Demonstrate its value rather than assuming uniqueness.

### Three memorable demonstration moments

| Moment | What appears on screen | Value |
| --- | --- | --- |
| Follow the request | A guided path highlights real functions and opens their source as the learner steps forward. | Shows how separate files work together. |
| Explain the branch | The learner predicts a failure path, then sees the deciding condition and a matching test or available trace. | Checks understanding of behavior. |
| Relearn the change | A PR alters the journey; the mentor shows changed steps, setup delta, and a focused lesson. | Keeps onboarding knowledge current. |

**Priority decision:** Interactive Code Journeys are the primary flagship. The existing PR Impact Simulator, proposed by Kiran in the original plan, becomes the change-focused extension of the same experience. Setup Drift Guard supports that extension.

---

## 3. Architecture as code: research and interpretation

### What was checked

“Architecture as code skill of Claude” does not uniquely identify one tool. Two relevant community projects were found:

- **gauravs19/enterprise-architecture-skill:** A community Claude Code skill covering C4/Structurizr, ArchiMate, TOGAF, and architecture documentation/decision records, with traceable architecture artifacts.
- **jorexe/arch-diagram-skill:** A community Claude Code skill whose README describes generating a standalone interactive architecture HTML diagram with pan/zoom and service connections.

These are community projects, not identified here as official Anthropic features. They were reviewed as inspiration and were not installed or executed while preparing this specification.

### Application to this product

Use **a versioned structured architecture model** to drive the visual interface. It contains component identities, symbol references, typed relationships, evidence, and repository version. The diagram is one view of the model.

Use a C4-inspired overview for major components and a separate feature-level view for functions and decisions. C4 dynamic diagrams provide a useful precedent for feature interactions. A high-level architecture diagram alone does not establish exact function-call behavior.

**The intended experience includes:** source inspection, guided steps, branch exploration, predictions, and before/after comparison.

### Critical distinction

**Architecture as code is a representation strategy. Interactive playback is a UI capability. Runtime observation requires execution and instrumentation.**

Generating Mermaid, Structurizr DSL, or HTML does not automatically produce a correct call graph or execution trace.

Recommended implementation:

1. Extract code facts with a parser and TypeScript symbol resolution.
2. Build a typed graph with evidence.
3. Let the model summarize and propose reviewed component groupings.
4. Render the graph using React Flow.
5. Build walkthrough steps from supported, reviewed paths.
6. Overlay optional test observations or mapped trace events.

The running product need not depend on Claude Code being installed. The team may use Claude Code or other AI tools during development and disclose that usage. Reusing a community skill or template requires attribution and license review.

---

## 4. Final feature set

The ten original feature areas are retained and improved. Setup Drift Guard is included as feature 11. Features share one repository snapshot, graph, and evidence model.

| # | Final feature | Improvement | Hackathon scope |
| --- | --- | --- | --- |
| 1 | Evidence-backed Q&A and “Show me” navigation | Answers focus supporting nodes and steps, with claim-level evidence. | Required foundation |
| 2 | Interactive Architecture Atlas | Zoom from components to functions, inspect edges, open source. | Required overview; deepen for finale |
| 3 | Guided Code Journey Player | Step through calls and branches with synchronized source and optional trace replay. | Primary finale flagship |
| 4 | Goal-based Onboarding Route | Select lessons from a contribution goal and explicit prerequisites. | Small rule-based version |
| 5 | Predict, Explain, Verify | Predict branches and cite deciding code, with reviewed feedback. | Three to five checks |
| 6 | First-contribution Practice Workspace | Evidence-based task brief, progressive hints, tests, explanation checks. | One prepared exercise |
| 7 | Design-decision Memory and Maintainer Workflow | Capture undocumented rationale through human-approved, source-linked records. | One inbox/approval example |
| 8 | PR Impact Simulator and Journey Diff | Compare changed journeys; separate possible impact from observed outcomes. | One prepared comparison |
| 9 | Learning Drift Updates | Find stale completed lessons and create focused relearning cards. | One update event |
| 10 | Understanding and Peer Evaluation | Measure code-location accuracy, explanation quality, and task completion. | Progress view and real peer study |
| 11 | Setup Drift Guard | Compare setup across versions and verify selected steps when executable. | Static delta first; bounded execution extension |

### 4.1 Evidence-backed Q&A and “Show me” navigation

**Example:** “Where is authentication checked, and what happens if the token is missing?”

Return a concise explanation with citations beside individual factual claims. Offer **Open source**, **Show on map**, and **Start this journey** when supported.

**Behavior:**

- Retrieve code for one explicitly selected commit.
- Combine text/symbol search with graph neighbors; embeddings are optional.
- Distinguish source behavior, test expectations, and executed observations.
- Resolve each cited file and inclusive line range against the same immutable version.
- Do not answer historical “why” questions as fact without historical evidence.
- Answer supported portions and state evidence gaps.
- After a change, offer an updated answer without silently moving the old citation.

**Differentiator:** The answer becomes a navigable entry into the visual journey.

**Acceptance:** Representative reviewed answers have resolving links and citations that support their associated claims. A valid line number alone does not establish correctness.

### 4.2 Interactive Architecture Atlas

Provide three connected views:

| View | Purpose | Elements |
| --- | --- | --- |
| System overview | Orient the newcomer. | Application, data store, external integration, user/client. |
| Component view | Explain responsibilities. | Router, middleware group, service, repository module. |
| Feature detail | Follow selected behavior. | Entry handler, functions, branch conditions, storage/integration calls. |

Derive grouping from the repository; label AI-proposed grouping as interpretation. Do not force every application into the same layers.

**Interactions:**

- Click a node for responsibility, source, supported callers/callees, and relevant journeys.
- Click an edge for its type, evidence, and limitations.
- Expand/collapse components.
- Search a route, feature, or symbol.
- Focus the selected journey and hide irrelevant components.
- Show external boundaries and unresolved relationships.
- Keep commit and analysis status visible.

**Relationship types:** Imports, resolved calls, possible calls, route registration, data access, documented dependency, and observed relationships remain distinguishable.

**Critical rule:** An import is not a function call. A code dependency is not proof that a selected feature executes it.

**Differentiator:** Switching views preserves the selected feature and source context, connecting module responsibility to concrete behavior.

**Acceptance:** Every analytical node maps to source/configuration or a clearly labelled conceptual/external entity. Every analytical edge has evidence or a visible inferred/unresolved label.

### 4.3 Guided Code Journey Player — primary flagship

**Simple explanation:** Follow a feature like an interactive lesson through the actual repository.

#### Controls and interactions

- Start, pause, next, previous, restart.
- Select reviewed scenarios such as success or invalid input.
- Open the current call site and target function.
- Switch between beginner explanation and technical detail.
- Pause at a decision and predict the next step.
- Inspect external boundaries and unresolved calls.

The active node, lesson step, source snippet, and evidence panel update together. An input/state panel shows only reviewed synthetic values or values actually captured by instrumentation.

A moving marker may illustrate a selected path; its evidence badge remains visible.

Each step explains: what entered this component, the responsibility of the current function, relevant conditions, side effects, and the supported next step. Distinguish source-derived contracts from actual captured values. Do not fabricate intermediate state.

Persist the graph and journeys as diffable JSON artifacts. Optional Markdown/Mermaid export is a static sharing view of the same model; it must retain source/version references.

#### Two modes

| Mode | Meaning | Limit |
| --- | --- | --- |
| Explained path | Source-supported, reviewed walkthrough of a possible scenario. | Does not imply executed input or observed runtime values. |
| Recorded scenario | Replay of events from a particular executed input/test at a particular commit. | Does not imply complete instrumentation or universal behavior. |

A passing test may verify an outcome. Without instrumentation, it does not establish the entire intermediate call sequence.

#### Illustrative lesson

1. Select the signup entry point.
2. Inspect validation.
3. Follow the supported call into the user service.
4. Pause at the existing-email condition.
5. Ask: “Does this request reach the insert? Which condition decides?”
6. Show source explanation and a related test, if available.
7. Continue the explained branch or replay recorded events.

Use actual names and behavior from the chosen repository. Include at least one failure path.

#### Analysis boundaries

- Support a documented subset of TypeScript/Express patterns.
- Dynamic dispatch, callbacks, dependency injection, and runtime configuration may remain unresolved.
- A direct-call extractor does not automatically compute complete control flow.
- For the finale, compose two reviewed journeys from extracted evidence.
- Preserve async semantics; background work is not a synchronous call.
- Recorded events require timestamps/relationships and mapping to source or symbols.
- Show missing instrumentation as a gap.
- Optional input changes run only prepared scenarios, or update labelled explanations. They must not produce invented execution.

**Differentiator:** A newcomer can inspect, predict, and explain each important step rather than simply watch arrows move.

**Acceptance:** Two real-code journeys, a branch question, working source navigation, and correct evidence labels. Trace replay is optional; the guided player works without it.

### 4.4 Goal-based Onboarding Route

Inputs: existing skills, role, and concrete goal.

**Example goal:** Add validation to an endpoint.  
**Prerequisites:** Routing, validation, service behavior, relevant test pattern.  
**Route:** Architecture context → endpoint journey → prediction check → exercise.

Each lesson explains why it matters to the goal and uses repository examples. Learners skip familiar material. Incorrect explanations trigger a relevant mini-lesson.

**Differentiator:** Select lessons from the task’s dependencies and demonstrated understanding, then adjust depth and pace using explicit preferences and observable learning evidence.

**Hackathon scope:** Two initial profiles, persistent concept-level state, and explicit adaptation rules. Learner preferences and observed check results refine the route and pace; see Section 18.

**Acceptance:** Changing the goal/profile meaningfully changes the route, with an explanation.

### 4.5 Predict, Explain, Verify

Create reviewed checks at meaningful branch points:

- “Does invalid input reach the database?”
- “Which function creates this response?”
- “What happens if this lookup finds an existing record?”
- “After this change, what condition is required before login?”

Ask for prediction and supporting evidence. Feedback identifies the deciding code and explains mistakes.

**Rules:**

- Reviewed answer keys or deterministic assertions define correctness.
- AI may phrase feedback but is not the sole correctness judge.
- Allow equivalent correct explanations/source references.
- Record first attempt separately from retries.
- Include a transfer question without immediate hints.

**Differentiator:** Checks the learner’s mental model of this repository.

**Acceptance:** Three to five reviewed checks, including a branch check and post-change check.

### 4.6 First-contribution Practice Workspace

Recommend a small change linked to the learner’s journey.

A task brief contains:

- Origin: public issue, curated exercise, or generated practice task.
- Current/desired behavior.
- Relevant symbols, prerequisites, and journey.
- Acceptance criteria.
- Test commands and known limits.

**Progressive hints:** Clarify requirement → point to component → reveal relevant condition → offer an example if requested.

Use a disposable workspace and baseline results. Completion checks verify behavior, not file existence. Ask the learner why the change belongs in the selected layer and how the test demonstrates it.

**Differentiator:** Finish with a short contribution explanation: behavior changed, evidence, and test result.

**Hackathon scope:** Two or three candidate starter-task cards with origin, prerequisites, and acceptance criteria; fully verify one prepared exercise. A browser IDE is optional; a local workspace or patch workflow is sufficient.

**Acceptance:** Baseline checks pass; unmodified code fails the new requirement; intended solution passes. Label practice exercises honestly rather than suggesting maintainer approval.

### 4.7 Design-decision Memory and Maintainer Explanation Workflow

Retrieve existing public ADRs, PR descriptions, discussions, and commit history. When rationale is missing, create a focused question for a maintainer instead of guessing.

A decision card includes the question, current observed implementation, historical rationale where recorded, discussed alternatives, source provenance, related symbols, and relevance to the selected version.

#### Maintainer workflow

1. **Detect a knowledge gap:** A learner asks why a design exists, or a reviewed journey reveals an undocumented decision.
2. **Search before asking:** Check known ADRs/discussions and existing maintainer records; merge duplicate questions.
3. **Prepare a question card:** Include the exact symbols/commit, observed behavior, what is unknown, and a short specific question.
4. **Place it in an in-product review inbox:** The maintainer decides whether and when to respond. External emails/messages/issues are not sent automatically.
5. **Capture explanation:** The maintainer records rationale, alternatives, constraints, pitfalls, and whether the explanation describes historical intent or present guidance.
6. **Prepare a draft:** The Knowledge Agent structures the response and proposes links; the maintainer checks it before approval.
7. **Approve and publish:** Save a versioned decision record with provenance and attach it to relevant journey steps, answers, and task briefs.
8. **Watch related changes:** Mark the record for review if its source anchors or assumptions change. Preserve the previous record and allow superseding it.

**States:** Open → Draft → Awaiting review → Approved. Approved records may become Needs review, Superseded, or Withdrawn. Declining a question closes it without inventing an answer.

**Provenance matters:** A maintainer’s account is evidence of their explanation, not automatic proof of what the original author intended. Record whether the author participated in the original decision or is describing current interpretation/guidance. A code citation supports implementation; the approved explanation supports stated intent. Do not describe human rationale as derivable from source alone.

**Unanswered questions:** Show “Reason not documented; maintainer clarification requested.” Continue teaching supported behavior while the question remains open.

**Demo:** Include one genuine explanation supplied with consent by a team member or collaborator who owns the demo change. Label it as rationale for the team’s change, not upstream historical intent. Existing upstream ADRs can supply a separate historical example.

**Differentiator:** Turn onboarding questions into durable, source-linked team knowledge and review that knowledge as the code evolves.

**Hackathon scope:** A local question inbox, one response/approval interaction, one saved decision record, and one change-triggered review. No external communication integration is required.

**Acceptance:** Drafts remain distinguishable from approved records; code behavior, human explanation, historical evidence, and inference remain separate. One approved record appears in a real-code journey and is invalidated appropriately after a relevant change.

### 4.8 PR Impact Simulator and Journey Diff

Preserve Kiran’s original proposal and connect it to the player.

#### Compare modes

- **PR-specific changes:** Head versus merge-base.
- **Version comparison:** Two explicit commits.
- **Current-target merge preview:** Temporary merge into the current target, when supported. Show conflicts instead of inventing merged behavior.

Display relevant commit identities. Do not mix evidence across versions.

| Output | Evidence |
| --- | --- |
| Added/modified/removed symbols | Parsed code and actual diff. |
| Direct component changes | Changed symbols/configuration mapped to components. |
| Possible downstream impact | Bounded typed dependency paths. |
| Journey changes | Supported steps/relationships on each side. |
| Suggested tests | Existing test references or labelled new-test suggestions. |
| Observed behavior differences | Tests/traces executed on the compared versions. |
| Relearning suggestion | Changed material intersecting completed lessons. |

**Interaction:** Select a changed step to inspect old/new source, explanation, and observations side by side. Preserve unaffected context.

A possible impact is not a confirmed regression. An import diff does not establish a new runtime order.

**Hackathon scope:** One prepared local branch/patch on the real repository. Label a team-created demo change as such. Live GitHub integration is optional.

**Acceptance:** Show direct changes and one supported journey difference. Qualify indirect effects. Do not output unsupported “safe to merge” verdicts or percentage risk scores.

### 4.9 Learning Drift Updates

Every generated artifact records its evidence dependencies. On branch/version change:

1. Compare files/symbols.
2. Mark potentially affected artifacts stale.
3. Re-resolve citations and relationships.
4. Regenerate/review affected material.
5. Publish a consistent snapshot.
6. Find completed lessons affected.
7. Offer a short relearning card and question.

**Example:** “Your signup lesson used the old account state. This version introduces verification. Review these two changed steps.”

**Differentiator:** Update the learner’s understanding alongside documentation.

**Rules:** PR previews remain separate from canonical branch material. Retain old snapshots. Uncertain dependency tracking triggers broader invalidation or full reindexing.

**Acceptance:** One change updates the relevant journey, preserves the old version, and produces focused relearning.

### 4.10 Understanding and Peer Evaluation

Show:

- Completed journeys.
- First/later check results.
- Ability to locate deciding code.
- Exercise outcome.
- Pending relearning.

Time-on-page is not proof of comprehension. A few checks do not establish a broad developer skill score.

**Differentiator:** Show a task-specific readiness summary: what the learner explained correctly and what remains unclear.

A real peer study is required for the finale; see Section 12.

### 4.11 Setup Drift Guard

**Pitch:** Setup instructions that stay correct for the version you are learning or reviewing.

Separate static discovery from executed verification.

#### Static setup delta

Inspect changes to:

- Runtime version files/package engines.
- Dependency manifests/lockfiles.
- Configuration and checked-in environment examples.
- Environment-variable usage.
- Schema/migration files and commands.
- README setup and project scripts.

A variable reference does not prove a mandatory requirement. Inspect defaults, branches, and validation; retain uncertainty.

#### Executed setup check

When supported:

1. Use the same declared sandbox image/environment for base and head.
2. Run reviewed recipes with synthetic configuration.
3. Record commands, exit status, redacted logs, and commit.
4. Distinguish code failure from missing credentials, unavailable services, provisioning failures, or unsupported environments.
5. Compare outcomes.
6. Produce version-specific instructions and a proposed documentation patch.

Package installs and scripts execute code; run them in isolation. Prebuild dependencies or use narrowly controlled provisioning. The execution phase must not have open network access.

**Illustrative example:** An email-verification change may require a provider variable. Show where it is read and whether startup validates it. Test with a fake provider, and do not imply real email delivery was verified.

#### User output

- What changed and which setup step is affected.
- Static source evidence.
- Commands actually tested.
- Version-specific checklist.
- Proposed README patch.
- “Verified at commit X in environment Y,” or unverified/blocked status.

**Differentiator:** Connect setup changes to the same new architecture node and journey step shown by PR Impact.

**Hackathon scope:** Static delta and one reviewed documentation suggestion first. Add one executed check if feasible. Replayed prior results retain their original run identity.

**Acceptance:** Detect a prepared setup-related change accurately. No verified badge without an actual successful execution of the stated step.

---

## 5. Product screens and user flow

| Screen | Purpose |
| --- | --- |
| Repository selection | Supported public repo/version and indexing status. |
| Mentor workspace | Graph, lesson, source, evidence, contextual questions. |
| Goal route | Relevant lessons, prerequisites, contribution goal. |
| Practice workspace | Task, hints, change input, tests. |
| Change workspace | Comparison, journey diff, setup delta, relearning. |
| Progress/results | Learning evidence and peer-study findings. |

### Mentor workspace layout

- **Top:** Repository, commit, feature/scenario, analysis mode.
- **Center:** Architecture/feature graph.
- **Lesson panel:** Current step, explanation, prediction controls.
- **Source panel:** File, highlighted lines, optional diff.
- **Evidence panel:** Evidence type, uncertainty, version/run identity.

Support keyboard stepping, text labels, non-color status indicators, and pausable animation. Provide a text lesson alternative to the diagram.

### Integrated flow

1. Select repo/version and describe skills/goal.
2. Open architecture.
3. Follow the related journey.
4. Predict a branch and inspect evidence.
5. Attempt the starter task.
6. Open the prepared code comparison.
7. Inspect changed behavior and setup.
8. Receive focused relearning.
9. Review demonstrated understanding.

---

## 6. Grounding and evidence contract

This applies to answers, diagrams, tasks, lessons, and updates.

| Label | Meaning |
| --- | --- |
| Code | Source/configuration supports a fact at the selected version. |
| Test specification | A checked-in test asserts an expectation; execution is separate. |
| Observed run | A command, test, or instrumented scenario was actually executed. |
| Documented intent | An ADR/discussion records rationale; current behavior may differ. |
| Inference | Plausible interpretation/relationship, explicitly labelled. |
| Unknown | Analysis cannot establish the claim/relationship. |

Parser extraction establishes a syntactic fact, not an entire runtime interpretation.

### Citation requirements

Repository identity, immutable commit SHA, relative path, inclusive lines, evidence type, content hash, and symbol/call-site identity when relevant. Observed-run claims also identify the run.

GitHub source-link pattern:

~~~text
https://github.com/{owner}/{repo}/blob/{commitSha}/{path}#L{start}-L{end}
~~~

Historical discussion links can support intent; current behavior still needs current source evidence.

### Validation

1. Source exists at this version.
2. Line range exists.
3. Evidence supports the claim.
4. Edge/step reflects the cited relationship.
5. Evidence mode matches wording.
6. Necessary uncertainty is visible.

Automate source/range checks. Use reviewed examples to assess semantic support. AI checking may assist but does not prove correctness.

**Failure behavior:** Return supported facts, explain the missing link, and offer available source navigation. Never invent calls, values, execution, or historical intent.

### Untrusted repository content

Comments, README text, and issues are data, not instructions for the AI. They cannot change policies, request credentials, or trigger execution. Escape source text in the UI.

---

## 7. Proposed technical implementation

Recommended defaults; any stack is permitted by the hackathon.

| Layer | Default | Responsibility |
| --- | --- | --- |
| Frontend | React + TypeScript | Mentor workspace and learning. |
| Graph UI | React Flow | Nodes, typed edges, highlights, source navigation. |
| Layout | Simple deterministic layout | Readable small graphs; advanced layout if needed. |
| Backend | Node.js + TypeScript | Indexing, retrieval, generation, APIs. |
| Analysis | TypeScript Compiler API | AST, symbols, imports, supported call resolution. |
| Storage | SQLite + versioned JSON | Snapshots, evidence, artifacts, progress, observations. |
| Retrieval | Text/symbol search + graph traversal | Locate relevant evidence. |
| Model | Team-selected model behind adapter | Explain retrieved facts and draft structured artifacts. |
| Execution | Isolated container worker | Reviewed commands/tests and optional tracing. |
| Versions | Git commits/local branches | Reproducible analysis/comparison. |

React Flow supplies interaction, not code analysis. Compiler symbol/type APIs still require an explicit supported call-resolution policy.

### Analysis pipeline

1. Resolve repository and immutable commit.
2. Record metadata/license.
3. Exclude vendored/generated/build output and sensitive files.
4. Parse with project compiler configuration.
5. Extract declarations/imports, supported routes, and call sites.
6. Preserve unresolved relationships.
7. Group symbols into components with rationale.
8. Link relevant tests and optional historical documents.
9. Store source spans/hashes/evidence.
10. Generate explanations using only retrieved evidence.
11. Validate references and review selected journeys.
12. Publish the snapshot.

### Change pipeline

1. Compare versions and reparse changed files.
2. Re-resolve affected imports/calls/dependents.
3. Compare graph entities and reviewed steps.
4. Mark dependent artifacts stale.
5. Refresh and revalidate.
6. Publish the new snapshot atomically.
7. Generate learner-specific updates.

Configuration changes may require wider invalidation. Use commit-keyed caching and content hashes to limit repeated analysis/model calls.

### Optional observed-scenario pipeline

1. Prepare disposable workspace at selected commit.
2. Run baseline checks.
3. Add disclosed instrumentation to selected symbols if needed.
4. Execute reviewed synthetic input.
5. Record results/events.
6. Map events to source; mark unmapped events.
7. Replay recorded evidence.

OpenTelemetry spans can represent observed operations and relationships. Automatic instrumentation is not a complete function-call recorder; selected function-level steps need explicit instrumentation or an equivalent mechanism.

---

## 8. Minimal data contracts

Refine these contracts during implementation without weakening evidence requirements.

~~~ts
type EvidenceKind =
  | "code"
  | "test_specification"
  | "observed_run"
  | "documented_intent";

interface RepoSnapshot {
  id: string;
  repositoryUrl: string;
  commitSha: string;
  contentManifestHash: string;
  indexedAt: string;
  supportedAnalysis: string[];
  limitations: string[];
}

interface SourceRef {
  id: string;
  snapshotId: string;
  path: string;
  startLine: number;
  endLine: number;
  contentHash: string;
  symbolId?: string;
}

interface Evidence {
  id: string;
  kind: EvidenceKind;
  sourceRefIds: string[];
  externalUrl?: string;
  observationId?: string;
}

interface Claim {
  id: string;
  text: string;
  status: "supported" | "inference" | "unknown";
  evidenceIds: string[];
  limitations: string[];
}

interface GraphNode {
  id: string;             // Version-specific identity.
  logicalId?: string;     // Cross-version match, when established.
  snapshotId: string;
  kind: "system" | "component" | "symbol" | "decision" | "external";
  label: string;
  parentId?: string;
  sourceRefIds: string[];
  claimIds: string[];
}

interface GraphEdge {
  id: string;
  snapshotId: string;
  from: string;
  to: string;
  kind:
    | "imports"
    | "resolved_call"
    | "possible_call"
    | "route_registration"
    | "data_access"
    | "documented_dependency"
    | "observed_relationship";
  status: "supported" | "inferred" | "unresolved";
  evidenceIds: string[];
  limitations: string[];
}

interface JourneyStep {
  id: string;
  nodeId: string;
  claimIds: string[];
  evidenceIds: string[];
  next: Array<{
    stepId: string;
    conditionClaimId?: string;
    edgeId?: string;
  }>;
  checkId?: string;
}

interface Journey {
  id: string;
  snapshotId: string;
  title: string;
  scenario: string;
  mode: "explained_path" | "recorded_scenario";
  steps: JourneyStep[];
  observationId?: string;
  reviewStatus: "draft" | "reviewed";
  limitations: string[];
}

interface Observation {
  id: string;
  snapshotId: string;
  environmentId: string;
  recipeId: string;
  instrumentationDescription?: string;
  status: "passed" | "failed" | "blocked";
  exitCode?: number;
  sanitizedLogPath?: string;
  traceArtifactPath?: string;
  observedAt: string;
}

interface GeneratedArtifact {
  id: string;
  snapshotId: string;
  kind: "answer" | "diagram" | "journey" | "lesson" | "setup_guide";
  evidenceIds: string[];
  dependsOnNodeIds: string[];
  status: "current" | "stale" | "regenerating" | "failed";
}
~~~

**Identity:** Lines are display locations, not stable symbol IDs. Cross-version matching uses path, qualified name, declaration kind, and structural evidence. Renames/moves can remain uncertain. Re-resolve spans after matching.

**Learner records:** Anonymous/local ID, completed artifact version, check attempts, task outcome, pending review. Real personal information is unnecessary.

**Trace records:** Event/span IDs, parent/link relationships, established source mappings, timestamps. Never substitute static edges for missing runtime evidence.

---

## 9. Stage-wise delivery and priorities

### Stage 1 — Idea and presentation

Deliver the concrete problem/persona, integrated journey, player mockup, grounding strategy, static/observed distinction, stage scope, peer-study plan, and coherent PR/setup/relearning story. Label mockups.

### Stage 2 — Online prototype

**Required:**

- One verified real public repository at a pinned commit.
- Cited Q&A.
- Readable architecture overview.
- Node/source navigation.
- Evidence labels and reviewed question set.

**Optional:** One reviewed guided path and basic local comparison, after the foundation works.

### Stage 3 — 24-hour finale

**Priority A — Expected outcomes:**

1. Two guided journeys including a failure branch.
2. Three to five understanding checks.
3. One starter exercise and verification.
4. One code change refreshing relevant documentation/journey.
5. Actual peer-study results.
6. One documented why example through an approved maintainer explanation linked to real code.

**Priority B — Differentiation:**

7. Prepared PR comparison with journey diff.
8. Targeted relearning card.
9. Static setup delta and proposed instructions.
10. Goal route connected to the exercise.

**Priority C — Extensions:**

11. Recorded scenario replay.
12. Executed setup verification.

Previously recorded evidence may be shown transparently. A correctly labelled explained path remains useful without runtime replay.

### Suggested finale allocation

Assumes Stage 2 is working and event rules permit carrying it forward.

| Time | Work |
| --- | --- |
| Hours 0–2 | Verify baseline, freeze repo/version/demo change, confirm required scope. |
| Hours 2–7 | Complete reviewed journeys, source synchronization, checks. |
| Hours 7–11 | Complete exercise and bounded comparison. |
| Hours 11–14 | Finish refresh, learning update, static setup delta, and maintainer approval example. |
| Hours 14–18 | Run peer study; fix critical evidence/usability issues. |
| Hours 18–21 | Integrate results; add feasible execution evidence; polish. |
| Hours 21–24 | Rehearse, verify reproducibility, prepare disclosures/fallback artifacts. |

Adjust to actual team capacity and event rules. Reduce extensions before compromising expected outcomes.

### Deferred scope

Full semantic support for arbitrary languages/frameworks (the adapter architecture is included); complete dynamic call resolution; production distributed tracing; enterprise governance; unnecessary large vector infrastructure; automatic upstream merging; full cloud IDE; general autonomous bug fixing; elaborate developer rankings.

---

## 10. Demo repository and change selection

The implementing agent must:

1. Identify a real public repository and license.
2. Verify language/framework, tests, and setup.
3. Pin commit and attribution.
4. Choose two actual flows with a meaningful branch.
5. Choose one verifiable small exercise.
6. Prepare a bounded change that alters a flow.
7. Record whether it is an upstream PR or team-created demo branch.

Prefer modest scope with enough cross-file behavior to demonstrate understanding.

### Illustrative change

Email verification works if it fits the repository: account-state behavior, integration boundary, login/signup journey, tests, configuration, and stale learning material can all connect.

Do not force it onto an unsuitable repository. A role check, validation change, retry policy, or feature flag may fit better.

All source names, paths, variables, and expected outcomes must come from the actual implementation. Examples here are not repository facts.

---

## 11. Acceptance and verification

### Evidence

- [ ] Public repo/license/revision recorded.
- [ ] Analysis subset and limitations documented.
- [ ] Source/range checks pass.
- [ ] Reviewed claims have supporting citations.
- [ ] Inferred/unresolved relationships are visible.

### Visual learning

- [ ] Components/symbols/edges can be inspected.
- [ ] Source follows selected steps.
- [ ] Two journeys match source.
- [ ] At least one failure path and branch question.
- [ ] Animation does not imply unobserved execution.
- [ ] Async/external/unresolved boundaries remain visible.

### Contribution

- [ ] Goal route connects to exercise.
- [ ] Checks have reviewed answers.
- [ ] Progressive hints work.
- [ ] Meaningful acceptance criteria and baseline/completion checks.
- [ ] Learner explains the change.

### Change/setup

- [ ] Version identities/comparison mode visible.
- [ ] Direct changes separated from possible impact.
- [ ] Evidence belongs to correct version.
- [ ] Stale material refreshes; old version remains available.
- [ ] Targeted relearning appears.
- [ ] Setup findings distinguish required/optional/uncertain.
- [ ] Verified badges correspond to completed runs.

### Delivery

- [ ] Peer observations/sample size actually recorded.
- [ ] Reproduction instructions complete.
- [ ] Tools/models/reuse disclosed.
- [ ] Prepared changes/reviewed mappings/instrumentation disclosed.
- [ ] Secrets excluded.

**Fallback:** Show unavailable/blocked states honestly. Keep required grounded functionality working. Do not fabricate analysis, traces, verification results, or evaluation outcomes.

---

## 12. Peer-study protocol

**Question:** Does the mentor help unfamiliar developers understand this repository faster while maintaining correctness?

### Participants

Approximately four to six consenting peers, unfamiliar with the repo. Use anonymous IDs and minimal relevant experience information.

### Design

Create comparable task sets A/B with reviewed answer keys.

- Group 1: baseline with A, mentor with B.
- Group 2: mentor with A, baseline with B.

Counterbalance order/allocation. Different comparable flows reduce direct answer reuse. Record remaining carryover limitations.

**Baseline:** Source/README with ordinary search, no mentor or other AI.  
**Mentor condition:** Same source/README plus mentor.

### Tasks

Locate an entry point; explain a failure branch; find a behavior-governing symbol; propose where a small change belongs; answer a transfer question without immediate hints.

Declare time limits. Retain incomplete tasks in results.

| Measure | Interpretation |
| --- | --- |
| Time to correct answer | Speed alongside correctness; report incorrect/incomplete attempts. |
| Answer correctness | Reviewed repository facts. |
| Evidence-location accuracy | Ability to find supporting source. |
| Explanation quality | Cause/effect understanding using a predefined rubric. |
| Exercise completion | Contribution outcome where practical. |
| Transfer result | Understanding without immediate assistance. |

Record raw observations, medians/ranges, and individual differences. Treat this as exploratory evidence, not statistical proof.

If reporting improvement, define the calculation and include correctness. A faster incorrect answer is not successful onboarding.

| Participant | Order | Task set | Condition | Time | Correct? | Correct evidence? | Explanation score | Completed? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

Leave results empty until testing. Never invent an improvement percentage.

---

## 13. Execution, privacy, and hackathon requirements

- Public repos and synthetic input/configuration only.
- Team-owned API/cloud accounts; keys server-side and unpublished.
- No production credentials/traffic.
- Execute repository code only in isolated workers with resource/time limits.
- Do not mount host secrets or expose container-control sockets.
- Reviewed command recipes only; retrieved/generated text cannot trigger arbitrary execution.
- External services use local fakes or explicitly permitted demo dependencies.
- Label mocked-service observations.
- Human review before applying generated changes to shared repositories.
- Practice changes and diagram annotations do not automatically edit source.
- Credit libraries, skills, examples, repo code, and model-assisted work.
- Standalone prototype; iMocha integration is unnecessary.

Explain evidence limits plainly in the product. Avoid exposing unnecessary implementation detail in learner flows.

---

## 14. Five-minute demo

| Time | Demonstration |
| --- | --- |
| 0:00–0:30 | Newcomer goal and real repository/version. |
| 0:30–1:15 | Architecture → component → exact source. |
| 1:15–2:15 | Journey → failure branch → prediction → evidence. |
| 2:15–2:50 | Starter exercise and authentic verification result. |
| 2:50–3:50 | Prepared comparison → changed steps/source/setup. |
| 3:50–4:20 | Refreshed lesson and relearning card. |
| 4:20–5:00 | Actual peer results, limitations, product value. |

Identify live, precomputed, and previously recorded outputs. Prepared branches/reviewed journeys are valid demo preparation when disclosed.

---

## 15. Implementing-agent instructions and deliverables

### Working order

1. Inspect any existing project before changing stack.
2. Confirm supported repo and baseline.
3. Record decisions/limits.
4. Build evidence identity and extraction.
5. Build cited Q&A/architecture.
6. Build two reviewed journeys.
7. Add checks/exercise.
8. Add prepared comparison and refresh.
9. Add learning update/static setup delta.
10. Implement the local maintainer inbox/approval, capability report, and concept-level adaptation.
11. Run peer study.
12. Add optional execution extensions if stable.

Use sensible defaults for routine choices. Clarify only choices that materially change the product or block required work.

### Deliverables

- Working supported-repo prototype.
- README/setup/model configuration/reproduction instructions.
- Source revision/license manifest.
- Structured graph/evidence/journeys.
- Reviewed Q&A/check set.
- Exercise specification and verification recipe.
- Prepared change and comparison artifacts.
- Setup delta with verification status.
- Learning-update example.
- Maintainer question/approval example and decision record.
- Agent-role modules, routing policy, and bounded task contracts.
- Repository capability report and adapter interface.
- Concept-state adaptation policy and two-learner demonstration.
- Peer protocol and actual anonymized results.
- AI/tool/reuse disclosure.
- Demo script and limitations.

### Definition of done

A newcomer can select the repo, understand major components, follow two code-grounded flows, answer reviewed checks, attempt a contribution, inspect a code-version change, and receive updated learning material. Actual peer results show what helped and what remains limited.

Behavior claims are supported or qualified. Observations identify executed scenarios. Updated artifacts identify source versions.

**Central product idea:** A living visual mentor connecting understanding, contribution, and change through the same source evidence, with maintained human rationale and learner-specific guidance.

---

## 16. Autonomous agent architecture

### 16.1 Design objective

Use specialized agents to choose useful analysis and teaching actions, while deterministic tools extract facts, verify references, maintain state, and execute permitted recipes.

Agents improve adaptability through explicit responsibilities, shared evidence, and bounded feedback. Merely adding agents does not establish accuracy, universal language support, or improved learning. Evaluate those outcomes.

These are **ten logical roles**, not a requirement for ten models, servers, or always-running processes. One model can serve different roles with separate contexts/tool permissions. Only the roles needed for an event run.

### 16.2 Agent responsibilities

| ID | Agent | Inputs | Decisions and output | Limits |
| --- | --- | --- | --- | --- |
| A1 | Coordinator | User intent, event, snapshot, capability report, budgets | Routes work, manages dependencies/retries, publishes consistent validated results. | Cannot override evidence or human-approval states. |
| A2 | Repository Scout | Source snapshot, manifests, project config | Detects languages/frameworks, selects installed adapters, builds repository profile, invokes extraction. | Cannot install unreviewed tools or execute arbitrary repository commands. |
| A3 | Evidence Verifier | Source refs, claims, proposed nodes/edges, observations | Checks version/ranges, source support, contradictions, and evidence wording; returns pass, qualified, or blocked. | Read-only source/run access; no invented evidence. |
| A4 | Architecture and Journey Agent | Extracted facts, component proposals, goal | Proposes component structure, assembles evidence-linked paths, branches, and source navigation. | Does not manufacture execution or resolve ambiguous calls by confidence alone. |
| A5 | Maintainer Knowledge Agent | Why questions, recorded history, maintainer submissions | Deduplicates gaps, prepares question cards, structures decision drafts, tracks review/supersession. | Cannot approve its own draft, attribute intent without evidence, or send external messages automatically. |
| A6 | Learner Model Agent | Explicit preferences, goal, concept checks, hints, task outcomes | Maintains concept-level learning state and proposes next-step/pace adjustments with reasons. | No personality diagnosis, fixed learning-style labels, or inference of ability from speed alone. |
| A7 | Mentor and Tutor Agent | Retrieved evidence, approved decisions, learner state | Answers questions, selects explanation depth, introduces examples/checks, delivers journeys. | Must not convert inferred explanations into established facts. |
| A8 | Contribution Coach | Repo facts, issue/exercise origin, learner goal, test results | Suggests tasks, acceptance criteria, hints, and feedback on the learner’s patch/explanation. | Does not submit/merge upstream work or silently solve the exercise. |
| A9 | Change and Learning Agent | Commit comparison, artifact dependencies, completed lessons | Detects changed knowledge, drafts journey diffs, refresh jobs, maintainer review items, and relearning cards. | A PR preview cannot overwrite canonical branch material. |
| A10 | Setup and Validation Agent | Setup facts, diff, reviewed recipes, execution capabilities | Produces setup delta, chooses allowed checks, requests isolated execution, interprets recorded results. | No host execution, real secrets, arbitrary generated commands, or unobserved verified badges. |

**Tool workers:** Parsers, symbol resolvers, search, diffing, citation validation, layout, state storage, and sandbox execution are deterministic services rather than additional conversational agents.

### 16.3 Feature ownership

| Feature | Primary owner | Supporting roles |
| --- | --- | --- |
| 1 — Q&A/navigation | A7 | A2 retrieval/extraction, A3 validation, A4 visual context |
| 2 — Architecture Atlas | A4 | A2 facts, A3 edge/source checks |
| 3 — Journey Player | A4 | A7 narration, A3 validation, A10 optional observed scenarios |
| 4 — Onboarding Route | A6 | A7 teaching, A8 goal/task prerequisites |
| 5 — Prediction checks | A7 | A6 adaptation, A3 source checks, reviewed answer rubric |
| 6 — Contribution practice | A8 | A6 readiness, A10 execution, A3 feedback evidence |
| 7 — Maintainer explanations | A5 | Human approval, A3 code/provenance checks |
| 8 — PR/Journey Diff | A9 | A2 reanalysis, A4 graph/journeys, A3 checks, A10 observations |
| 9 — Learning Drift | A9 | A6 completed concepts, A7 mini-lessons, A5 decision review |
| 10 — Progress/evaluation | A6 | Deterministic metrics and human-reviewed study rubric |
| 11 — Setup Drift | A10 | A2 config facts, A9 diff, A3 evidence |

A1 coordinates all workflows; it does not need to invoke every supporting agent for every request.

### 16.4 Event-driven orchestration

**New repository:** A2 profiles/extracts → A4 drafts overview/journeys → A3 validates → A1 publishes supported material.

**Learner question:** A1 selects context → A7 drafts with evidence → A3 checks factual claims → A7 delivers the validated/qualified answer. A4 is invoked only if new visual context is required.

**Missing rationale:** A5 searches/deduplicates → creates local question → human response → A5 structures draft → human approval → A3 checks linked code/provenance → A1 publishes.

**Learning check:** Deterministic/reviewed grading → A6 updates concept state → A7 offers the next step. A3 checks newly generated repository explanations.

**Code change:** A9 computes affected scope → A2 reanalyses → A4/A5/A10 refresh relevant artifacts → A3 checks → A1 publishes new snapshot → A6/A7 deliver relevant updates.

Read-only independent extraction/retrieval can run concurrently. Publication, learner-state updates, maintainer approval, and canonical artifact changes use ordered, version-checked writes.

### 16.5 Shared state and communication

Use typed task records and a shared evidence/artifact store. Do not rely on agents passing unsupported prose summaries to one another.

Every task carries:

- Event/task ID and parent ID.
- Repository snapshot and relevant comparison IDs.
- Learner context version if needed.
- Objective, allowed tools, and required output schema.
- Evidence/artifact IDs.
- Time/model-call/token budget.
- State: queued, running, awaiting human, succeeded, qualified, blocked, or failed.
- Validation findings and reproducible error details.

Agent output names the claims and evidence it adds, unresolved issues, and next proposed action. Claim IDs are not proof; A3 checks their content.

Only A1’s publication gate exposes canonical new artifacts. User progress and maintainer approvals are transactional and cannot be overwritten by a late job.

### 16.6 Autonomy, failure handling, and cost

Permitted autonomous actions include read-only inspection, choosing installed adapters, drafting explanations, selecting approved checks, refreshing local artifacts, and recommending lesson adjustments.

Human approval is required for maintainer rationale, shared-repository changes, and any external communication/integration that performs writes. The mentor continues source-grounded teaching while waiting.

**Initial configurable limits, to tune rather than present as proven optimal:**

- At most three concurrent specialist jobs per repository.
- At most two revisions of a failed generated artifact.
- Default question budget: one tutor draft and one evidence review; one repair if necessary.
- Explicit per-task timeouts and model budgets.
- Cache extraction and reviewed artifacts by commit/content hash.
- Use narrower evidence retrieval before escalating context size.

If the budget is exhausted, return supported findings and unresolved gaps. Avoid agent debate loops. Agent consensus is not verification.

A3 uses deterministic existence/version checks and reviewed semantic criteria. Model critique can assist, but does not guarantee correctness; the evaluation suite must include unsupported citations and contradictory evidence.

### 16.7 Hackathon implementation

Use one coordinator state machine and ordinary callable modules for all ten roles. Do not build separate microservices just to represent agents.

Stage 2 implements A1/A2/A3/A4/A7 with a small capability report. Stage 3 adds learning-state functions, contribution/change/setup modules, and the maintainer inbox. LangGraph or an equivalent orchestration tool is optional; a typed Node workflow is sufficient.

The frontend speaks to one mentor service. Learners see a coherent mentor rather than internal agent names or inter-agent messages.

---

### 16.8 Defined tools and deterministic agent behavior

**Required design:** Agents operate through a registered toolkit of typed functions owned by the application. Their prompts alone are not the enforcement mechanism. Each role receives an allowlist, and the dispatcher enforces input schemas, permissions, budgets, and valid state transitions.

Use deterministic functions for mechanically checkable facts and state changes. Use the model for explanations and bounded proposals. The model cannot directly invent source facts, change test outcomes, set approval flags, or edit learner scores.

#### Function ownership

The names below are proposed application APIs, not tools already implemented.

| Role | Defined tools/functions | Deterministic responsibility | AI contribution |
| --- | --- | --- | --- |
| A1 — Coordinator | routeEvent(), validateTask(), enforceBudget(), publishSnapshot() | Event routing, allowed transitions, budget checks, version-checked publication. | Interpret user intent and propose a supported plan when routing is ambiguous. |
| A2 — Repository Scout | inspectManifest(), selectInstalledAdapter(), parseSnapshot(), resolveSymbols() | Extract manifests/source facts; select adapters using capability rules; preserve unresolved calls. | Explain project organization and propose framework/grouping labels. |
| A3 — Evidence Verifier | resolveSourceRef(), validateCitationRange(), verifySnapshot(), checkGraphIntegrity() | File/span/hash/version checks; reject dangling entities and invalid references. | Assist semantic support review; qualify claims that need human review. |
| A4 — Architecture/Journey | queryGraph(), buildJourneyFromEdges(), validateJourney(), layoutGraph() | Only assemble existing entities/relationships; verify step references; use stable layout rules. | Choose useful entry points and propose understandable component/lesson structure. |
| A5 — Maintainer Knowledge | findQuestionByAnchor(), createQuestionDraft(), validateDecisionRecord(), markDecisionForReview() | Deduplication keys, record schema, approval-state rules, review invalidation. | Prepare focused questions and structure supplied explanations. |
| A6 — Learner Model | gradeReviewedCheck(), reduceLearningEvent(), chooseNextLesson(), applyPacePreference() | Answer-key/assertion grading, event-based state, prerequisite rules, preference precedence. | Suggest a teaching adjustment with a reason; cannot write assessment results. |
| A7 — Mentor/Tutor | retrieveEvidence(), getLearnerContext(), renderCitations(), validateAnswerSchema() | Retrieve source context, enforce required fields/references, expose approved material. | Explain code, phrase feedback, offer analogies, and answer within evidence. |
| A8 — Contribution Coach | listEligibleTasks(), validateTaskBrief(), comparePatch(), requestReviewedRecipe() | Prerequisite filters, task origin, acceptance rules, patch/source identity. | Select a suitable eligible task and provide gradual hints. |
| A9 — Change/Learning | diffSnapshots(), findDependentArtifacts(), markArtifactsStale(), intersectCompletedLessons() | Version comparison, dependency invalidation, stale-state transitions, learner intersections. | Explain impacts and draft focused relearning material. |
| A10 — Setup/Validation | inspectSetupDelta(), selectApprovedRecipe(), requestSandboxRun(), readRunResult() | Config diff, recipe allowlist, isolation/resource policy, recorded-result integrity. | Explain setup findings and propose documentation changes. |

Approved maintainer records require an authenticated human action outside agent tool permissions. Diagram/lesson builders cannot turn an inferred relationship into a supported one. Generation and verification have separate execution contexts and permissions, even when they use the same model provider.

#### Tool-call contract

~~~ts
interface DefinedToolCall {
  toolName: string;
  schemaVersion: string;
  taskId: string;
  roleId: string;
  snapshotIds: string[];
  arguments: Record<string, unknown>;
  idempotencyKey?: string;
}

interface DefinedToolResult<T> {
  status: "ok" | "partial" | "unsupported" | "blocked" | "error";
  data?: T;
  evidenceIds: string[];
  warnings: string[];
  errorCode?: string;
}
~~~

The dispatcher obtains role identity from the trusted task/session, rather than trusting a model-supplied roleId. It verifies allowed tools, arguments, snapshot scope, recipe identity, and budget before invocation. A model cannot bypass this by asking for an unregistered function or emitting a shell command.

Pure analysis functions are reproducible for the same immutable source, adapter/configuration versions, and policy. Sort outputs and use stable tie-breaking where order matters. Record tool versions and preserve errors rather than silently substituting model guesses.

Execution is different: a fixed recipe controls what runs, but external timing/environment can affect outcomes. Store the actual observation and environment. Never manufacture a passing result from a deterministic policy.

#### Deterministic learner updates

The Tutor proposes teaching actions; the learner-state reducer applies published rules to recorded assessment events. Correctness follows reviewed answer keys/assertions, not the Tutor's impression.

For free-text explanations, use a reviewed rubric and record whether feedback was human-reviewed or model-assisted. Unreviewed model grading cannot establish demonstrated mastery by itself.

Pace changes honor explicit learner preferences first. Question results, hints, and task outcomes guide recommendations; response speed alone does not lower mastery. The same event history and policy version must reproduce the same concept state and rule-selected recommendation.

#### Publication gates and bounded repair

1. Build evidence with defined tools.
2. Generate a structured draft using that evidence.
3. Run deterministic schema/reference/graph/state checks.
4. Review semantic support using the declared review method.
5. Repair within the existing task budget or return a qualified/blocked result.
6. Publish only if required checks pass.

Deterministic citation validation proves that a reference exists, not that every sentence is true. Semantic grounding still needs reviewed evaluation, and some rationale requires a human.

Cache validated factual artifacts by source/configuration/policy version. Model wording can vary; factual evidence, decision approvals, grading rules, and learner-state transitions remain controlled.

#### Required demonstration

Show one invalid tool argument being rejected, one invalid citation preventing publication, the same assessment events reproducing learner state, and an unapproved decision remaining unpublished. These are focused checks of meaningful boundaries, not a requirement for a large test suite.

---

## 17. Adapting to different repositories and coding styles

### 17.1 Product promise

**Design for many languages and styles; advertise capabilities that are actually supported.**

A multi-agent system cannot automatically understand every language/framework accurately. Generality comes from extensible adapters, normalization, repository-specific evidence, and clear fallbacks.

Hackathon semantic support remains TypeScript/Express. Other repositories can receive only the capabilities their installed adapters support. The long-term architecture allows broader support without rewriting the teaching system.

### 17.2 Repository capability profile

A2 reports languages, framework evidence, build/test tools, repository regions, generated/vendor exclusions, naming/configuration conventions, and adapter versions.

For each region, report capabilities independently:

| Capability | Example status |
| --- | --- |
| Text/source search | Available |
| Syntax and source spans | Available with installed grammar |
| Symbol/definition resolution | Available, partial, or unsupported |
| Call-site resolution | Supported direct-call subset or unresolved |
| Framework routes/lifecycle | Adapter-supported patterns only |
| Control-flow journey | Reviewed supported paths |
| Test execution | Available or blocked with reason |
| Function-level trace | Instrumented subset or unavailable |

Show counts where meaningful: supported files versus discovered files, resolved versus unresolved call sites. These are coverage diagnostics, not model-confidence percentages.

### 17.3 Adapter layers

1. **Language syntax adapter:** Extract declarations, spans, and syntax. Tree-sitter grammars may supply multi-language syntax parsing.
2. **Semantic adapter:** Use compiler/language-server facilities for definitions/references where available. Capability negotiation is required; a language server may not offer every operation.
3. **Framework adapter:** Recognize supported routes, middleware order, dependency injection, events, or lifecycle conventions.
4. **Execution adapter:** Map project scripts to reviewed recipes and describe required environment.
5. **Common evidence graph:** Normalize supported facts into shared nodes/edges/source references.

Tree-sitter parsing alone does not establish runtime calls or semantics. Framework detection from dependencies alone does not prove that a framework is actually used in a particular path.

Adapter plugins are versioned and reviewed. Agents may select installed plugins; they do not download arbitrary executable plugins suggested by repository text.

### 17.4 Coding-style adaptation

- Respect actual source names and preserve original identifiers.
- Use imports, declarations, call sites, configuration, and tests instead of requiring files named service/controller/model.
- Support grouping for procedural, object-oriented, functional, and mixed code where extraction permits it.
- Learn project conventions from existing comparable modules and tests; cite examples when recommending changes.
- Recognize naming/style rules from checked-in formatter/linter/configuration evidence.
- In legacy code, show uncertainty and avoid treating inconsistent style as a reason to invent architecture.
- Store maintainer corrections as reviewed interpretation overlays; retain extracted facts separately.
- Keep presentation overrides separate from analytical relationships.

**Example:** A procedural API and a class-based API may both normalize to an endpoint, handler, and data-access relationship, while source navigation preserves their different structures.

### 17.5 Polyglot and unsupported regions

Analyse each language/service region with its own capability profile. Connect services through supported configuration, explicit contracts, or observed relationships.

A similarly named function in another service is not a cross-service call. Without evidence, show an external boundary.

Fallback order:

1. Supported semantic analysis.
2. Syntax/source-span extraction with limited relationships.
3. Text retrieval with validated source citations and qualified explanations.
4. Explicit unsupported result when grounding is inadequate.

Do not display detailed animated call journeys in a region where calls cannot be supported. The learner can still inspect searchable code and approved explanations.

### 17.6 Generality verification

After core delivery, test a second repository with different organization within the supported stack. Optional later adapter work can add another language.

Measure extraction coverage, citation support, unresolved relationships, setup status, and usefulness of learner navigation. Do not claim cross-language support from a renamed synthetic fixture alone.

---

## 18. Adapting to a candidate’s learning pattern and pace

### 18.1 Adapt what is useful and observable

A6 tracks the learner’s current goal, explicitly chosen explanation preferences, concept understanding, hint usage, and practice outcomes.

Adaptation changes lesson length, detail, prerequisites, question difficulty, hint timing, review intervals, and next task. It does not classify learners into fixed visual/auditory personalities or assume that slow responses imply low ability.

The learner can choose pace/detail, skip, pause, request examples, switch formats, reset preferences, or disable personalization.

### 18.2 Concept-level learner state

For each concept or journey outcome, record:

- Source/version the learner studied.
- State: not assessed, learning, demonstrated, or needs review.
- Reviewed evidence: check result, source-location result, explanation rubric, or exercise outcome.
- First attempt versus retries/hints.
- Last relevant activity and explicit comfort feedback.
- Pending review after a code change.
- Next recommended action and reason.

“Demonstrated” means evidence for this particular concept, not general expert status.

Time-to-response is optional and weak context; explicit feedback and correctness take precedence. Do not record keystrokes or use hesitation to judge competence.

### 18.3 Initial adaptation policy

These are configurable prototype rules to evaluate, not scientifically established thresholds.

| Observation | Proposed response |
| --- | --- |
| Learner says “too fast” or “too much” | Shorter steps, more pauses, simpler wording, learner-controlled continuation. |
| Wrong branch prediction | Explain the deciding condition; offer one narrower prerequisite check. |
| Correct prediction, wrong source | Practise locating the deciding code before moving on. |
| Correct only after substantial hints | Keep concept in learning state; schedule a fresh check without immediate hints. |
| Two distinct first-attempt successes, including an explanation/source check | Offer deeper detail or an optional advanced task; do not force faster playback. |
| Learner knows concept and opts to skip | Skip instruction but retain an optional transfer check. |
| Exercise fails relevant acceptance check | Use failure evidence to target feedback; distinguish code error from blocked environment. |
| Repo changes relevant completed material | Mark only affected concepts for review and create a mini-lesson. |
| Evidence is sparse or conflicting | Ask an explicit preference, use neutral pace, and retain uncertainty. |

Prevent oscillation: change one or two teaching parameters at a time and keep them stable for the next small lesson unless the learner requests otherwise. Explain adjustments in plain language, for example, “Let’s revisit this condition before the next step.”

### 18.4 Two learners, same code

**Learner A:** New to middleware; identifies the handler but mispredicts validation. Offer a shorter middleware lesson, highlight the registration order, and ask a focused follow-up.

**Learner B:** Correctly explains routing and failure behavior without hints. Offer direct source detail, optional edge cases, and a more independent starter task.

Both receive the same source truth and evidence standard. Only teaching order, depth, support, and pacing differ.

### 18.5 Persistence, privacy, and change

Save minimal anonymous/local learning state with explicit retention controls. Allow reset/export/delete and personalization opt-out. Peers consent to any observations collected in the study.

Version learning records with artifacts. A changed symbol may require review; it does not erase evidence that the learner understood the old version. General concepts already demonstrated may remain valid.

A6 updates records through a reviewed event reducer. A7 can recommend an update but cannot invent check results. Invalidated or incorrect teaching items must not count against the learner.

### 18.6 Adaptation evaluation

In addition to the main peer study, verify:

- Two learners receive different routes for documented reasons.
- Explicit pace preferences override automatic recommendations.
- Wrong source navigation produces targeted support.
- Interrupted/slow sessions do not lower concept state automatically.
- Hinted success differs from independent success.
- Version changes trigger relevant review without resetting all progress.
- Personalization can be disabled.

For the small study, collect perceived pace-fit and usefulness descriptively. A separate later comparison of fixed versus adaptive tutoring is needed to isolate the benefit of adaptation; baseline-versus-mentor results alone cannot establish it.

---

## 19. Additional implementation contracts and acceptance

### 19.1 Data extensions

~~~ts
interface DecisionRecord {
  id: string;
  question: string;
  relatedLogicalNodeIds: string[];
  sourceRefIds: string[];
  originatingSnapshotId: string;
  rationale: string;
  alternatives: string[];
  constraints: string[];
  intentType: "historical_participant_account" | "current_guidance" | "interpretation";
  authorProvenanceId: string;
  approvalProvenanceId?: string;
  evidenceIds: string[];
  status:
    | "draft"
    | "awaiting_review"
    | "approved"
    | "needs_review"
    | "superseded"
    | "withdrawn";
  supersedesId?: string;
  updatedAt: string;
}

interface RepositoryCapability {
  region: string;
  languages: string[];
  adapterIds: string[];
  capabilities: Record<string, {
    status: "available" | "partial" | "unsupported" | "blocked";
    evidenceIds: string[];
    limitations: string[];
  }>;
}

interface ConceptLearningState {
  learnerId: string;
  conceptId: string;
  studiedSnapshotIds: string[];
  state: "not_assessed" | "learning" | "demonstrated" | "needs_review";
  assessmentEventIds: string[];
  lastActivityAt?: string;
  recommendation?: { action: string; reason: string };
}

interface AgentTask {
  id: string;
  parentId?: string;
  roleId: string;
  eventId: string;
  snapshotIds: string[];
  learnerStateVersion?: number;
  evidenceIds: string[];
  objective: string;
  allowedTools: string[];
  budget: { timeoutMs: number; maxModelCalls: number; maxTokens: number };
  status:
    | "queued"
    | "running"
    | "awaiting_human"
    | "succeeded"
    | "qualified"
    | "blocked"
    | "failed";
}
~~~

Store open question cards separately from approved decisions. Human authorship/approval provenance may use pseudonymous local IDs in the public demo.

### 19.2 Required new checks

- [ ] Missing rationale creates a specific, deduplicated local question.
- [ ] Human submission remains a draft until approval.
- [ ] Approved intent has provenance and related source/version.
- [ ] A relevant code change triggers decision review.
- [ ] Agents share typed evidence rather than unverified summaries.
- [ ] Unavailable adapters downgrade capability visibly.
- [ ] Repository conventions guide task suggestions.
- [ ] Learner pace/preferences can override adaptation.
- [ ] Learning events are reproducible and cannot be fabricated by a tutor.
- [ ] Agent failures/retries terminate within declared budgets.
- [ ] Learner-visible results remain coherent and source-grounded.

### 19.3 Delivery priority

Required additions to the prototype are the maintainer inbox/approval example, capability report, concept-state policy, and event-driven agent modules. Multiple languages, sophisticated recommendation models, external maintainer integrations, and distributed agent infrastructure remain later work.

Maintain the existing required architecture/Q&A/tours/tasks/refresh/peer-test scope. Integrate these additions into that workflow instead of creating separate demonstrations.

---

## 20. References and attribution

Checked on 11 October 2026. References inform the design; they do not establish implementation or market uniqueness.

1. [gauravs19/enterprise-architecture-skill](https://github.com/gauravs19/enterprise-architecture-skill) — community architecture-as-code inspiration. Review license before reuse.
2. [jorexe/arch-diagram-skill](https://github.com/jorexe/arch-diagram-skill) — README describes interactive standalone diagrams; not executed here.
3. [C4 model — Dynamic diagram](https://c4model.com/diagrams/dynamic) — feature-specific interactions.
4. [React Flow — Custom Nodes](https://reactflow.dev/learn/customization/custom-nodes) — graph interaction.
5. [Microsoft TypeScript — Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) — AST/symbol/type APIs.
6. [OpenTelemetry — Traces](https://opentelemetry.io/docs/concepts/signals/traces/) — observed operations and relationships.
7. User-provided feature plans and CODE APEX 3.0 problem statement.
8. Kiran’s PR Impact Simulator proposal, retained from the original plan.
9. [Tree-sitter — Introduction](https://tree-sitter.github.io/tree-sitter/) — syntax parsing and incremental updates; not complete semantic analysis.
10. [Microsoft — Language Server Protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) — optional language-service interoperability; capabilities vary by server.
11. [LangGraph — Overview](https://docs.langchain.com/oss/python/langgraph/overview) — optional stateful orchestration, deterministic/agentic steps, and human review. No framework is required by this specification.

Before submission, fill implementation choices with actual repository, revisions, tools/models, licenses, and measured results.

