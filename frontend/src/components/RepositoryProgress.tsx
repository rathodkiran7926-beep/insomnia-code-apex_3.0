import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { flushSync } from 'react-dom';
import {
  BookOpen,
  CheckCircle2,
  Download,
  FlaskConical,
  GitCommitHorizontal,
  GitPullRequest,
  RefreshCw,
  Target,
} from 'lucide-react';
import { Button, PageHeading } from './UI';
import { useRepositoryAnalysis } from '../state/RepositoryAnalysisContext';
import { useJourneyProgress } from '../state/useJourneyProgress';
import { useCollaboration } from '../state/CollaborationContext';
import { getPracticeLearnerId } from '../services/practiceApi';
import { analysisApi } from '../services/analysisApi';
import '../styles/repository-progress.css';

type Attempt = {
  id: string;
  taskId: string;
  title: string | null;
  snapshotId: string;
  difficulty: string;
  status: string;
  reviewStatus: string | null;
  createdAt: string;
};
type Quiz = {
  id: string;
  snapshotId: string;
  difficulty: string;
  questions: number;
  answered: number;
  correct: number;
  createdAt: string;
  lastAnsweredAt: string | null;
};
type Comparison = {
  id: string;
  number: number;
  title: string;
  filesChanged: number;
  createdAt: string;
  beforeSnapshotId: string;
  afterSnapshotId: string;
};
type Report = {
  repository: string;
  snapshotId: string;
  generatedAt: string;
  summary: {
    attempts: number;
    syntaxPassed: number;
    syntaxFailed: number;
    tasksAttempted: number;
    tasksCompleted: number;
    reviewsPassed: number;
    quizSessions: number;
    quizAnswered: number;
    quizCorrect: number;
    comparisons: number;
    snapshots: number;
    commitsAnalyzed: number;
  };
  snapshots: { snapshotId: string; commit: string }[];
  journeys: { id: string; title: string; snapshotId: string }[];
  attempts: Attempt[];
  quizzes: Quiz[];
  comparisons: Comparison[];
  page: number;
  hasMore: { attempts: boolean; quizzes: boolean; comparisons: boolean };
};
type Commit = { sha: string; message: string; author: string; date: string | null; url: string };
type Pull = {
  number: number;
  title: string;
  author: string;
  state: string;
  merged: boolean;
  draft: boolean;
  updatedAt: string;
  url: string;
};
type GitPage<T> = {
  rows: T[];
  page: number;
  hasMore: boolean;
  error: string;
  loading: boolean;
  loaded: boolean;
};
const emptyGit = <T,>(): GitPage<T> => ({
  rows: [],
  page: 0,
  hasMore: false,
  error: '',
  loading: false,
  loaded: false,
});
const date = (value: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString()
    : 'Date unavailable';
const mergeRows = <T extends { id: string }>(a: T[], b: T[]) => [
  ...new Map([...a, ...b].map((row) => [row.id, row])).values(),
];

export function RepositoryProgress({ onSample }: { onSample: () => void }) {
  const { snapshot } = useRepositoryAnalysis();
  const { account } = useCollaboration();
  const { progress, ready, error: journeyError, refresh: refreshJourneys } = useJourneyProgress();
  const [learnerId] = useState(getPracticeLearnerId);
  const [revision, setRevision] = useState(0);
  const [stored, setStored] = useState<{ key: string; value: Report } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('Overview');
  const [search, setSearch] = useState('');
  const [commits, setCommits] = useState<GitPage<Commit>>(emptyGit);
  const [pulls, setPulls] = useState<GitPage<Pull>>(emptyGit);
  const requests = useRef(new Set<AbortController>());
  const contextKey = `${snapshot?.snapshotId || ''}:${account?.user.id || 'guest'}:${learnerId}`;
  const identity = useRef(contextKey);
  identity.current = contextKey;
  const journeyIds = Object.keys(progress)
    .filter((id) => id.startsWith('repo-'))
    .sort()
    .slice(0, 150)
    .join(',');
  const report = stored?.key === contextKey && ready ? stored.value : null;

  useEffect(() => {
    setStored(null);
    setError('');
    setCommits(emptyGit());
    setPulls(emptyGit());
    for (const request of requests.current) request.abort();
    requests.current.clear();
    if (!snapshot || !ready) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const key = contextKey;
    const query = new URLSearchParams({ snapshotId: snapshot.snapshotId, learnerId, journeyIds });
    analysisApi<Report>(`/api/progress/report?${query}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted && identity.current === key) setStored({ key, value });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [contextKey, ready, journeyIds, revision]);
  useEffect(
    () => () => {
      for (const request of requests.current) request.abort();
    },
    [],
  );

  async function loadMore() {
    if (!report || !snapshot || loading) return;
    const controller = new AbortController();
    requests.current.add(controller);
    const key = contextKey;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        snapshotId: snapshot.snapshotId,
        learnerId,
        journeyIds,
        page: String(report.page + 1),
      });
      const next = await analysisApi<Report>(`/api/progress/report?${params}`, {
        signal: controller.signal,
      });
      if (identity.current !== key || controller.signal.aborted) return;
      setStored({
        key,
        value: {
          ...next,
          attempts: mergeRows(report.attempts, next.attempts),
          quizzes: mergeRows(report.quizzes, next.quizzes),
          comparisons: mergeRows(report.comparisons, next.comparisons),
        },
      });
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      requests.current.delete(controller);
      if (identity.current === key && !controller.signal.aborted) setLoading(false);
    }
  }
  async function loadGit(kind: 'commits' | 'pulls') {
    if (!snapshot || (kind === 'commits' ? commits.loading : pulls.loading)) return;
    const controller = new AbortController();
    requests.current.add(controller);
    const key = contextKey,
      old = kind === 'commits' ? commits : pulls;
    const update = (patch: { loading?: boolean; error?: string }) => {
      if (kind === 'commits') setCommits((value) => ({ ...value, ...patch }));
      else setPulls((value) => ({ ...value, ...patch }));
    };
    update({ loading: true, error: '' });
    try {
      const params = new URLSearchParams({
        snapshotId: snapshot.snapshotId,
        page: String(old.page + 1),
      });
      if (kind === 'commits') {
        const result = await analysisApi<{ commits: Commit[]; hasMore: boolean; page: number }>(
          `/api/progress/commits?${params}`,
          { signal: controller.signal },
        );
        if (key === identity.current && !controller.signal.aborted)
          setCommits((value) => ({
            rows: [...new Map([...value.rows, ...result.commits].map((c) => [c.sha, c])).values()],
            page: result.page,
            hasMore: result.hasMore,
            loaded: true,
            loading: false,
            error: '',
          }));
      } else {
        params.set('state', 'all');
        const result = await analysisApi<{ pullRequests: Pull[]; hasMore: boolean; page: number }>(
          `/api/pr/pulls?${params}`,
          { signal: controller.signal },
        );
        if (key === identity.current && !controller.signal.aborted)
          setPulls((value) => ({
            rows: [
              ...new Map(
                [...value.rows, ...result.pullRequests].map((p) => [p.number, p]),
              ).values(),
            ],
            page: result.page,
            hasMore: result.hasMore,
            loaded: true,
            loading: false,
            error: '',
          }));
      }
    } catch (e) {
      if (key === identity.current && !controller.signal.aborted)
        update({ loading: false, error: (e as Error).message });
    } finally {
      requests.current.delete(controller);
    }
  }
  useEffect(() => {
    if (!report) return;
    void loadGit('commits');
    void loadGit('pulls');
  }, [report?.snapshotId, contextKey]);

  const records = useMemo(() => {
    if (!report) return [];
    const snapshots = new Set(report.snapshots.map((s) => s.snapshotId));
    const names = new Map(report.journeys.map((j) => [j.id, j.title]));
    return Object.values(progress)
      .filter((p) => snapshots.has(p.snapshotId) && p.journeyId.startsWith('repo-'))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => ({
        ...p,
        title: names.get(p.journeyId) || `Saved journey ${p.journeyId}`,
        visitedCount: new Set(p.visited).size,
        answered: Object.keys(p.predictions).length,
        correct: Object.values(p.predictions).filter((a) => a.correct).length,
        done: p.completed || !!p.completedScenarios?.length,
      }));
  }, [report, progress]);
  const timeline = useMemo(
    () =>
      [
        ...records.map((j) => ({
          id: `journey:${j.journeyId}`,
          time: j.updatedAt,
          title: j.title,
          detail: `${j.done ? 'Completed path' : 'In progress'} · ${j.visitedCount} visited events`,
          kind: 'Journey checkpoint',
        })),
        ...(report?.attempts || []).map((a) => ({
          id: a.id,
          time: a.createdAt,
          title: a.title || a.taskId,
          detail: `${a.difficulty} · ${a.reviewStatus ? `AI review ${a.reviewStatus}` : `syntax ${a.status} (not AI reviewed)`}`,
          kind: 'Practice attempt',
        })),
        ...(report?.quizzes || []).map((q) => ({
          id: q.id,
          time: q.lastAnsweredAt || q.createdAt,
          title: `${q.difficulty} quiz`,
          detail: `${q.correct}/${q.answered} correct · ${q.answered}/${q.questions} answered`,
          kind: 'Quiz session',
        })),
        ...(report?.comparisons || []).map((p) => ({
          id: p.id,
          time: p.createdAt,
          title: `PR #${p.number}: ${p.title}`,
          detail: `${p.filesChanged ?? 0} changed files`,
          kind: 'PR comparison',
        })),
      ]
        .filter((e) => Number.isFinite(Date.parse(e.time)))
        .sort((a, b) => b.time.localeCompare(a.time)),
    [records, report],
  );
  const matches = (value: string) => value.toLowerCase().includes(search.toLowerCase());
  const show = (name: string) => tab === 'Overview' || tab === name;
  const more = report && Object.values(report.hasMore).some(Boolean);
  function exportReport() {
    if (!report) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            schema: 2,
            ...report,
            journeyProgress: records,
            timeline,
            github: {
              commits: commits.rows,
              pullRequests: pulls.rows,
              commitsHaveMore: commits.hasMore,
              pullRequestsHaveMore: pulls.hasMore,
            },
            scope:
              'Selected repository; saved learner activity. GitHub activity is repository-wide. Only loaded detail pages are exported; summaries include all matching records.',
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'codebase-mentor-progress.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="repository-progress-page">
      <PageHeading
        eyebrow="MY PROGRESS"
        title="My Progress & Updates"
        description="Your saved journeys, practice results, and repository activity in one place."
        actions={
          <>
            <Button
              icon={RefreshCw}
              onClick={() => {
                refreshJourneys();
                setRevision((r) => r + 1);
              }}
            >
              Refresh
            </Button>
            <Button icon={Download} disabled={!report} onClick={exportReport}>
              Export report
            </Button>
            <Button
              onClick={() => {
                const previous = tab;
                flushSync(() => setTab('Overview'));
                window.print();
                setTab(previous);
              }}
            >
              Print / Save as PDF
            </Button>
          </>
        }
      />
      <div className="rp-scope">
        <div>
          <strong>
            {snapshot?.repository.replace('https://github.com/', '') || 'Choose a repository'}
          </strong>
          <span>
            {snapshot
              ? `Selected commit ${snapshot.commit.slice(0, 12)} · Learning totals cover saved versions of this repository.`
              : 'Analyze a repository to see real progress.'}
          </span>
        </div>
        <button onClick={onSample}>Prepared sample activity</button>
      </div>
      {!snapshot ? (
        <div className="panel rp-empty">
          <BookOpen size={28} />
          <h2>Start with your repository</h2>
          <p>
            Your sample records remain available. Real journeys and practice will appear here after
            repository analysis.
          </p>
          <Link className="button button-primary" to="/repository">
            Choose repository
          </Link>
        </div>
      ) : (
        <>
          {(error || journeyError) && (
            <div className="rp-error" role="alert">
              {error || journeyError}
              <button
                onClick={() => {
                  refreshJourneys();
                  setRevision((r) => r + 1);
                }}
              >
                Retry
              </button>
            </div>
          )}
          {(!ready || (loading && !report)) && (
            <div className="panel rp-empty" role="status">
              Loading saved progress…
            </div>
          )}
          {report && (
            <>
              <div className="rp-stats">
                {[
                  [
                    BookOpen,
                    'Journey records',
                    records.length,
                    `${records.filter((j) => j.done).length} with a completed path · ${records.filter((j) => !j.done).length} in progress`,
                  ],
                  [
                    CheckCircle2,
                    'Events explored',
                    records.reduce((n, j) => n + j.visitedCount, 0),
                    'Unique visited IDs within each saved journey record',
                  ],
                  [
                    Target,
                    'Journey predictions',
                    `${records.reduce((n, j) => n + j.correct, 0)} / ${records.reduce((n, j) => n + j.answered, 0)}`,
                    'Correct / recorded answers',
                  ],
                  [
                    FlaskConical,
                    'Practice attempts',
                    report.summary.attempts,
                    `${report.summary.tasksAttempted} tasks attempted; ${report.summary.tasksCompleted} completed; ${report.summary.reviewsPassed} AI reviews passed`,
                  ],
                  [
                    Target,
                    'Quiz answers (learner)',
                    `${report.summary.quizCorrect} / ${report.summary.quizAnswered}`,
                    `${report.summary.quizSessions} sessions · ${report.summary.quizAnswered ? Math.round((report.summary.quizCorrect / report.summary.quizAnswered) * 100) + '% correct' : 'Not assessed'}`,
                  ],
                  [
                    GitPullRequest,
                    'Saved PR comparisons',
                    report.summary.comparisons,
                    'Repository analysis records; not PRs authored by you',
                  ],
                  [
                    GitCommitHorizontal,
                    'Analysed commits',
                    report.summary.commitsAnalyzed,
                    `${report.summary.snapshots} saved snapshots`,
                  ],
                  [
                    GitCommitHorizontal,
                    'GitHub activity loaded',
                    `${commits.rows.length} commits · ${pulls.rows.length} PRs`,
                    'Load GitHub activity below to browse repository history',
                  ],
                ].map(([Icon, title, value, note]) => {
                  const MetricIcon = Icon as typeof BookOpen;
                  return (
                    <div className="panel rp-stat" key={String(title)}>
                      <MetricIcon size={18} />
                      <span>{String(title)}</span>
                      <strong>{String(value)}</strong>
                      <small>{String(note)}</small>
                    </div>
                  );
                })}
              </div>
              <div className="rp-toolbar">
                <nav aria-label="Progress report sections">
                  {['Overview', 'Journeys', 'Practice & quizzes', 'Commits & PRs', 'Timeline'].map(
                    (name) => (
                      <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>
                        {name}
                      </button>
                    ),
                  )}
                </nav>
                <input
                  aria-label="Search progress records"
                  placeholder="Search recorded activity…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {show('Journeys') && (
                <section className="panel rp-section">
                  <h2>
                    Journey progress <span>{records.length}</span>
                  </h2>
                  <p>
                    Latest saved checkpoints from{' '}
                    {account ? 'your signed-in account' : 'this browser'}. Earlier individual clicks
                    are not stored.
                  </p>
                  <div className="rp-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Journey</th>
                          <th>Status</th>
                          <th>Events visited</th>
                          <th>Predictions</th>
                          <th>Completed paths</th>
                          <th>Last saved</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records
                          .filter((j) => matches(j.title))
                          .map((j) => (
                            <tr key={j.journeyId}>
                              <td>
                                <Link
                                  to={`/learn/${encodeURIComponent(j.journeyId)}?resume=1&sourceSnapshot=${encodeURIComponent(j.snapshotId)}`}
                                >
                                  {j.title} →
                                </Link>
                                <small>{j.snapshotId}</small>
                              </td>
                              <td>
                                <span className={`rp-pill ${j.done ? 'good' : ''}`}>
                                  {j.done ? 'Completed path' : 'In progress'}
                                </span>
                              </td>
                              <td>{j.visitedCount}</td>
                              <td>
                                {j.correct} / {j.answered} correct
                              </td>
                              <td>{j.completedScenarios?.length || (j.completed ? 1 : 0)}</td>
                              <td>{date(j.updatedAt)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {!records.filter((j) => matches(j.title)).length && (
                    <Empty
                      text={
                        records.length
                          ? 'No matching journeys.'
                          : 'No saved repository journeys yet.'
                      }
                      to="/learn"
                      action="Explore My Learning Path"
                    />
                  )}
                </section>
              )}
              {show('Practice & quizzes') && (
                <div className="rp-two-column">
                  <section className="panel rp-section">
                    <h2>
                      Practice history <span>{report.summary.attempts}</span>
                    </h2>
                    <p>
                      Saved attempts for this browser's existing practice learner ID. Checks verify
                      syntax and use AI review for new submissions. Completed tasks passed AI review; runtime tests are not executed.
                    </p>
                    {report.attempts
                      .filter((a) => matches(a.title || a.taskId))
                      .map((a) => (
                        <article className="rp-record" key={a.id}>
                          <strong>{a.title || a.taskId}</strong>
                          <span className={`rp-pill ${a.reviewStatus === 'passed' ? 'good' : ''}`}>
                            {a.reviewStatus ? `AI review ${a.reviewStatus}` : `Syntax ${a.status}; not AI reviewed`}
                          </span>
                          <small>
                            {a.difficulty} · {date(a.createdAt)} · snapshot {a.snapshotId}
                          </small>
                        </article>
                      ))}
                    {!report.attempts.filter((a) => matches(a.title || a.taskId)).length && (
                      <Empty
                        text="No matching saved practice attempts."
                        to="/practice"
                        action="Open Practice"
                      />
                    )}
                  </section>
                  <section className="panel rp-section">
                    <h2>
                      Quiz performance <span>{report.summary.quizSessions}</span>
                    </h2>
                    <p>
                      Repository and general learning quizzes for this learner. Scores include
                      answered questions only.
                    </p>
                    {report.quizzes
                      .filter((q) => matches(`${q.difficulty} quiz`))
                      .map((q) => (
                        <article className="rp-record" key={q.id}>
                          <strong>
                            {q.difficulty}{' '}
                            {q.snapshotId === 'learning-journey'
                              ? 'general learning'
                              : 'repository'}{' '}
                            quiz
                          </strong>
                          <span className="rp-pill">
                            {q.answered === q.questions ? 'Completed' : 'In progress'}
                          </span>
                          <p>
                            {q.correct} / {q.answered} correct · {q.answered} / {q.questions}{' '}
                            answered
                          </p>
                          <progress
                            value={q.answered}
                            max={Math.max(1, q.questions)}
                            aria-label="Quiz questions answered"
                          />
                          <small>
                            {date(q.lastAnsweredAt || q.createdAt)} · snapshot {q.snapshotId}
                          </small>
                        </article>
                      ))}
                    {!report.quizzes.filter((q) => matches(`${q.difficulty} quiz`)).length && (
                      <Empty
                        text="No matching repository quiz sessions."
                        to="/practice"
                        action="Open quizzes"
                      />
                    )}
                  </section>
                </div>
              )}
              {show('Commits & PRs') && (
                <>
                  <section className="panel rp-section">
                    <h2>
                      Saved PR impact analyses <span>{report.summary.comparisons}</span>
                    </h2>
                    <p>Comparisons saved for this repository on this backend.</p>
                    {report.comparisons
                      .filter((p) => matches(`#${p.number} ${p.title}`))
                      .map((p) => (
                        <article className="rp-record" key={p.id}>
                          <a
                            href={`${report.repository}/pull/${p.number}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            #{p.number} {p.title} ↗
                          </a>
                          <span>{p.filesChanged ?? 0} changed files</span>
                          <small>
                            {date(p.createdAt)} · comparison {p.id}
                          </small>
                        </article>
                      ))}
                    {!report.comparisons.filter((p) => matches(`#${p.number} ${p.title}`))
                      .length && (
                      <Empty
                        text="No matching saved PR comparisons."
                        to="/changes"
                        action="Open PR Impact"
                      />
                    )}
                  </section>
                  <div className="rp-two-column">
                    <section className="panel rp-section">
                      <h2>
                        GitHub commit history <span>{commits.rows.length} loaded</span>
                      </h2>
                      <p>
                        Repository-wide history through the selected analysed commit. These are not
                        personal contribution counts.
                      </p>
                      {commits.rows
                        .filter((c) => matches(`${c.message} ${c.author} ${c.sha}`))
                        .map((c) => (
                          <article className="rp-record" key={c.sha}>
                            <a href={c.url} target="_blank" rel="noreferrer">
                              {c.message || c.sha.slice(0, 12)} ↗
                            </a>
                            <small>
                              {c.sha.slice(0, 12)} · {c.author} · {date(c.date)}
                            </small>
                          </article>
                        ))}
                      {commits.error && (
                        <p role="alert" className="rp-error">
                          {commits.error}
                        </p>
                      )}
                      {commits.loaded && !commits.rows.length && (
                        <p>No commits returned by GitHub.</p>
                      )}
                      {(!commits.loaded || commits.hasMore) && (
                        <Button disabled={commits.loading} onClick={() => void loadGit('commits')}>
                          {commits.loading
                            ? 'Loading commits…'
                            : commits.loaded
                              ? 'Load more commits'
                              : 'Load commits from GitHub'}
                        </Button>
                      )}
                    </section>
                    <section className="panel rp-section">
                      <h2>
                        GitHub pull requests <span>{pulls.rows.length} loaded</span>
                      </h2>
                      <p>
                        Open, closed, and merged PRs from the selected repository. Author names come
                        from GitHub.
                      </p>
                      {pulls.rows
                        .filter((p) => matches(`${p.number} ${p.title} ${p.author}`))
                        .map((p) => (
                          <article className="rp-record" key={p.number}>
                            <a href={p.url} target="_blank" rel="noreferrer">
                              #{p.number} {p.title} ↗
                            </a>
                            <span className={`rp-pill ${p.merged ? 'good' : ''}`}>
                              {p.merged ? 'Merged' : p.draft ? 'Draft' : p.state}
                            </span>
                            <small>
                              {p.author} · updated {date(p.updatedAt)}
                            </small>
                          </article>
                        ))}
                      {pulls.error && (
                        <p role="alert" className="rp-error">
                          {pulls.error}
                        </p>
                      )}
                      {pulls.loaded && !pulls.rows.length && (
                        <p>No pull requests returned by GitHub.</p>
                      )}
                      {(!pulls.loaded || pulls.hasMore) && (
                        <Button disabled={pulls.loading} onClick={() => void loadGit('pulls')}>
                          {pulls.loading
                            ? 'Loading PRs…'
                            : pulls.loaded
                              ? 'Load more PRs'
                              : 'Load PRs from GitHub'}
                        </Button>
                      )}
                    </section>
                  </div>
                </>
              )}
              {show('Timeline') && (
                <section className="panel rp-section">
                  <h2>
                    Recorded activity timeline <span>{timeline.length} loaded</span>
                  </h2>
                  <p>
                    Saved journey updates, practice attempts, quiz sessions, and PR comparisons.
                    Load additional pages to include older activity.
                  </p>
                  {timeline
                    .filter((e) => matches(`${e.title} ${e.kind}`))
                    .map((e) => (
                      <article className="rp-record" key={e.id}>
                        <strong>{e.title}</strong>
                        <span className="rp-pill">{e.kind}</span>
                        <small>
                          {date(e.time)} · {e.detail}
                        </small>
                      </article>
                    ))}
                  {!timeline.length && <p>No dated activity recorded yet.</p>}
                </section>
              )}
              {more && (
                <div className="rp-load-more">
                  <Button disabled={loading} onClick={() => void loadMore()}>
                    {loading ? 'Loading activity…' : 'Load more saved activity'}
                  </Button>
                  <small>
                    Totals cover every matching record. Details are loaded in pages of 25.
                  </small>
                </div>
              )}
              <details className="panel rp-section">
                <summary>Saved snapshots ({report.snapshots.length})</summary>
                {report.snapshots.map((s) => (
                  <div className="rp-snapshot" key={s.snapshotId}>
                    <code>{s.commit}</code>
                    <small>
                      Snapshot {s.snapshotId}
                      {s.snapshotId === report.snapshotId ? ' · selected' : ''}
                    </small>
                  </div>
                ))}
              </details>
              <p className="rp-footnote">
                Updated {date(report.generatedAt)}. Practice uses this browser's learner ID; journey
                progress uses {account ? 'your account' : 'browser storage'}. Prepared sample
                activity is kept separately. General learning quizzes are not tied to a repository
                and are labelled separately.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
function Empty({ text, to, action }: { text: string; to: string; action: string }) {
  return (
    <div className="rp-empty">
      <p>{text}</p>
      <Link to={to}>{action} →</Link>
    </div>
  );
}
