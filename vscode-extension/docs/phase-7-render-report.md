# Phase 7 renderer and webview script

Owned files: `src/views/handoffContent.ts`, `media/handoffs.js`, and
`test/handoff-render.test.cjs`.

The pure renderer exports `renderHandoffBody`, `HandoffViewState`, and
`HandoffDraft`. Compose names the backend destination before explicit Build
Preview. Authored fields retain exact whitespace and have 1500/2000/2000 limits.
Review displays candidate references and optional relationships, documentation,
original checkpoint notes and bounded excerpts. Backend selection is preserved;
changing a checkbox disables Save until Apply selection rebuilds the preview.
The canonical Markdown is escaped plain text in a wrapping pre element. Saved
detail includes original source references, complete Markdown and limitations.
Copy/export/delete/source actions are explicit and carry current view and saved
record IDs. Labels describe manual export and local preparation.

The script uses delegated events and the checkpoint-style ready handshake.
Status-only messages modify the live status node without replacing compose DOM,
preserving unsent fields and focus. No fetch, clipboard or file operations occur
in the webview. Preview sends only exact authored fields; refine sends only the
explicit bounded selection.

Verification:

- Initial `node --test test/handoff-render.test.cjs`: 5 failures before renderer
  and script existed (missing export/script).
- Targeted esbuild bundle of `src/views/handoffContent.ts`, merged into the
  existing test library in memory, followed by `require` of the test file:
  **7 passed, 0 failed**. This covers default opt-outs, field limits, markup
  injection, exact Markdown and authored whitespace, selection retention,
  explicit messages, review invalidation and ready/status behavior.
- `node node_modules/typescript/bin/tsc --noEmit`: no renderer errors; at the
  time of this check the shared controller could not see in-progress client
  handoff methods. Root integration must rerun after those methods land.

The root-owned test harness must export `src/views/handoffContent.ts` and include
`test/handoff-render.test.cjs`. No dependencies or commits were created.
