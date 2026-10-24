import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Clock3, GitBranch, Play, Search } from 'lucide-react';
import { Button, Badge, PageHeading } from '../components/UI';
import { CodeJourneyMark, InteractiveBrandMentor } from '../components/InteractiveBrandMentor';
import { sceneFor } from '../components/JourneyScenes';
import { handoffApi } from '../services/handoffApi';
import { useJourneyProgress } from '../state/useJourneyProgress';
import { useRepositoryAnalysis } from '../state/RepositoryAnalysisContext';
import { filterJourneys, journeyCompleted, type CodeJourney } from '../domain/codeJourney';
import { useWorkspace } from '../state/WorkspaceContext';
import {
  journeySkills,
  normalizeSkills,
  recommendJourneys,
} from '../domain/journeyRecommendations';
import '../styles/codejourney.css';
import '../styles/learning-path.css';
export default function Journeys() {
  const { snapshot, loading: repositoryLoading } = useRepositoryAnalysis();
  const [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [total, setTotal] = useState(0);
  const [params, setParams] = useSearchParams();
  const { state } = useWorkspace();
  const skills = normalizeSkills(state.skills);
  const section = params.get('section') === 'all' ? 'all' : 'for-you';
  const preferencesParams = new URLSearchParams(params);
  preferencesParams.set('preferences', 'skills');
  const preferencesLink = '/learn?' + preferencesParams.toString();
  const [loadedSnapshot, setLoadedSnapshot] = useState('');
  const [journeys, setJourneys] = useState<CodeJourney[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(''),
    [topic, setTopic] = useState(params.get('topic') || 'all'),
    [difficulty, setDifficulty] = useState('all'),
    [status, setStatus] = useState('all'),
    [sort, setSort] = useState('featured');
  const { progress, error: progressError } = useJourneyProgress();
  useEffect(() => {
    setPage(1);
    setJourneys([]);
    setLoadedSnapshot('');
    setHasMore(false);
    setTotal(0);
  }, [snapshot?.snapshotId]);
  useEffect(() => {
    let cancelled = false;
    if (page === 1) setJourneys([]);
    setError('');
    if (!snapshot) {
      setLoading(false);
      return;
    }
    setLoading(true);
    handoffApi<{ journeys: CodeJourney[]; hasMore: boolean; total: number }>(
      `/api/codejourneys?snapshotId=${encodeURIComponent(snapshot.snapshotId)}&page=${page}`,
    )
      .then((r) => {
        if (!cancelled) {
          setJourneys((old) =>
            page === 1
              ? r.journeys
              : [...new Map([...old, ...r.journeys].map((j) => [j.id, j])).values()],
          );
          setLoadedSnapshot(snapshot.snapshotId);
          setHasMore(r.hasMore);
          setTotal(r.total);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot?.snapshotId, page]);
  useEffect(() => {
    setTopic(params.get('topic') || 'all');
  }, [params]);
  const scoped =
    loadedSnapshot === snapshot?.snapshotId
      ? journeys.filter(
          (j) => j.snapshotId === snapshot.snapshotId && j.repository === snapshot.repository,
        )
      : [];
  const recommendations = recommendJourneys(
    scoped,
    skills,
    progress,
    snapshot?.snapshotId || '',
    snapshot?.repository || '',
    state.personalized ? state.goal : undefined,
  );
  // Look beyond the first API page before declaring that a known framework has no matches.
  useEffect(() => {
    if (
      section === 'for-you' &&
      skills.length > 0 &&
      hasMore &&
      !loading &&
      !error &&
      loadedSnapshot === snapshot?.snapshotId &&
      !recommendations.some((result) => result.relation === 'direct')
    ) {
      setPage((value) => value + 1);
    }
  }, [
    section,
    skills.join('|'),
    hasMore,
    loading,
    error,
    loadedSnapshot,
    snapshot?.snapshotId,
    recommendations.some((result) => result.relation === 'direct'),
  ]);
  const recommendationById = new Map(recommendations.map((r) => [r.journey.id, r]));
  const library = section === 'all' ? scoped : recommendations.map((r) => r.journey);
  const visible = filterJourneys(library, progress, { search, topic, difficulty, status, sort });
  function path(j: CodeJourney, failure = false) {
    const saved = progress[j.id],
      scenario = failure
        ? j.scenarios.find((s) => s.failure) || j.scenarios[1]
        : j.scenarios.find((s) => s.id === saved?.scenarioId) || j.scenarios[0];
    return `/learn/${j.id}?${new URLSearchParams({ scenario: scenario.id, ...(!failure && saved?.traceId && saved.snapshotId === j.snapshotId ? { trace: saved.traceId, ...(!saved.completed ? { resume: '1' } : {}) } : {}) })}`;
  }
  return (
    <div className="codejourney-page">
      <PageHeading
        eyebrow="CODEJOURNEY / LEARN THE FLOW"
        title="My Learning Path"
        description={
          snapshot
            ? 'Follow source-linked journeys in ' +
              snapshot.repository.replace('https://github.com/', '') +
              '. Pick up where you left off or find your next path.'
            : 'Explore your repository through guided code journeys.'
        }
        actions={
          <span className="codejourney-emblem">
            <CodeJourneyMark />
            <span>CodeJourney</span>
          </span>
        }
      />
      <section className="learning-skills-row" aria-label="Your skills">
        <strong>Your skills</strong>
        <div>
          {skills.length ? (
            skills.map((s) => (
              <Badge key={s} tone="violet">
                {s}
              </Badge>
            ))
          ) : (
            <span>No skills added yet</span>
          )}
        </div>
        <Link className="button button-ghost" to={preferencesLink}>
          {skills.length ? 'Edit' : 'Add skills'}
        </Link>
      </section>
      <div className="learning-sections" role="group" aria-label="Learning path sections">
        {[
          ['for-you', 'For You'],
          ['all', 'All Journeys'],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={section === id}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('section', id);
              setParams(next);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {section === 'for-you' && !skills.length && (
        <div className="journey-empty">
          <h2>Add your skills to get personalized code journeys.</h2>
          <Link className="button button-primary" to={preferencesLink}>
            Add skills
          </Link>
          <Button onClick={() => setParams({ section: 'all' })}>Browse All Journeys</Button>
        </div>
      )}
      {section === 'for-you' && recommendations.length > 0 && (
        <p className="journey-library-honesty">
          {recommendations.some((r) => r.relation === 'direct')
            ? 'Skill matches come from saved source metadata. Connected paths are ranked ahead of isolated helpers.'
            : 'No direct skill matches in the loaded journeys. These related HTTP/API paths are optional next steps, grounded in this repository.'}
        </p>
      )}
      <div className="journey-library-toolbar">
        <div className="journey-library-tabs">
          {[
            ['all', 'All statuses', library.length],
            [
              'new',
              'Not completed',
              library.filter((j) => !journeyCompleted(j, progress[j.id])).length,
            ],
            [
              'complete',
              'Completed',
              library.filter((j) => journeyCompleted(j, progress[j.id])).length,
            ],
          ].map(([id, label, count]) => (
            <button key={id} aria-pressed={status === id} onClick={() => setStatus(String(id))}>
              {label}
              <span>{count}</span>
            </button>
          ))}
        </div>
        <label className="journey-library-search">
          <Search size={16} />
          <input
            aria-label="Find a CodeJourney"
            placeholder="Search concepts, languages, technologies…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <div className="journey-library-filters">
        <label>
          Topic
          <select value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="all">All topics</option>
            {[...new Set(journeys.map((j) => j.topic))].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Difficulty
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="all">All levels</option>
            {[...new Set(journeys.map((j) => j.difficulty))].map((value) => (
              <option key={value} value={value}>
                {value === 'unrated' ? 'Unrated source' : value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="featured">Recommended order</option>
            <option value="name">Title</option>
            <option value="duration">Shortest path first</option>
            <option value="recent">Recently studied</option>
          </select>
        </label>
        <Link to="/repository">
          {snapshot ? 'Open repository analysis' : 'Analyze your repository'}
        </Link>
      </div>
      {(error || progressError) && (
        <p role="alert" className="journey-alert">
          {error || progressError}
        </p>
      )}
      <p className="journey-library-honesty">
        <GitBranch size={14} />
        Actual analyzed repository source. Connection paths show static relationships, not recorded
        execution or proven branch outcomes.
      </p>
      {snapshot && total > 0 && (
        <p className="journey-library-honesty">
          {section === 'for-you' ? recommendations.length + ' recommended paths from ' : 'Showing '}
          {scoped.length} of {total} source components. Search and filters apply to loaded cards.
        </p>
      )}
      {loading || repositoryLoading ? (
        <div role="status" className="journey-empty">
          Loading the journey library…
        </div>
      ) : !snapshot ? (
        <div className="journey-empty">
          <h2>Connect your repository first</h2>
          <p>
            Code Journeys uses the same analyzed snapshot as Mentor workspace. No sample paths are
            substituted.
          </p>
          <Link className="button button-primary" to="/repository">
            Analyze repository
          </Link>
        </div>
      ) : section === 'for-you' && !skills.length ? null : !visible.length ? (
        <div className="journey-empty">
          <InteractiveBrandMentor mode="debugging" />
          <h2>
            {section === 'for-you' && !recommendations.length
              ? 'No strong matches yet'
              : 'No journeys match those filters'}
          </h2>
          {section === 'for-you' && (
            <>
              <p>
                {skills.length
                  ? 'No matching source paths were found for these skills. Try another skill or browse All Journeys.'
                  : 'Choose All Journeys to browse without skills.'}
              </p>
              <Button onClick={() => setParams({ section: 'all' })}>Browse All Journeys</Button>
            </>
          )}
          <Button
            onClick={() => {
              setSearch('');
              setTopic('all');
              setDifficulty('all');
              setStatus('all');
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="codejourney-card-grid">
          {visible.map((j) => {
            const scenario = j.scenarios[0],
              steps = scenario.path.map((key) => j.events.find((e) => e.key === key)!),
              checkpoint = progress[j.id],
              current = checkpoint?.snapshotId === j.snapshotId ? checkpoint : undefined;
            return (
              <article className="codejourney-card" key={j.id}>
                <Link to={path(j)} className="codejourney-preview" aria-label={`Open ${j.title}`}>
                  <div>
                    {[steps[0], steps[Math.floor(steps.length / 2)], steps.at(-1)!].map(
                      (step, i) => {
                        const Icon = sceneFor(step.kind).icon;
                        return (
                          <span
                            key={`${step.key}:${i}`}
                            className={i === 1 ? 'preview-current' : ''}
                          >
                            <Icon size={22} />
                            <small>{step.title}</small>
                          </span>
                        );
                      },
                    )}
                  </div>
                  <small>
                    <GitBranch size={13} />
                    Explained path · repository source
                  </small>
                </Link>
                <div className="codejourney-card-content">
                  <div className="journey-row-between">
                    <Badge tone="violet">{j.topic}</Badge>
                    <span className="journey-duration">
                      <Clock3 size={14} />
                      {j.origin === 'repository' ? j.commit?.slice(0, 7) : `${j.minutes} min`}
                    </span>
                  </div>
                  {section === 'for-you' && (
                    <Badge tone="violet">
                      {recommendationById.get(j.id)?.relation === 'related'
                        ? 'Related next step'
                        : 'Skill match'}
                    </Badge>
                  )}
                  <h2>{j.title}</h2>
                  <p>{j.description}</p>
                  <div className="learning-card-tags">
                    {(
                      recommendationById.get(j.id)?.relevantTags ||
                      journeySkills(j).filter((t) =>
                        ['TypeScript', 'JavaScript', 'Express', 'React', 'Node.js'].includes(t),
                      )
                    ).map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                    {j.difficulty !== 'unrated' && <Badge>{j.difficulty}</Badge>}
                  </div>
                  {section === 'for-you' && (
                    <p className="learning-reason">{recommendationById.get(j.id)?.reason}</p>
                  )}
                  <div className="codejourney-card-facts">
                    <span>{steps.length} source events</span>
                    <span>{j.scenarios.length} connection paths</span>
                  </div>
                  {current && (
                    <div className="journey-card-progress">
                      <span>
                        {journeyCompleted(j, current)
                          ? 'Main path completed · Current path'
                          : current.completed
                            ? 'Scenario completed'
                            : 'In progress'}{' '}
                        · {current.visited.length}/
                        {j.scenarios.find((s) => s.id === current.scenarioId)?.path.length ||
                          steps.length}{' '}
                        events
                      </span>
                      <progress
                        value={current.visited.length}
                        max={
                          j.scenarios.find((s) => s.id === current.scenarioId)?.path.length ||
                          steps.length
                        }
                      />
                    </div>
                  )}
                  <div className="codejourney-card-actions">
                    <Link className="button button-primary" to={path(j)}>
                      <Play size={14} />
                      {current
                        ? current.completed
                          ? 'Revisit journey'
                          : 'Continue journey'
                        : 'Start journey'}
                      <ArrowRight size={14} />
                    </Link>
                    {j.scenarios.length > 1 && (
                      <Link to={path(j, true)}>
                        {j.scenarios.some((s) => s.failure)
                          ? 'Explore a failure path'
                          : 'Explore an alternate path'}{' '}
                        →
                      </Link>
                    )}
                    <InteractiveBrandMentor
                      compact
                      mode={current?.completed ? 'review' : 'reading'}
                      onClick={() => {
                        location.hash = path(j);
                      }}
                      message="Open this reviewed journey"
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {hasMore && (
        <Button disabled={loading} onClick={() => setPage((value) => value + 1)}>
          {loading ? 'Loading source components…' : 'Load more repository components'}
        </Button>
      )}
    </div>
  );
}
