# My Learning Path migration

My Learning Path at /#/learn reuses the existing repository journey library and player. For You is the default; All Journeys keeps search, topic/difficulty/status filters, sorting, pagination, and journey actions. The player now opens at /#/learn/:id. Old /#/journeys links redirect with their scenario, trace, resume, and topic query parameters intact.

## Skills and recommendations

Inspection found experience and learning goal in WorkspaceContext, but no persisted skills list. The old TypeScript/React profile badges were fixed display text. Skills now live in that same workspace profile and existing codebase-mentor.workspace.v1 localStorage object, edited through the existing learner preferences dialog. Older profiles receive an empty list; old progress fields remain intact. No separate skill store or skill proficiency is created.

Labels such as Node and Node.js, TS and TypeScript, and Express.js and Express are normalized. Recommendations match explicit journey tags/topics and the language of actual event source paths. Framework metadata is extracted from actual used imports in each component source. React automatic JSX is also recognized when the nearest stored package manifest declares React without a conflicting JSX framework. Stored metadata exposes its source-import or manifest evidence. Express route metadata retains the analyzer's source-confirmed construction evidence. Component names are not used to invent languages, frameworks, or runtime behavior.

Ranking prioritizes direct skill matches before related next steps, then unfinished saved journeys and connected source paths within those groups. Completed main paths rank lower. The existing testing goal can break ties when testing metadata actually exists. Direct recommendations require an actual skill match. A reviewed bridge also offers frontend-framework users connected HTTP/API paths as clearly labeled Related next step suggestions. It never labels those paths React source or claims HTTP is a skill the user has. Unknown/unrelated skill strings have no bridge. Direct framework matches rank before related suggestions; saved progress prioritizes paths within those groups. Larger connected paths rank above isolated helpers, and helpers already covered by a higher-ranked path are omitted unless in progress. For You shows up to twelve distinct suggestions; All Journeys retains the full library. Difficulty is displayed only when rated. There are no stored journey prerequisites or per-skill proficiency levels, so none are invented and no beginner level is assumed.

If skills are missing, For You offers Add skills and All Journeys. Weak matches show an explanation rather than unrelated cards. If For You has no direct skill matches, subsequent API pages are searched automatically before reporting that none exist. Load more repository components remains available. Cards are filtered by both selected repository and exact snapshot before ranking or display. Cancelled fetches cannot replace results after a repository switch.

## Preservation and verification

Journey IDs, source hashes, snapshot IDs, guest checkpoint storage, authenticated checkpoint APIs, completion history, and saved event references are unchanged. Existing bookmarked player links redirect to the same journey. The diagram, source viewer, mentor, narration, questions, predictions, playback controls, alternate paths, and resume logic reuse the existing player.

The obsolete lesson-list page is replaced with the shared journey library. Its stored lesson and practice fields remain because other components still use them.

Automated verification: frontend production build; 77 frontend tests (including alias normalization, ranking, repository/snapshot isolation, unknown difficulty, weak matches, changed skills, direct versus related recommendations, covered helper suppression, and old URLs); 128 backend tests. The expanded journey browser verification checks real parser-backed source, missing skills, preference edits/reopening/persistence, default For You, weak matches, actual React component recommendations, All Journeys, old redirects, source highlighting, mentor questions, resume, completion, alternate paths, mobile, and reduced motion. It uses an isolated database without executing repository code or calling a paid model.

## Function labels throughout the application

New analysis preserves declared function names and derives assigned variable/property names from the TypeScript AST. Inline callbacks show their actual source context, such as GET /health handler, options.save, or Account / useEffect callback. A callback without a declared name is not presented as having an invented declaration. Default exports and unresolved naming contexts include their source location.

The API presentation layer also resolves legacy anonymous:line labels from saved source spans and registration evidence. This updates component lists, diagram/playback titles, journey titles and scenario labels in serialized responses. It does not rewrite stored graphs, trace IDs, source hashes, question text, source code or historical explanation prose. Existing snapshots work without reanalysis.

Naming checks cover declarations, bindings, route handlers, middleware, hook callbacks, default exports, same-snapshot label resolution and preserving saved evidence. The browser check seeds an old callback name, confirms the snapshot API shows GET /health handler, and opens that event in the actual journey diagram.
