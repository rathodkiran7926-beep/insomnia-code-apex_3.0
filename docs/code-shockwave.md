# What If I Change This?

## Flow

In the live Codebase Mentor Workspace, select a source-backed component and choose **What If I Change This?** next to its name. The right panel opens on **Impact** while the existing Code Focus, Split Focus, and Architecture Focus layouts remain unchanged. It loads the selected symbol's source from the analyzed snapshot and opens a proposed-code field prefilled with that code. The original snapshot version is available in a collapsed **Before** section. Edit the proposed code, choose a review scenario, then select **Analyze proposed code** to compare both versions with indexed dependency evidence.

The server retrieves the before-code span from the immutable snapshot; browser-local drafts are not substituted for the snapshot source and are never sent to the real PR workflow. On explicit analysis, the server sends the before/after source span and bounded relevant graph evidence to the configured LLM. The result separates likely behavior changes, dependency considerations, and suggested checks. The graph-derived dependent list remains available below the concise analysis. Code is sent to the configured provider only when the developer chooses **Analyze proposed code**. If no provider is configured, the UI reports that fact and preserves the static indexed results.

Choose a dependent to focus its graph node, read the source-path explanation, expand its evidence path, and open a pinned source reference. **Explore impact from here** explicitly changes the analysis target. **Clear preview** removes impact highlights without changing the selected component or layout.

When Architecture Focus is hidden in Code Focus, **Show on map** switches to Architecture Focus. The **Mentor** tab remains mounted while Impact is open, preserving conversation state. **Analyze a real PR** opens the existing Changes workflow; it does not construct a hypothetical comparison.

## Traversal and evidence

The backend follows incoming edges because graph edges are stored `source → target`: callers or consumers are found by following edges whose `target` is the current node. Evidence preserves the graph's original direction and includes actual edge IDs and same-snapshot source-reference IDs.

| Scenario                              | Traversed relationships | Review purpose                                                                                                                                                 |
| ------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modify behavior (`behavior-change`)   | `calls`                 | Inspect indexed callers and consumers that may use the changed behavior.                                                                                       |
| Remove or rename (`remove-or-rename`) | `calls`, `imports`      | Inspect indexed call and import references that may need updates. A coordinated rename may preserve behavior; the preview does not assert compilation failure. |

Imports are dependency edges, not calls. Containment, route registration, middleware, database, and other relationships are not traversed as behavioral impact. The existing PR comparison now reuses the shared incoming-call traversal; changed components/edges remain separate from unchanged dependents suggested for inspection.

Traversal defaults to depth 2 and 30 affected components. The API caps depth at 5 and results at 50; up to three shortest supporting paths are kept per component. Cycles are bounded, duplicate components are collapsed to minimum depth, and `truncated` indicates omitted components or paths. Test references are surfaced only when an indexed test excerpt mentions the selected or affected component; this is not proof of test coverage.

## API

```http
GET /api/snapshots/:snapshotId/components/:componentId/impact-preview
    ?scenario=behavior-change&depth=2&limit=30
```

The response includes `snapshotId`, `commitSha`, the selected component, scenario, affected component IDs and minimum depths, relationship types, edge/reference evidence paths, supported test references, unresolved-reference coverage, truncation, and limitations. The route checks snapshot identity, component membership, and that selected and evidence references belong to that snapshot. It uses the repository's existing public analyzed-snapshot access model; the application does not currently associate repository snapshots with individual authenticated owners.

After graph results return, the UI may request a source-path explanation separately:

```http
GET /api/snapshots/:snapshotId/components/:componentId/impact-explanations
    ?scenario=behavior-change&affectedComponentId=c42
    &evidencePathEdgeIds=e10&evidencePathEdgeIds=e3
```

The server revalidates the path and sends only the related source excerpts and evidence IDs to the configured Gemini-compatible service. Graph results never wait for generation. Returned citation IDs are checked; if generation is unavailable, a deterministic explanation based on the recorded path is returned instead.

After the user explicitly submits a proposed code span, the UI requests the comparison:

```http
POST /api/snapshots/:snapshotId/components/:componentId/impact-analysis
Content-Type: application/json

{"scenario":"behavior-change","proposedCode":"..."}
```

The server validates snapshot/component membership, retrieves the pinned before-code from that snapshot, bounds each code span to 8,000 characters, and includes the bounded indexed impact paths and related source excerpts. The configured LLM returns a short summary, likely behavior changes, dependency considerations, suggested checks, and evidence IDs; citations are validated against the supplied snapshot references. The API does not execute code or compile the proposal. Without LLM configuration, it reports that analysis is unavailable and returns the already-indexed graph results.

## One-minute demo

1. Open an analyzed repository in the live workspace and select a function with at least one indexed caller.
2. Click **What If I Change This?**. The snapshot code and editable **After · proposed code** field open in the Impact panel.
3. Change a return value or condition and choose **Analyze proposed code**. Review the concise behavior/dependency summary and suggested checks.
4. Expand **Indexed dependents** to inspect the supporting source paths, focus a caller, and open a file-and-line citation. The graph highlights remain static-analysis hints.
5. Switch between **Modify behavior** and **Remove or rename**; explain that import edges are included only for the latter review purpose.
6. If the map was hidden, choose **Show on map**. Then demonstrate **Clear preview** and verify the selected component and layout stay put.
7. Choose **Analyze a real PR** and select a real pull request in Changes. Changed PR content and unchanged potential dependents are distinct; browser-local drafts are not included.

## Analysis limitations

This is static, bounded source-relationship exploration. Dynamic dispatch, unresolved symbols, excluded files, runtime behavior, test coverage, and actual breakage are not established. No indexed dependents is not evidence that a change is safe. The repository has no tracked VS Code extension, so the existing-extension command integration does not apply.
