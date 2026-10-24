# Practice integration

Only the Practice features were adapted from the supplied archive. Existing repository analysis, journeys, collaboration, and the guided signup exercise remain available.

## Using Practice

1. Analyze a repository in Architecture, then open Practice.
2. Choose **Repository practice** and a difficulty level. The backend asks the configured model for tasks grounded in that saved snapshot's JavaScript or TypeScript components.
3. Select a task in the roadmap. Review its objective, source citations, acceptance criteria, and first hint.
4. Edit the draft, explain your change, and select **Check syntax and save**. Saved attempts appear in the history. You can download the draft; it does not modify or push repository files.
5. Choose **Quick quizzes** for a five-question review. Answers reveal feedback after submission. Previous answers influence concept review scheduling. These questions come from a reviewed learning bank; they are not claims about repository behavior.
6. **Guided sample** retains the original signup validation exercise and its supported Zod assertions.

## Model and local setup

Use Node 24 or newer. Install packages with `npm.cmd install --prefix backend` and `npm.cmd install --prefix frontend` if needed.

Set these names in the ignored `backend/.env`, using your own credential:

```dotenv
LLM_BASE_URL=https://studio-unmapped-vicinity.ngrok-free.dev/v1
LLM_MODEL=qwen2.5-codebase:latest
LLM_API_KEY=your_endpoint_api_key
```

Run `npm.cmd run dev --prefix backend` and `npm.cmd run dev --prefix frontend` in separate terminals. All server text-generation features share `backend/src/llmConfig.js`; Practice has no separate Gemini client. Quizzes do not need a model connection. Missing credentials, unavailable providers, and invalid generated evidence produce an error rather than sample repository tasks.

## Implementation

| Part | Files and responsibility |
| --- | --- |
| Page and theme | `frontend/src/pages/Practice.tsx`, `frontend/src/styles/practice-features.css`: tabs, saved difficulty, responsive layout |
| Repository workbench | `frontend/src/components/RepositoryPractice.tsx`: roadmap, editor, reflection, attempts, draft download |
| Quiz | `frontend/src/components/PracticeQuiz.tsx`: questions, feedback, completion, stale-response protection |
| Client requests | `frontend/src/services/practiceApi.ts`, `practiceContext.ts`: API calls, browser learner ID, learning context |
| API | `backend/src/practiceRoutes.js`: validation and request routing |
| Evidence and storage | `backend/src/practice.js`: source selection, credential redaction, model requests, citation validation, syntax checks, quiz bank and review scheduling |

Generated tasks must cite component and source-reference IDs from the selected snapshot. Links point to the stored commit. The backend validates the response shape and citations before saving it. Submitted JS/TS receives a TypeScript parser syntax check only; passing it does not establish correctness or completion of the acceptance criteria.

| Endpoint | Input and result |
| --- | --- |
| `POST /api/practice/tasks` | Snapshot ID, learner UUID, difficulty and learning context; returns source-linked tasks |
| `POST /api/practice/attempts` | `taskId`, `learnerId`, draft `code` and optional `reflection`; derives snapshot/difficulty from the saved task and saves syntax feedback |
| `GET /api/practice/attempts` | `learnerId` and `snapshotId` query parameters; returns the latest ten attempts |
| `POST /api/practice/quizzes/sessions` | Learner, difficulty, learning context and optional snapshot; returns questions without answer keys or explanations |
| `POST /api/practice/quizzes/sessions/:id/answers` | Learner UUID, question ID and selected option; returns grading and explanation |

SQLite tables are created automatically: `practice_tasks`, `practice_attempts`, `practice_quiz_sessions`, `practice_quiz_answers`, and `practice_quiz_concepts`. Tasks bind component IDs to immutable snapshots. Attempts bind learners to tasks and snapshots. Quiz answers bind to sessions; concept records retain review dates. The learner UUID is stored in the browser, not an authenticated team identity. Clearing browser storage creates a new learner profile.

## Verification and limits

- `npm.cmd test --prefix backend`: 109 tests passed, including six Practice tests for syntax checking, evidence validation, attempts, quizzes, and invalid requests.
- `npm.cmd test --prefix frontend`: 64 tests passed, including Practice context checks.
- `npm.cmd run build --prefix frontend`: production build passed.
- `npm.cmd run verify:practice --prefix backend`: automated desktop/mobile browser verification uses an isolated database and a controlled model response. It checks model routing, task generation, commit-pinned citations, saving valid and invalid drafts, attempt history, five-question completion, difficulty persistence, and mobile overflow. It does not test external model availability.
- A separate live request to the configured custom model produced three schema- and citation-validated tasks from synthetic source in an in-memory database. No private repository source or runtime values were used in that check.

Repository drafts are never executed. No application tests, type checks, deployment, repository writes, or pull requests are performed by this feature. Model suggestions still need developer review. Syntax success is not a runtime or task-completion verdict. The fixed quiz bank reviews general concepts; only repository tasks use the configured model.
