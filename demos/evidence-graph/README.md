# Code to evidence graph: standalone teaching example

Open **index.html** in a browser. It needs no server, API key, database, internet
connection, or build step. The app's existing logo is loaded from `frontend/public`.
Keep this folder inside the repository if you want that logo to appear.

1. Click **Next step** or **Play build** to reveal snapshot, components, imports,
   route registrations, calls, and evidence.
2. Select a component or one of the **Inspect a connection** buttons.
3. Read the source reference and the highlighted lines in the source panel.
4. Open **What the analyzer could not resolve** to inspect unsupported calls and
   the external Express import. The graph does not invent edges for them.
5. Use **Back**, **Pause**, and **Restart** to explain the process at your own pace.
   On narrow screens, scroll the graph sideways; the evidence panel stacks below it.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Standalone page and accessible controls |
| `styles.css` | White/lavender layout and responsive source/graph panels |
| `app.js` | Step playback, selection, source highlighting, graph rendering |
| `graph-data.js` | Committed analyzer output and the illustrative source files |
| `regenerate.mjs` | Regenerates data using the application's actual analyzer |

## How the data is built

The source fixture is a deliberately small Express signup example, not an
uploaded repository or production trace. Its functions and route are illustrative.
However, the nodes, edges, IDs, and source ranges in `graph-data.js` are generated
by the existing `backend/src/analyzer.js`; they are not manually fabricated.

With the backend dependencies installed, run from the repository root:

```powershell
node demos/evidence-graph/regenerate.mjs
```

This calls `analyze()` on three in-memory TypeScript files. The TypeScript compiler
finds declarations, resolves local imports and call targets, and recognises
Express route registration. The result currently contains seven components and
five relationships. The generator never runs the fixture's functions.

The page reveals a small graph already computed by the analyzer; the animation
does not parse source live. It uses plain DOM and SVG rather than adding another
diagram dependency. No AI provider is used.

## Relationship and identity example

`signupHandler → createUser` is supported by `createUser(req.body.email)` in
`handlers.ts`. Its stored relationship contains `source`, `target`, `type: calls`,
and `referenceId`. The reference contains `snapshotId`, file, start/end lines,
offsets, and the source excerpt. Selecting that relationship highlights its range.

The analyzer computes the teaching snapshot ID from the example repository and
commit. Component and relationship IDs identify objects within that snapshot.
This standalone example does not create database records or production snapshots.
The commit made of `d` characters and the example repository are teaching labels.

## Evidence boundaries

- A static call connection is not a captured call, request ordering, or successful
  execution. Runtime inputs, outputs, and branch outcomes remain unknown.
- `createUser` builds an object in source. There is no database operation here.
- External Express and `res.json` calls are listed as unresolved where the analyzer
  cannot resolve their implementation. They are not silently connected to invented nodes.
- Role labels can be source-derived inferences; they do not establish deployment
  architecture or separate microservices.
- The main application, APIs, saved snapshots, and navigation are unchanged.
