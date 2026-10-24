import { useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitFork,
  GitPullRequest,
  HeartHandshake,
  LoaderCircle,
  Sparkles,
  Users,
} from 'lucide-react';
import { analysisApi } from '../services/analysisApi';
import { useRepositoryAnalysis } from '../state/RepositoryAnalysisContext';
import '../styles/first-contribution.css';

type ContributionPreferences = {
  skills: string[];
  interests: string[];
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
};
type ContributionIssue = {
  number: number;
  title: string;
  url: string;
  state: string;
  body: string;
  labels: string[];
  updatedAt: string;
  comments: number;
  score: number;
  reason: string;
  difficulty: string;
  skills: string[];
  files: string[];
};
type AnalysisResult = {
  repository: { url: string; name: string; snapshotId: string; commit: string };
  signals: {
    latestCommit: {
      sha: string | null;
      date: string | null;
      daysAgo: number | null;
      explanation: string;
    };
    pullRequests: {
      open: number | null;
      closedObserved: number | null;
      openPageCapped: boolean;
      closedPageCapped: boolean;
      recentlyUpdatedClosed: number;
      recentPRs: { createdAt: string; updatedAt: string; mergedAt: string | null }[];
    };
    issues: {
      openObserved: number;
      pageCapped: boolean;
      beginnerLabelCount: number;
      recentlyUpdated: { number: number; title: string; updatedAt: string }[];
    };
    contributors: {
      observed: number;
      pageCapped: boolean;
      leader: string | null;
      leaderShare: number | null;
      totalObservedContributions: number;
    };
    repository: {
      license: string | null;
      releaseCountObserved: number | null;
      latestRelease: { name: string; publishedAt: string } | null;
      hasReadme: boolean;
      hasContributionGuide: boolean;
      hasCodeOfConduct: boolean;
      hasTestConfig: boolean;
    };
  };
  guidanceLinks: { contributing: string | null; codeOfConduct: string | null };
  issues: ContributionIssue[];
  recommendationMode: 'rules' | 'ai-assisted';
  limitations: string[];
};
type ContributionPlan = {
  summary: string;
  expectedOutcome: string;
  relevantFiles: string[];
  implementationSteps: string[];
  setupSteps: string[];
  commands: string[];
  gitCommands: string[];
  tests: string[];
  testing?: string[];
  maintainerQuestions: string[];
  definitionOfDone: string[];
  mode: 'fallback' | 'ai-assisted';
  snapshotId: string;
};

function preferenceList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function isDifficulty(value: string): value is NonNullable<ContributionPreferences['difficulty']> {
  return value === 'beginner' || value === 'intermediate' || value === 'advanced';
}

function dateLabel(value: string | null) {
  if (!value) return 'Unavailable';
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86400000));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function SignalCard({
  icon: Icon,
  title,
  value,
  children,
}: {
  icon: typeof Clock3;
  title: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <article className="contribution-signal-card">
      <div className="contribution-signal-icon">
        <Icon size={17} />
      </div>
      <div className="contribution-signal-heading">
        <h3>{title}</h3>
        <strong>{value}</strong>
      </div>
      <p>{children}</p>
    </article>
  );
}

export default function FirstContribution() {
  const { snapshot, loading: snapshotLoading, error: snapshotError } = useRepositoryAnalysis();
  const [skillsText, setSkillsText] = useState('');
  const [interestsText, setInterestsText] = useState('');
  const [difficulty, setDifficulty] = useState<ContributionPreferences['difficulty'] | ''>('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<number | null>(null);
  const [plan, setPlan] = useState<ContributionPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState('');

  const preferences: ContributionPreferences = {
    skills: preferenceList(skillsText),
    interests: preferenceList(interestsText),
    ...(difficulty ? { difficulty } : {}),
  };

  async function findOpportunities() {
    if (!snapshot) return;
    setAnalyzing(true);
    setError('');
    setPlan(null);
    setSelectedIssue(null);
    try {
      const next = await analysisApi<AnalysisResult>('/api/contributions/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: snapshot.snapshotId, preferences }),
      });
      if (next.repository.snapshotId !== snapshot.snapshotId)
        throw new Error(
          'The returned repository data does not match the active workspace snapshot.',
        );
      setResult(next);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not load contribution opportunities.',
      );
    } finally {
      setAnalyzing(false);
    }
  }

  async function buildPlan(issueNumber: number) {
    if (!snapshot) return;
    setSelectedIssue(issueNumber);
    setPlanning(true);
    setPlan(null);
    setError('');
    try {
      const next = await analysisApi<ContributionPlan>('/api/contributions/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshotId: snapshot.snapshotId,
          issueNumber,
          preferences,
        }),
      });
      if (next.snapshotId !== snapshot.snapshotId)
        throw new Error('The contribution plan was generated for a different repository snapshot.');
      setPlan(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not build a contribution plan.');
    } finally {
      setPlanning(false);
    }
  }

  if (snapshotLoading && !snapshot)
    return (
      <div className="first-contribution-page">
        <div className="contribution-empty-state" role="status">
          <LoaderCircle className="spin" size={22} />
          <h1>Loading your workspace scan</h1>
          <p>
            First Contribution will reuse the analyzed repository already selected in Workspace.
          </p>
        </div>
      </div>
    );

  if (!snapshot)
    return (
      <div className="first-contribution-page">
        <header className="contribution-page-heading">
          <span className="contribution-eyebrow">
            <GitFork size={15} /> EXPLORE
          </span>
          <h1>Make your first contribution with confidence.</h1>
          <p>
            Discover promising open-source issues, understand the codebase, and turn your first
            contribution into a guided plan.
          </p>
        </header>
        <section className="contribution-empty-state">
          <div className="contribution-empty-icon">
            <FileCode2 size={23} />
          </div>
          <h2>Analyze a repository in Workspace first</h2>
          <p>
            First Contribution uses the existing analyzed repository snapshot. Open Workspace and
            complete a repository analysis; you do not need to enter the repository URL again here.
          </p>
          {snapshotError && (
            <p className="contribution-error" role="alert">
              {snapshotError}
            </p>
          )}
          <a className="contribution-primary-link" href="#/workspace">
            Open Workspace <ArrowUpRight size={16} />
          </a>
        </section>
      </div>
    );

  const signals = result?.signals;
  const recentClosedPulls = signals?.pullRequests.recentPRs.length ?? 0;
  const mergedRecently =
    signals?.pullRequests.recentPRs.filter((pull) => pull.mergedAt).length ?? 0;
  const openPulls = signals?.pullRequests.open;
  const closedPulls = signals?.pullRequests.closedObserved;
  const pullRatio =
    openPulls === null ||
    openPulls === undefined ||
    closedPulls === null ||
    closedPulls === undefined
      ? 'Ratio unavailable'
      : closedPulls === 0
        ? 'No closed PRs in sample'
        : `${(openPulls / closedPulls).toFixed(2)} open per closed`;

  return (
    <div className="first-contribution-page">
      <header className="contribution-page-heading">
        <span className="contribution-eyebrow">
          <GitFork size={15} /> EXPLORE
        </span>
        <h1>Make your first contribution with confidence.</h1>
        <p>
          Discover promising open-source issues, understand the codebase, and turn your first
          contribution into a guided plan.
        </p>
      </header>

      <section className="contribution-repository-context" aria-label="Active repository">
        <div className="contribution-repo-mark">
          <GitBranch size={19} />
        </div>
        <div className="contribution-repo-details">
          <span>ACTIVE WORKSPACE REPOSITORY</span>
          <a href={snapshot.repository} target="_blank" rel="noreferrer">
            {snapshot.repository.replace('https://github.com/', '')} <ExternalLink size={13} />
          </a>
          <small>
            Analyzed commit <code>{snapshot.commit.slice(0, 12)}</code> · snapshot{' '}
            <code>{snapshot.snapshotId.slice(0, 10)}</code>
          </small>
        </div>
        <span className="contribution-snapshot-badge">
          <CheckCircle2 size={14} /> Existing scan reused
        </span>
      </section>

      <section className="contribution-discover-panel">
        <div>
          <span className="contribution-eyebrow">
            <Sparkles size={14} /> PERSONALIZE (OPTIONAL)
          </span>
          <h2>Find an issue that fits you</h2>
          <p>
            Skills and interests influence matching; labels alone never determine a recommendation.
          </p>
        </div>
        <div className="contribution-preferences">
          <label>
            Skills
            <input
              value={skillsText}
              onChange={(event) => setSkillsText(event.target.value)}
              placeholder="e.g. React, testing, Python"
            />
          </label>
          <label>
            Interests
            <input
              value={interestsText}
              onChange={(event) => setInterestsText(event.target.value)}
              placeholder="e.g. accessibility, APIs"
            />
          </label>
          <label>
            Preferred difficulty
            <select
              value={difficulty}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) setDifficulty('');
                else if (isDifficulty(value)) setDifficulty(value);
              }}
            >
              <option value="">Any difficulty</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
        </div>
        <button
          className="contribution-primary-button"
          onClick={() => void findOpportunities()}
          disabled={analyzing}
        >
          {analyzing ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
          {analyzing
            ? 'Finding opportunities…'
            : result
              ? 'Refresh live opportunities'
              : 'Find contribution opportunities'}
        </button>
        <span className="contribution-data-note">
          Live GitHub metadata is fetched only when you request opportunities. Repository source is
          not downloaded or rescanned.
        </span>
      </section>

      {error && (
        <div className="contribution-error" role="alert">
          <AlertCircle size={17} />
          {error}
        </div>
      )}

      {result && (
        <>
          <section className="contribution-readiness">
            <div className="contribution-section-heading">
              <div>
                <span className="contribution-eyebrow">REPOSITORY READINESS</span>
                <h2>Signals to help you decide</h2>
              </div>
              <span className="contribution-live-badge">
                <span /> Live GitHub data
              </span>
            </div>
            <div className="contribution-signals-grid">
              <SignalCard
                icon={Clock3}
                title="Recent commit activity"
                value={
                  signals?.latestCommit.daysAgo === null ||
                  signals?.latestCommit.daysAgo === undefined
                    ? 'Unavailable'
                    : dateLabel(signals.latestCommit.date)
                }
              >
                {signals?.latestCommit.sha ? (
                  <>
                    Latest commit <code>{signals.latestCommit.sha.slice(0, 8)}</code>
                    {signals.latestCommit.date
                      ? ` (${new Date(signals.latestCommit.date).toLocaleDateString()})`
                      : ''}
                    . {signals.latestCommit.explanation}
                  </>
                ) : (
                  signals?.latestCommit.explanation || 'Latest commit information was unavailable.'
                )}
              </SignalCard>
              <SignalCard
                icon={GitPullRequest}
                title="Pull-request activity"
                value={`${signals?.pullRequests.open ?? '—'} open · ${signals?.pullRequests.closedObserved ?? '—'} closed observed`}
              >
                Sample ratio: {pullRatio}. {mergedRecently} of {recentClosedPulls} recently updated
                closed pull requests in the recent sample were merged. Counts are page samples, not
                historical totals; volume alone does not prove maintainer responsiveness.
              </SignalCard>
              <SignalCard
                icon={BookOpenCheck}
                title="Issue tracker"
                value={`${signals?.issues.openObserved ?? 0}${signals?.issues.pageCapped ? '+' : ''} open issues observed`}
              >
                {signals?.issues.beginnerLabelCount ?? 0} sampled issues have a beginner/help-wanted
                label. Review issue clarity and discussion before choosing.
                {signals?.issues.recentlyUpdated.slice(0, 3).map((issue, index) => (
                  <span key={issue.number}>
                    {index === 0 ? ' Recently updated: ' : '; '}
                    <a
                      href={`${result.repository.url}/issues/${issue.number}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      #{issue.number} {issue.title}
                    </a>{' '}
                    ({dateLabel(issue.updatedAt)})
                  </span>
                ))}
              </SignalCard>
              <SignalCard
                icon={Users}
                title="Contributor distribution"
                value={
                  signals?.contributors.leaderShare === null ||
                  signals?.contributors.leaderShare === undefined
                    ? 'Unavailable'
                    : `${signals.contributors.leaderShare}% leading share`
                }
              >
                {signals?.contributors.leader
                  ? `${signals.contributors.leader} leads among ${signals.contributors.observed} observed contributors. This approximate concentration signal is not a definitive bus-factor measurement.`
                  : 'Contributor data is missing or unavailable; this is not a definitive bus-factor measurement.'}
              </SignalCard>
              <SignalCard
                icon={HeartHandshake}
                title="Contribution guidance"
                value={signals?.repository.license || 'License not detected'}
              >
                {signals?.repository.hasContributionGuide
                  ? 'Contribution instructions found.'
                  : 'No root or .github CONTRIBUTING.md was found.'}{' '}
                {signals?.repository.hasCodeOfConduct
                  ? 'A code of conduct is available.'
                  : 'No root or .github code of conduct was found.'}
              </SignalCard>
              <SignalCard
                icon={FileCode2}
                title="Project setup"
                value={
                  signals?.repository.hasTestConfig
                    ? 'Test configuration detected'
                    : 'No test config detected in snapshot'
                }
              >
                {signals?.repository.hasReadme
                  ? 'README is present in the saved snapshot. '
                  : 'README was not found in the saved snapshot. '}
                {signals?.repository.latestRelease
                  ? `Latest release: ${signals.repository.latestRelease.name} (${dateLabel(signals.repository.latestRelease.publishedAt)}).`
                  : 'No recent release information was available.'}
              </SignalCard>
            </div>
            <p className="contribution-limitation">
              <AlertCircle size={14} /> These are observable signals, not a guarantee that a
              repository is healthy or that a specific issue will be accepted.
            </p>
          </section>

          <section className="contribution-opportunities">
            <div className="contribution-section-heading">
              <div>
                <span className="contribution-eyebrow">RECOMMENDED ISSUES</span>
                <h2>
                  {result.issues.length
                    ? `${result.issues.length} contribution ${result.issues.length === 1 ? 'opportunity' : 'opportunities'}`
                    : 'No suitable issues found'}
                </h2>
              </div>
              <span className="contribution-method-badge">
                {result.recommendationMode === 'ai-assisted' ? (
                  <Sparkles size={14} />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                {result.recommendationMode === 'ai-assisted'
                  ? 'AI-assisted, validated'
                  : 'Transparent rule-based ranking'}
              </span>
            </div>
            {result.issues.length === 0 ? (
              <div className="contribution-no-issues">
                <p>
                  No open issue met the current criteria. Try a different difficulty or remove
                  preferences, then refresh.
                </p>
                <button
                  className="contribution-secondary-button"
                  onClick={() => {
                    setDifficulty('');
                    setSkillsText('');
                    setInterestsText('');
                  }}
                >
                  Clear preferences
                </button>
              </div>
            ) : (
              <div className="contribution-issue-list">
                {result.issues.map((issue) => (
                  <article className="contribution-issue-card" key={issue.number}>
                    <div className="contribution-issue-topline">
                      <span className="contribution-issue-number">#{issue.number}</span>
                      <span className="contribution-open-label">
                        <span /> Open
                      </span>
                      <span className="contribution-score">Match {issue.score}/100</span>
                    </div>
                    <h3>
                      <a href={issue.url} target="_blank" rel="noreferrer">
                        {issue.title}
                        <ArrowUpRight size={15} />
                      </a>
                    </h3>
                    <p className="contribution-issue-body">
                      {issue.body ||
                        'This issue has no description yet. Ask maintainers to clarify the expected outcome before starting.'}
                    </p>
                    <div className="contribution-labels">
                      {issue.labels.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                      <span className="contribution-difficulty">Estimated: {issue.difficulty}</span>
                    </div>
                    <div className="contribution-issue-meta">
                      <span>
                        <Clock3 size={13} /> Updated {dateLabel(issue.updatedAt)}
                      </span>
                      <span>{issue.comments} comments</span>
                      {issue.skills.length > 0 && <span>Skills: {issue.skills.join(', ')}</span>}
                    </div>
                    <p className="contribution-reason">{issue.reason}</p>
                    {issue.files.length > 0 && (
                      <p className="contribution-suggested-files">
                        <FileCode2 size={14} /> Snapshot files to inspect:{' '}
                        {issue.files.map((path) => (
                          <code key={path}>{path}</code>
                        ))}
                      </p>
                    )}
                    {issue.files.length === 0 && (
                      <p className="contribution-warning">
                        No likely file path matched this issue in the analyzed snapshot. Use
                        Architecture to explore the saved codebase before making assumptions.
                      </p>
                    )}
                    {issue.comments > 20 && (
                      <p className="contribution-warning">
                        <AlertCircle size={14} /> This issue has a long discussion; read recent
                        comments before choosing.
                      </p>
                    )}
                    <div className="contribution-issue-actions">
                      <a
                        href={issue.url}
                        target="_blank"
                        rel="noreferrer"
                        className="contribution-text-link"
                      >
                        View issue on GitHub <ExternalLink size={14} />
                      </a>
                      <button
                        className="contribution-plan-button"
                        onClick={() => void buildPlan(issue.number)}
                        disabled={planning && selectedIssue === issue.number}
                      >
                        {planning && selectedIssue === issue.number ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : (
                          <Sparkles size={15} />
                        )}
                        Build my contribution plan
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {result.guidanceLinks.contributing && (
            <a
              className="contribution-guide-link"
              href={result.guidanceLinks.contributing}
              target="_blank"
              rel="noreferrer"
            >
              Contribution guide <ExternalLink size={14} />
            </a>
          )}
          {result.guidanceLinks.codeOfConduct && (
            <a
              className="contribution-guide-link"
              href={result.guidanceLinks.codeOfConduct}
              target="_blank"
              rel="noreferrer"
            >
              Code of conduct <ExternalLink size={14} />
            </a>
          )}
          <details className="contribution-limitations">
            <summary>Data limits and scoring criteria</summary>
            <p>
              Scores award 30 points for a starter label, 12 for a substantive description, 10 for
              activity within 90 days, up to 20 for skill/interest matches, 8 when a selected
              difficulty matches, and 10 for fewer than 12 comments. Issue matches prioritize
              beginner/help-wanted labels, a substantive description, recent activity, preference
              matches, and discussion volume. A label alone cannot make an issue suitable.
              Difficulty and match scores are estimates.
            </p>
            <ul>
              {result.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        </>
      )}

      {planning && selectedIssue !== null && (
        <section className="contribution-plan-panel" aria-live="polite">
          <LoaderCircle className="spin" size={18} /> Building a plan from issue discussion and the
          saved snapshot…
        </section>
      )}

      {plan && selectedIssue !== null && (
        <section className="contribution-plan-panel" aria-labelledby="contribution-plan-title">
          <div className="contribution-section-heading">
            <div>
              <span className="contribution-eyebrow">
                ISSUE #{selectedIssue} ·{' '}
                {plan.mode === 'ai-assisted' ? 'AI-ASSISTED PLAN' : 'GROUNDED FALLBACK PLAN'}
              </span>
              <h2 id="contribution-plan-title">Your contribution plan</h2>
            </div>
            <button
              className="contribution-close-plan"
              onClick={() => {
                setPlan(null);
                setSelectedIssue(null);
              }}
            >
              Close
            </button>
          </div>
          <p className="contribution-plan-summary">{plan.summary}</p>
          <div className="contribution-plan-section">
            <h3>Understand the problem</h3>
            <p>{plan.expectedOutcome}</p>
          </div>
          <div className="contribution-plan-section">
            <h3>Understand the relevant code</h3>
            {plan.relevantFiles.length ? (
              <ul>
                {plan.relevantFiles.map((path) => (
                  <li key={path}>
                    <code>{path}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No matching source files were available in the saved snapshot. Open the repository
                files from Workspace before making code assumptions.
              </p>
            )}
          </div>
          <div className="contribution-plan-section">
            <h3>Implementation approach</h3>
            <ol>
              {plan.implementationSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
          <div className="contribution-plan-section">
            <h3>Setup and development</h3>
            <ul>
              {plan.setupSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
            {plan.commands.length > 0 && (
              <div className="contribution-command-list">
                <strong>Commands supported by the saved package files</strong>
                {plan.commands.map((command) => (
                  <code key={command}>{command}</code>
                ))}
              </div>
            )}
          </div>
          <div className="contribution-plan-section">
            <h3>Testing and validation</h3>
            <ul>
              {[...plan.tests, ...(plan.testing || [])].map((test, index) => (
                <li key={`${index}-${test}`}>{test}</li>
              ))}
            </ul>
            {!plan.tests.length && !plan.testing?.length && (
              <p>
                No test command was identified in the stored package files. Check the repository's
                contribution instructions.
              </p>
            )}
          </div>
          <div className="contribution-plan-section">
            <h3>Questions for maintainers</h3>
            {plan.maintainerQuestions.length ? (
              <ul>
                {plan.maintainerQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            ) : (
              <p>
                No blocking ambiguity detected from the issue text. Ask for clarification if you
                find one while investigating.
              </p>
            )}
          </div>
          <div className="contribution-plan-section">
            <h3>Contribution workflow</h3>
            <ol>
              <li>Fork the repository on GitHub and configure your fork as a remote if needed.</li>
              <li>Create a focused branch, make the change, run the checks, and commit it.</li>
              <li>
                Push the branch to your fork and open a pull request that links the original issue.
              </li>
            </ol>
            <div className="contribution-command-list">
              {plan.gitCommands.map((command) => (
                <code key={command}>{command}</code>
              ))}
            </div>
            <a
              className="contribution-text-link"
              href={result?.issues.find((issue) => issue.number === selectedIssue)?.url}
              target="_blank"
              rel="noreferrer"
            >
              Open original issue <ExternalLink size={14} />
            </a>
          </div>
          <div className="contribution-plan-section">
            <h3>Definition of done</h3>
            <ul>
              {plan.definitionOfDone.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <p className="contribution-snapshot-note">
            Code references are grounded in snapshot <code>{plan.snapshotId}</code>.{' '}
            {plan.mode === 'fallback'
              ? 'AI was unavailable or returned an invalid response; this is a clearly labeled snapshot-based fallback.'
              : 'AI prose is an estimate and should be checked against the issue and repository.'}
          </p>
        </section>
      )}
    </div>
  );
}
