import { useEffect, useState } from 'react';
import { GitPullRequest, LoaderCircle, ArrowUpRight, RefreshCw, Download } from 'lucide-react';
import { analysisApi } from '../services/analysisApi';
import type { RepositorySnapshot } from '../domain/analysisTypes';
import { BackendArchitecture } from './BackendArchitecture';
import { ComponentDiscussion } from './ComponentDiscussion';
import { PRMergeSimulator } from './PRMergeSimulator';
import { Modal } from './UI';
import { Link } from 'react-router-dom';
import { useRepositoryAnalysis } from '../state/RepositoryAnalysisContext';
import '../styles/pr-comparison.css';

type Ref = RepositorySnapshot['references'][number];
type Component = { id: string; name: string; role: string; reference: Ref };
type Changed = {
  status: string;
  before: Component | null;
  after: Component | null;
  ambiguous: boolean;
};
type File = {
  path: string;
  previousPath: string | null;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
  hidden: boolean;
  patchLimited: boolean;
};
type Manifest = {
  path: string;
  packageManager: string | null;
  engines: Record<string, string>;
  scripts: Record<string, string>;
};
type Result = {
  id: string;
  createdAt: string;
  beforeSnapshotId: string;
  afterSnapshotId: string;
  pr: {
    url: string;
    title: string;
    number: number;
    state: string;
    baseRepository: string;
    headRepository: string;
    baseCommit: string;
    headCommit: string;
    targetCommit: string;
    baseBranch: string;
    headBranch: string;
    files: File[];
    limited: boolean;
    changedFiles: number;
  };
  components: Changed[];
  edges: { added: unknown[]; removed: unknown[] };
  impact: {
    before: (Component & { depth: number; via: string })[];
    after: (Component & { depth: number; via: string })[];
  };
  setup: {
    environment: { name: string; change: string; path: string }[];
    dependencies: {
      path: string;
      section: string;
      name: string;
      before: string | null;
      after: string | null;
    }[];
    scripts: { path: string; name: string; before: string | null; after: string | null }[];
    migrations: { path: string; status: string }[];
    guides: { before: Manifest[]; after: Manifest[] };
  };
  warnings: string[];
};
type Job = {
  id: string;
  status: string;
  progress: number;
  message: string;
  comparison_id: string | null;
  url?: string | null;
};
type Side = 'before' | 'after';
const tabs = [
  'Overview',
  'Architecture',
  'Journey comparison',
  'Changed files & diff',
  'Setup & run guide',
  'Merge simulator',
];
export function PullRequestChanges({ onDemo }: { onDemo: () => void }) {
  const { snapshot: activeRepository, loading: repositoryLoading } = useRepositoryAnalysis();
  const [url, setUrl] = useState('');
  const [pulls, setPulls] = useState<
    {
      number: number;
      title: string;
      url: string;
      draft: boolean;
      merged: boolean;
      head: string;
      base: string;
    }[]
  >([]);
  const [pullState, setPullState] = useState<'open' | 'closed' | 'all'>('open');
  const [pullPage, setPullPage] = useState(1),
    [pullRefresh, setPullRefresh] = useState(0);
  const [pullLoading, setPullLoading] = useState(false),
    [pullError, setPullError] = useState(''),
    [hasMore, setHasMore] = useState(false);
  const [jobId, setJobId] = useState(() => localStorage.getItem('mentor-pr-job') || '');
  const [job, setJob] = useState<Job | null>(null);
  const [interrupted, setInterrupted] = useState<{ url: string } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [snapshots, setSnapshots] = useState<Record<Side, RepositorySnapshot> | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [tab, setTab] = useState(tabs[0]),
    [path, setPath] = useState('');
  const [mode, setMode] = useState<'system' | 'request' | 'services'>('system');
  const [discuss, setDiscuss] = useState<{ side: Side; id: string } | null>(null);
  const [version, setVersion] = useState<Side>('after');
  const repositoryId = activeRepository?.snapshotId || result?.beforeSnapshotId || '';
  const repositoryName = activeRepository?.repository || result?.pr.baseRepository || '';
  useEffect(() => {
    setPullPage(1);
    setUrl('');
  }, [repositoryId, pullState]);
  useEffect(() => {
    if (!repositoryId || repositoryLoading) return;
    const controller = new AbortController();
    setPullLoading(true);
    setHasMore(false);
    setPullError('');
    setPulls([]);
    setUrl('');
    analysisApi<{ pullRequests: typeof pulls; hasMore: boolean }>(
      `/api/pr/pulls?snapshotId=${encodeURIComponent(repositoryId)}&state=${pullState}&page=${pullPage}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setPulls(value.pullRequests);
          setHasMore(value.hasMore);
          setUrl(value.pullRequests[0]?.url || '');
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setPullError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPullLoading(false);
      });
    return () => controller.abort();
  }, [repositoryId, repositoryLoading, pullState, pullPage, pullRefresh]);
  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setPending(true);
    setError('');
    setResult(null);
    setSnapshots(null);
    setDiscuss(null);
    async function poll() {
      try {
        const next = await analysisApi<Job>(`/api/pr/analyses/${jobId}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setJob(next);
        if (next.status === 'failed') {
          if (/server restarted/i.test(next.message)) {
            setInterrupted({ url: next.url || '' });
            setPending(false);
            try {
              if (localStorage.getItem('mentor-pr-job') === jobId)
                localStorage.removeItem('mentor-pr-job');
            } catch {}
            setJobId('');
            return;
          }
          throw new Error(next.message);
        }
        if (next.status === 'complete' && next.comparison_id) {
          const value = await analysisApi<Result>(`/api/pr/comparisons/${next.comparison_id}`, {
            signal: controller.signal,
          });
          const [before, after] = await Promise.all(
            [value.beforeSnapshotId, value.afterSnapshotId].map((id) =>
              analysisApi<RepositorySnapshot>(`/api/snapshots/${id}`, {
                signal: controller.signal,
              }),
            ),
          );
          if (controller.signal.aborted) return;
          if (before.commit !== value.pr.baseCommit || after.commit !== value.pr.headCommit)
            throw new Error('Comparison source versions do not match. Reanalyze this PR.');
          setResult(value);
          setSnapshots({ before, after });
          setPath(value.pr.files[0]?.path || '');
          setTab(tabs[0]);
          setPending(false);
        } else timer = setTimeout(() => void poll(), 1000);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError((e as Error).message);
          setPending(false);
        }
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobId]);
  async function start(selectedUrl = url) {
    if (!selectedUrl.trim()) return;
    setPending(true);
    setError('');
    setInterrupted(null);
    setJob(null);
    try {
      const value = await analysisApi<{ id: string }>('/api/pr/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: selectedUrl.trim() }),
      });
      localStorage.setItem('mentor-pr-job', value.id);
      setJobId(value.id);
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  }
  const file = result?.pr.files.find((f) => f.path === path);
  function sourceUrl(side: Side, filePath: string) {
    if (!result) return '#';
    return `${side === 'before' ? result.pr.baseRepository : result.pr.headRepository}/blob/${side === 'before' ? result.pr.baseCommit : result.pr.headCommit}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  }
  function inspect(side: Side, id: string) {
    const c = snapshots?.[side].components.find((c) => c.id === id);
    const ref = snapshots?.[side].references.find((r) => r.id === c?.referenceId);
    if (ref) {
      const found = result?.pr.files.find(
        (f) => f.path === ref.file || f.previousPath === ref.file,
      );
      if (found) setPath(found.path);
    }
    setDiscuss({ side, id });
  }
  function componentButton(item: Component, side: Side) {
    return (
      <button className="pr-component-link" onClick={() => inspect(side, item.id)}>
        {item.name}
        <small>
          {item.reference.file}:{item.reference.startLine} · {side}
        </small>
        <ArrowUpRight size={13} />
      </button>
    );
  }
  return (
    <div className="pr-changes">
      <header className="pr-title">
        <div>
          <span className="tiny-label">CHANGES / REAL GITHUB EVIDENCE</span>
          <h1>Understand your pull request.</h1>
          <p>
            Compare the actual code, follow its connections, and review setup changes before you run
            it.
          </p>
        </div>
        <button onClick={onDemo}>View prepared demo</button>
      </header>
      <form
        className="pr-input"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <label htmlFor="pr-select-live">Pull requests from your repository</label>
        {repositoryName && (
          <p className="pr-selected-repository">
            {repositoryName.replace('https://github.com/', '')}
          </p>
        )}
        {(repositoryLoading || pullLoading) && (
          <p role="status">
            <LoaderCircle size={14} className="mentor-spin" /> Loading repository pull requests…
          </p>
        )}
        {!repositoryId && !repositoryLoading && (
          <p>
            Analyze a repository first, then its PRs will appear here automatically.{' '}
            <Link to="/repository">Choose repository →</Link>
          </p>
        )}
        {repositoryId && (
          <>
            <div className="pr-version-tabs">
              {(['open', 'closed', 'all'] as const).map((state) => (
                <button
                  type="button"
                  key={state}
                  aria-pressed={pullState === state}
                  disabled={pending}
                  onClick={() => setPullState(state)}
                >
                  {state === 'all'
                    ? 'All PRs'
                    : state === 'closed'
                      ? 'Closed / merged'
                      : 'Open PRs'}
                </button>
              ))}
              <button
                type="button"
                disabled={pullLoading || pending}
                onClick={() => setPullRefresh((n) => n + 1)}
              >
                <RefreshCw size={14} /> Refresh PRs
              </button>
            </div>
            {pullError && (
              <p className="pr-warning" role="alert">
                {pullError}
              </p>
            )}
            {!pullLoading && !pullError && !pulls.length && (
              <p>
                No {pullState === 'all' ? '' : pullState} pull requests found.{' '}
                {pullState === 'open' && (
                  <button type="button" onClick={() => setPullState('closed')}>
                    Show closed / merged PRs
                  </button>
                )}
              </p>
            )}
            <div className="pr-picker-row">
              <select
                id="pr-select-live"
                aria-label="Repository pull request"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={pending || repositoryLoading || pullLoading || !pulls.length}
              >
                <option value="">Choose a pull request</option>
                {pulls.map((pr) => (
                  <option key={pr.number} value={pr.url}>
                    #{pr.number} {pr.title}
                    {pr.draft ? ' · Draft' : pr.merged ? ' · Merged' : ''}
                  </option>
                ))}
              </select>
              <button
                className="pr-analyze-button"
                disabled={pending || repositoryLoading || pullLoading || !url.trim()}
              >
                {pending ? (
                  <LoaderCircle size={16} className="mentor-spin" />
                ) : (
                  <GitPullRequest size={16} />
                )}{' '}
                {pending ? 'Analyzing…' : 'Analyze PR'}
              </button>
            </div>
            {pulls.find((p) => p.url === url) && (
              <small>
                {pulls.find((p) => p.url === url)?.head} → {pulls.find((p) => p.url === url)?.base}
              </small>
            )}
            {(pullPage > 1 || hasMore) && (
              <div className="pr-list-pagination">
                <button
                  type="button"
                  disabled={pullLoading || pending || pullPage === 1}
                  onClick={() => setPullPage((p) => p - 1)}
                >
                  Previous
                </button>
                <small>Page {pullPage}</small>
                <button
                  type="button"
                  disabled={pullLoading || pending || !hasMore || pullPage >= 100}
                  onClick={() => setPullPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
        <small>
          Read-only · JavaScript / TypeScript graphs · Any changed-file patches GitHub provides · No
          repository scripts are executed
        </small>
      </form>
      {interrupted && (
        <div className="pr-interrupted" role="status">
          <div>
            <strong>Previous comparison was interrupted</strong>
            <p>
              The backend restarted before it finished. Your repository is still selected. Start a
              fresh analysis to continue.
            </p>
          </div>
          <div className="pr-actions">
            <button
              disabled={pending || !(interrupted.url || url)}
              onClick={() => void start(interrupted.url || url)}
            >
              <RefreshCw size={14} />
              {interrupted.url ? 'Retry interrupted PR' : 'Analyze selected PR'}
            </button>
            <button onClick={() => setInterrupted(null)}>Dismiss</button>
          </div>
        </div>
      )}
      {pending && (
        <div className="pr-progress" role="status">
          <progress max={100} value={job?.progress || 0} />
          <span>{job?.message || 'Starting comparison…'}</span>
        </div>
      )}
      {error && (
        <div className="pr-warning" role="alert">
          {error}
          <p>
            Check repository access, GitHub rate limits, and the backend connection. Your analysis
            will never fall back to demo data.
          </p>
          <button
            disabled={pending || !(job?.url || url)}
            onClick={() => void start(job?.url || url)}
          >
            <RefreshCw size={14} /> Retry analysis
          </button>
        </div>
      )}
      {!result && !pending && !error && !interrupted && (
        <div className="pr-empty">
          <GitPullRequest size={36} />
          <h2>A review grounded in your PR.</h2>
          <p>
            Select a pull request from your analyzed repository to explore its code and
            commit-pinned evidence.
          </p>
        </div>
      )}
      {result && snapshots && (
        <>
          {activeRepository &&
            activeRepository.repository.toLowerCase() !==
              result.pr.baseRepository.toLowerCase() && (
              <p className="pr-warning">
                The saved result below belongs to{' '}
                {result.pr.baseRepository.replace('https://github.com/', '')}. The PR picker uses
                your currently analyzed repository.
              </p>
            )}
          <div className="pr-summary-live">
            <div>
              <a href={result.pr.url} target="_blank" rel="noreferrer">
                #{result.pr.number} {result.pr.title} ↗
              </a>
              <p>
                {result.pr.headBranch} → {result.pr.baseBranch} · {result.pr.state}
              </p>
              <small>
                Common ancestor {result.pr.baseCommit.slice(0, 12)} → head{' '}
                {result.pr.headCommit.slice(0, 12)} · captured{' '}
                {new Date(result.createdAt).toLocaleString()}
              </small>
            </div>
            <div className="pr-actions">
              <button disabled={pending} onClick={() => void start(result.pr.url)}>
                <RefreshCw size={14} /> Reanalyze
              </button>
              <button
                onClick={() => {
                  const href = URL.createObjectURL(
                    new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
                  );
                  const a = document.createElement('a');
                  a.href = href;
                  a.download = `pr-${result.pr.number}-${result.id}.json`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(href), 1000);
                }}
              >
                <Download size={14} /> Export evidence
              </button>
            </div>
          </div>
          {result.pr.limited && (
            <p className="pr-warning">
              GitHub returned a limited file list. Findings are incomplete.
            </p>
          )}
          <div className="pr-tabs" role="tablist" aria-label="PR comparison views">
            {tabs.map((t) => (
              <button
                key={t}
                id={'pr-tab-' + tabs.indexOf(t)}
                role="tab"
                aria-selected={tab === t}
                aria-controls="pr-results"
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <section id="pr-results" role="tabpanel" aria-labelledby={'pr-tab-' + tabs.indexOf(tab)}>
            <div hidden={tab !== tabs[5]}>
              <PRMergeSimulator key={result.id} comparison={result} />
            </div>
            {tab === tabs[0] && (
              <>
                <div className="pr-stats">
                  {[
                    [result.pr.files.length, 'changed files'],
                    [result.components.length, 'changed components'],
                    [result.edges.added.length, 'added connections'],
                    [result.edges.removed.length, 'removed connections'],
                  ].map(([value, label]) => (
                    <div key={label}>
                      <strong>{value}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <div className="pr-two-columns">
                  <section className="pr-card">
                    <h2>What changed in source</h2>
                    <p>
                      Matched by file, role and name. Ambiguous symbols are not assumed to be the
                      same function.
                    </p>
                    {result.components.slice(0, 100).map((c, i) => (
                      <div className="pr-change-row" key={i}>
                        <span className={'pr-status ' + c.status}>{c.status}</span>
                        {c.before && componentButton(c.before, 'before')}
                        {c.after && componentButton(c.after, 'after')}
                        {c.ambiguous && <small>Ambiguous identity</small>}
                      </div>
                    ))}
                    {!result.components.length && (
                      <p>
                        No changed components were resolved in the supported source. Review the
                        actual file diff and coverage limits.
                      </p>
                    )}
                    {result.components.length > 100 && (
                      <p>Showing 100 components. Export evidence for the full result.</p>
                    )}
                  </section>
                  <section className="pr-card">
                    <h2>Possible downstream impact</h2>
                    <p>
                      Incoming static connections, up to three hops. These are places to review, not
                      detected bugs.
                    </p>
                    <div className="pr-version-tabs">
                      {(['before', 'after'] as const).map((side) => (
                        <button
                          key={side}
                          aria-pressed={version === side}
                          onClick={() => setVersion(side)}
                        >
                          {side}
                        </button>
                      ))}
                    </div>
                    {result.impact[version].slice(0, 50).map((c) => (
                      <div key={c.id}>
                        {componentButton(c, version)}
                        <small>
                          {c.depth} hop(s) · {c.via}
                        </small>
                      </div>
                    ))}
                    {!result.impact[version].length && (
                      <p>
                        No additional incoming connections resolved. Dynamic callers may be missing.
                      </p>
                    )}
                  </section>
                </div>
              </>
            )}
            {(tab === tabs[1] || tab === tabs[2]) && (
              <section className="pr-card">
                <h2>
                  {tab === tabs[1]
                    ? 'Before and after architecture'
                    : 'Source-derived request walkthroughs'}
                </h2>
                <p>
                  Select a version to explore its real graph. Click a component to inspect or
                  discuss its pinned source. Connections do not prove runtime order.
                </p>
                <div className="pr-version-tabs">
                  {(['before', 'after'] as const).map((side) => (
                    <button
                      key={side}
                      aria-pressed={version === side}
                      onClick={() => setVersion(side)}
                    >
                      {side} · {snapshots[side].commit.slice(0, 12)}
                    </button>
                  ))}
                  {tab === tabs[1] && (
                    <select
                      aria-label="Architecture detail"
                      value={mode}
                      onChange={(e) => setMode(e.target.value as typeof mode)}
                    >
                      <option value="system">System overview</option>
                      <option value="services">Services and logic</option>
                      <option value="request">Request path</option>
                    </select>
                  )}
                </div>
                <BackendArchitecture
                  key={version + tab}
                  snapshot={snapshots[version]}
                  mode={tab === tabs[2] ? 'request' : mode}
                  onModeChange={(m) => {
                    if (m === 'overview') setTab(tabs[0]);
                    else if (m === 'system' || m === 'services' || m === 'request') setMode(m);
                  }}
                  onInspect={(id) => inspect(version, id)}
                />
                <p>
                  {result.edges.added.length} added connections · {result.edges.removed.length}{' '}
                  removed connections across versions. Matching is structural, not semantic.
                </p>
              </section>
            )}
            {tab === tabs[3] && (
              <div className="pr-diff-layout">
                <nav className="pr-card" aria-label="Changed files">
                  {result.pr.files.map((f) => (
                    <button
                      key={f.path}
                      className="pr-file"
                      aria-current={path === f.path ? 'true' : undefined}
                      onClick={() => setPath(f.path)}
                    >
                      <span>{f.path}</span>
                      <small>
                        {f.status} · +{f.additions} / −{f.deletions}
                      </small>
                    </button>
                  ))}
                </nav>
                <section className="pr-card pr-diff-card">
                  {file ? (
                    <>
                      <h2>{file.path}</h2>
                      <div className="pr-actions">
                        {file.status !== 'added' && (
                          <a
                            href={sourceUrl('before', file.previousPath || file.path)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Before source ↗
                          </a>
                        )}
                        {file.status !== 'removed' && (
                          <a href={sourceUrl('after', file.path)} target="_blank" rel="noreferrer">
                            After source ↗
                          </a>
                        )}
                      </div>
                      {file.hidden ? (
                        <p>
                          Environment and sensitive-file contents are hidden. Template variable
                          names, when available, appear in Setup.
                        </p>
                      ) : file.patch ? (
                        <Patch text={file.patch} />
                      ) : (
                        <p>
                          GitHub did not supply a text patch for this file. It may be binary,
                          unchanged relative to this comparison, or too large.
                        </p>
                      )}
                      {file.patchLimited && (
                        <p className="pr-warning">
                          Patch missing or truncated. Use the pinned source links to review the
                          complete file.
                        </p>
                      )}
                      <h3>Changed components in this file</h3>
                      {result.components
                        .filter(
                          (c) =>
                            c.after?.reference.file === file.path ||
                            c.before?.reference.file === (file.previousPath || file.path),
                        )
                        .map((c, i) => (
                          <div className="pr-change-row" key={i}>
                            {c.before && componentButton(c.before, 'before')}
                            {c.after && componentButton(c.after, 'after')}
                          </div>
                        ))}
                    </>
                  ) : (
                    <p>No file changes returned.</p>
                  )}
                </section>
              </div>
            )}
            {tab === tabs[4] && (
              <>
                <p className="pr-warning">
                  Setup guidance is derived from captured source and manifests. Nothing below has
                  been installed, migrated, or execution-verified.
                </p>
                <div className="pr-two-columns">
                  <section className="pr-card">
                    <h2>Environment template changes</h2>
                    <p>
                      Names only; requiredness is unknown. An assignment change may appear as both
                      removal and addition.
                    </p>
                    {result.setup.environment.map((e, i) => (
                      <p key={i}>
                        <span className="pr-status">{e.change}</span> <code>{e.name}</code>
                        <small> · {e.path}</small>
                      </p>
                    ))}
                    {!result.setup.environment.length && (
                      <p>
                        No template variable names found in the available patches. This does not
                        establish that configuration is unchanged.
                      </p>
                    )}
                    <h2>Dependencies</h2>
                    {result.setup.dependencies.map((d, i) => (
                      <p key={i}>
                        <strong>{d.name}</strong> {d.before || 'not present'} →{' '}
                        {d.after || 'removed'}
                        <small>
                          {' '}
                          · {d.path} / {d.section}
                        </small>
                      </p>
                    ))}
                    {!result.setup.dependencies.length && (
                      <p>
                        No dependency changes found in captured package manifests. Lockfiles and
                        external package resolution are not compared.
                      </p>
                    )}
                    <h2>Potential migrations</h2>
                    {result.setup.migrations.map((m) => (
                      <p key={m.path}>
                        {m.status}:{' '}
                        <a
                          href={sourceUrl(m.status === 'removed' ? 'before' : 'after', m.path)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {m.path}
                        </a>
                      </p>
                    ))}
                    {!result.setup.migrations.length && (
                      <p>
                        No changed paths matched migration/SQL naming rules. Custom migration
                        systems may be missed.
                      </p>
                    )}
                  </section>
                  <section className="pr-card">
                    <h2>Version-specific run recipes</h2>
                    <div className="pr-version-tabs">
                      {(['before', 'after'] as const).map((side) => (
                        <button
                          key={side}
                          aria-pressed={version === side}
                          onClick={() => setVersion(side)}
                        >
                          {side}
                        </button>
                      ))}
                    </div>
                    <p>
                      Review the exact commit <code>{snapshots[version].commit}</code> in an
                      isolated checkout. Commands below are declared script names, not verified
                      startup instructions.
                    </p>
                    {result.setup.guides[version].map((m) => (
                      <article className="pr-manifest" key={m.path}>
                        <h3>
                          <a href={sourceUrl(version, m.path)} target="_blank" rel="noreferrer">
                            {m.path} ↗
                          </a>
                        </h3>
                        <p>
                          Declared package manager: {m.packageManager || 'not declared'} · engines:{' '}
                          {JSON.stringify(m.engines)}
                        </p>
                        <ol>
                          <li>
                            Use this manifest’s folder and review its README at the selected commit.
                          </li>
                          <li>
                            Install dependencies using the repository’s declared package manager and
                            lockfile policy. No install command is inferred when it is unknown.
                          </li>
                          <li>
                            Configure the required variable names after reviewing source; values and
                            defaults are not supplied here.
                          </li>
                          <li>Review the declared scripts below before running them.</li>
                        </ol>
                        {Object.entries(m.scripts).map(([name, command]) => (
                          <div key={name}>
                            <strong>{name}</strong>
                            <pre>{command}</pre>
                          </div>
                        ))}
                      </article>
                    ))}
                    {!result.setup.guides[version].length && (
                      <p>No usable package manifests captured. Startup commands are unknown.</p>
                    )}
                    <h3>Changed scripts</h3>
                    {result.setup.scripts.map((s, i) => (
                      <p key={i}>
                        <strong>
                          {s.path} · {s.name}
                        </strong>
                        <code>
                          {s.before || 'not present'} → {s.after || 'removed'}
                        </code>
                      </p>
                    ))}
                  </section>
                </div>
              </>
            )}
          </section>
          <details className="pr-card pr-limits">
            <summary>Evidence coverage and limitations</summary>
            <ul>
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            <p>
              Before parser limitations: {snapshots.before.report.limitations.join(' ')} After
              parser limitations: {snapshots.after.report.limitations.join(' ')}
            </p>
          </details>
          {discuss && (
            <Modal
              open
              onOpenChange={(open) => {
                if (!open) setDiscuss(null);
              }}
              title="Discuss PR source"
              description="The mentor uses the selected version only. Switch explicitly to compare the other version; this is not a combined two-version AI context."
              className="pr-mentor-dialog"
            >
              <div className="pr-version-tabs">
                {(['before', 'after'] as const).map((side) => {
                  const matched = result.components.find((c) => c[discuss.side]?.id === discuss.id);
                  const target = matched?.[side];
                  return (
                    <button
                      key={side}
                      disabled={!target && side !== discuss.side}
                      aria-pressed={discuss.side === side}
                      onClick={() => target && setDiscuss({ side, id: target.id })}
                    >
                      {side}
                    </button>
                  );
                })}
              </div>
              <a
                className="pr-source-link"
                href={
                  snapshots[discuss.side].references.find(
                    (r) =>
                      r.id ===
                      snapshots[discuss.side].components.find((c) => c.id === discuss.id)
                        ?.referenceId,
                  )?.url
                }
                target="_blank"
                rel="noreferrer"
              >
                View selected source at exact commit ↗
              </a>
              <ComponentDiscussion snapshot={snapshots[discuss.side]} componentId={discuss.id} />
            </Modal>
          )}
        </>
      )}
    </div>
  );
}
function Patch({ text }: { text: string }) {
  let old = 0,
    next = 0;
  return (
    <pre className="pr-patch" tabIndex={0} aria-label="GitHub unified diff">
      {text.split('\n').map((line, i) => {
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk) {
          old = Number(hunk[1]);
          next = Number(hunk[2]);
          return (
            <div className="hunk" key={i}>
              {line}
            </div>
          );
        }
        const addition = line.startsWith('+'),
          removal = line.startsWith('-'),
          meta = line.startsWith('\\');
        return (
          <div key={i} className={addition ? 'added' : removal ? 'removed' : ''}>
            <span>{addition || meta ? '' : old++}</span>
            <span>{removal || meta ? '' : next++}</span>
            <code>{line}</code>
          </div>
        );
      })}
    </pre>
  );
}
