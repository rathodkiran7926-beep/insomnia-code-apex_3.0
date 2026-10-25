# My Progress & Updates

The default `/progress` page now reads saved activity for the selected repository.
The previous signup/login sample report remains under **Prepared sample activity**,
including its assessments, skill map, export, reset, and PDF report. Sample values
are not included in the real repository totals.

## Included records

- Journeys: latest checkpoints from the existing signed-in account API or guest
  browser storage. Rows show visited event IDs, saved prediction results, completed
  paths, and the last saved timestamp. A completed path does not mean every possible
  scenario was explored. Individual earlier clicks and first-attempt history are
  not reconstructed from the latest checkpoint.
- Practice: every saved attempt for the existing browser learner ID, across saved
  versions of the selected repository. Totals include syntax-passed and failed
  drafts, with per-attempt difficulty, task title, snapshot, and timestamp.
  Syntax checks do not establish successful execution or completed requirements.
- Quizzes: repository sessions and the learner's general `learning-journey` sessions.
  General sessions are explicitly labelled because the current quiz implementation
  does not associate them with a repository. Unanswered questions are not scored as
  wrong. Other learners and other repositories are excluded.
- PR comparisons: saved comparisons associated with this repository's head snapshots.
  These are backend analysis records, not claims about who authored a PR.
- Commits: paginated GitHub history through the selected snapshot commit.
- Pull requests: the existing GitHub PR listing API, including open, closed, draft,
  and merged entries. Commit and PR authors come from GitHub; they are repository-wide
  activity, not automatically attributed to the current learner.
- Snapshots: IDs and commit hashes of all stored versions for this repository.

GitHub's first pages load when the report opens. Failures do not discard local
progress. More pages remain accessible through **Load more** actions. Totals for
local records include all matching rows; detail pages contain 25 rows per category.
GitHub counts are labelled **loaded** because no repository-wide total is assumed.
The timeline combines loaded details and latest journey checkpoints, not a complete
runtime or interaction trace. Refresh reloads current records.

## Existing sources of truth

No duplicate skill, user, or progress storage was added. The report uses:

- `useJourneyProgress` / `mentor-codejourney-progress-v1` or account-owned
  `/api/codejourneys/progress` records.
- `getPracticeLearnerId` / `codebase-mentor.practice-learner.v1`.
- Existing `practice_attempts`, `practice_tasks`, `practice_quiz_sessions`,
  `practice_quiz_answers`, `pr_comparisons`, `snapshots`, and `components` tables.

The practice learner UUID is the existing browser-scoped identity mechanism; this
report does not turn it into account authentication. Source code drafts, reflections,
provider keys, and quiz answer keys are not returned in the report.

## APIs and files

`GET /api/progress/report?snapshotId=...&learnerId=...&page=1&journeyIds=...`
returns summary totals, snapshots, optional journey name metadata, paginated practice
attempts, quiz sessions, saved comparisons, and per-category `hasMore` flags.
Journey metadata is resolved only within the selected repository. The current
page supplies up to 150 IDs for name resolution; any additional checkpoints still
appear using their saved ID when a friendly name is unavailable.

`GET /api/progress/commits?snapshotId=...&page=1` returns up to 30 commits with
author, date, message, URL, pinned `throughCommit`, and `hasMore`.

`GET /api/pr/pulls?snapshotId=...&state=all&page=1` is reused unchanged.

Implementation: `backend/src/progressReport.js`, `progressRoutes.js`,
`frontend/src/components/RepositoryProgress.tsx`, and `styles/repository-progress.css`.
`pages/Progress.tsx` retains the existing sample report. JSON export includes current
totals and loaded details; print switches to Overview for the full loaded report.
Export explicitly states when additional detail or GitHub pages remain unloaded.

## Verification

Backend tests cover learner/repository isolation, multiple saved versions, general
quiz inclusion, pagination, private-field exclusion, invalid IDs, and pinned commit
queries. The existing practice browser verifier now checks real journey/practice/quiz
values, automatic commit and PR loading, JSON export, sample preservation, and
mobile/print layout with isolated fixtures. No production mock data is used.
