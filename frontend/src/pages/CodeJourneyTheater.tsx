import { useEffect, useReducer, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  Code2,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  ZoomIn,
} from 'lucide-react';
import { Badge, Button } from '../components/UI';
import { RepositorySource } from '../components/RepositorySource';
import { JourneyRope } from '../components/JourneyRope';
import { JourneyScene } from '../components/JourneyScenes';
import { JourneyQuestion } from '../components/JourneyQuestion';
import { JourneyRunPanel } from '../components/JourneyRunPanel';
import { RelatedTeamKnowledge } from '../components/RelatedTeamKnowledge';
import { InteractiveBrandMentor } from '../components/InteractiveBrandMentor';
import { useJourneyProgress } from '../state/useJourneyProgress';
import { handoffApi } from '../services/handoffApi';
import {
  initialPlayback,
  playbackTransition,
  type CodeJourney,
  type JourneyCheckpoint,
  type JourneyLevel,
  type JourneyTrace,
} from '../domain/codeJourney';
import '../styles/codejourney.css';
export default function CodeJourneyTheater() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { progress, ready, save, error: progressError } = useJourneyProgress();
  const [data, setData] = useState<{ journey: CodeJourney; trace: JourneyTrace } | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    handoffApi<{ journey: CodeJourney }>(`/api/codejourneys/${id}`)
      .then(async ({ journey: currentJourney }) => {
        let journey = currentJourney;
        const scenario = params.get('scenario') || journey.scenarios[0].id;
        const trace = params.get('trace')
          ? await handoffApi<JourneyTrace>(
              `/api/traces/${encodeURIComponent(params.get('trace')!)}`,
            )
          : await handoffApi<JourneyTrace>(`/api/codejourneys/${id}/scenarios/${scenario}`);
        if (trace.snapshotId !== journey.snapshotId)
          journey = (
            await handoffApi<{ journey: CodeJourney }>(
              `/api/codejourneys/${id}?sourceSnapshot=${trace.snapshotId}`,
            )
          ).journey;
        if (
          trace.journeyId !== id ||
          trace.snapshotId !== journey.snapshotId ||
          trace.sourceHash !== journey.sourceHash ||
          !trace.events.length
        )
          throw new Error('Trace and source versions do not match. Reopen a reviewed path.');
        if (!cancelled) setData({ journey, trace });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, params]);
  if (error)
    return (
      <div className="journey-empty">
        <h1>This journey could not open</h1>
        <p role="alert">{error}</p>
        <Button onClick={() => setParams({})}>Open reviewed explained path</Button>
        <Link to="/learn">Back to library</Link>
      </div>
    );
  if (!data || !ready)
    return (
      <div className="journey-empty" role="status">
        <InteractiveBrandMentor mode="thinking" />
        Opening source-linked journey…
      </div>
    );
  return (
    <Player
      key={data.trace.id}
      {...data}
      checkpoint={params.get('resume') === '1' ? progress[id] : undefined}
      save={save}
      progressError={progressError}
      choose={(scenario) => setParams({ scenario })}
      openTrace={(trace) => setParams({ scenario: trace.scenarioId, trace: trace.id })}
    />
  );
}
function Player({
  journey,
  trace,
  checkpoint,
  save,
  progressError,
  choose,
  openTrace,
}: {
  journey: CodeJourney;
  trace: JourneyTrace;
  checkpoint?: JourneyCheckpoint;
  save: (checkpoint: JourneyCheckpoint) => Promise<void>;
  progressError: string;
  choose: (scenario: string) => void;
  openTrace: (trace: JourneyTrace) => void;
}) {
  const [state, dispatch] = useReducer(
    (state: ReturnType<typeof initialPlayback>, action: Parameters<typeof playbackTransition>[1]) =>
      playbackTransition(state, action, trace),
    undefined,
    () => initialPlayback(trace, checkpoint),
  );
  const [level, setLevel] = useState<JourneyLevel>(checkpoint?.level || 'beginner'),
    [speed, setSpeed] = useState(1),
    [voice, setVoice] = useState(false),
    [voiceError, setVoiceError] = useState('');
  const [questionOpen, setQuestionOpen] = useState(true),
    [error, setError] = useState('');
  const sourcePanel = useRef<HTMLDivElement>(null),
    mentorLauncher = useRef<HTMLButtonElement>(null),
    saveSequence = useRef(Promise.resolve());
  const [repositorySource, setRepositorySource] = useState<{
    file: string;
    excerpt: string;
    startLine: number;
    endLine: number;
    complete: boolean;
    url: string;
  } | null>(null);
  const [sourceError, setSourceError] = useState('');
  const event = trace.events[state.index],
    scenario = journey.scenarios.find((s) => s.id === trace.scenarioId)!;
  const prediction = state.predictions[event.id],
    blocked = Boolean(event.prediction && !prediction);
  useEffect(() => {
    if (journey.origin !== 'repository') return;
    let cancelled = false;
    setRepositorySource(null);
    setSourceError('');
    handoffApi<{
      file: string;
      excerpt: string;
      startLine: number;
      endLine: number;
      complete: boolean;
      url: string;
      snapshotId: string;
    }>(
      `/api/snapshots/${journey.snapshotId}/source?referenceId=${encodeURIComponent(event.sourceRefId)}`,
    )
      .then((source) => {
        if (source.snapshotId !== journey.snapshotId || source.file !== event.source.file)
          throw new Error('The source does not match the selected event.');
        if (!cancelled) setRepositorySource(source);
      })
      .catch((e) => {
        if (!cancelled) setSourceError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [journey.snapshotId, event.sourceRefId]);
  const explanation = event.explanations[level];
  useEffect(() => {
    if (!state.playing) return;
    const timer = setTimeout(
      () => dispatch({ type: 'next' }),
      (voice ? Math.max(4000, explanation.length * 65) : 2500) / speed,
    );
    return () => clearTimeout(timer);
  }, [state.index, state.playing, speed, voice, explanation]);
  useEffect(() => {
    const value: JourneyCheckpoint = {
      journeyId: journey.id,
      scenarioId: scenario.id,
      traceId: trace.id,
      snapshotId: trace.snapshotId,
      eventId: event.id,
      level,
      visited: state.visited,
      predictions: state.predictions,
      completed: state.completed,
      updatedAt: new Date().toISOString(),
    };
    saveSequence.current = saveSequence.current
      .catch(() => {})
      .then(() => save(value))
      .catch((e) => setError(`Progress could not save: ${e.message}`));
  }, [state.index, state.visited, state.predictions, state.completed, level]);
  useEffect(() => {
    if (!voice || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const message = new SpeechSynthesisUtterance(explanation);
    message.rate = Math.min(1.4, speed);
    message.onerror = () =>
      setVoiceError('Browser narration is unavailable. Text remains available.');
    window.speechSynthesis.speak(message);
    return () => {
      window.speechSynthesis.cancel();
    };
  }, [event.id, voice, level, explanation]);
  useEffect(
    () => () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    },
    [],
  );
  function ask(paused: boolean) {
    if (paused) dispatch({ type: 'pause' });
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setQuestionOpen(true);
  }
  function selectScenario(id: string) {
    dispatch({ type: 'pause' });
    choose(id);
  }
  return (
    <div
      className={`codejourney-page journey-theater ${questionOpen ? 'journey-drawer-open' : ''}`}
      data-trace-id={trace.id}
      data-event-id={event.id}
    >
      <Link to="/learn" className="journey-back">
        <ArrowLeft size={14} />
        Journey library
      </Link>
      <header className="journey-theater-heading">
        <div>
          <span className="eyebrow">CODEJOURNEY / EXECUTION THEATER</span>
          <h1>{journey.title}</h1>
          <p>{journey.provenance}</p>
        </div>
        <Badge tone={trace.mode === 'observed_replay' ? 'green' : 'violet'}>
          {trace.mode === 'observed_replay'
            ? 'Observed replay · captured scenario'
            : 'Explained path · no execution'}
        </Badge>
      </header>
      <div className="journey-evidence-banner">
        <strong>
          {trace.mode === 'observed_replay'
            ? 'Recorded execution evidence'
            : journey.origin === 'repository'
              ? 'Source connection path'
              : 'Reviewed possible flow'}
          <span>
            {journey.origin === 'repository'
              ? `Commit ${journey.commit?.slice(0, 12)}`
              : `Source ${trace.sourceHash.slice(0, 12)}`}
          </span>
        </strong>
        <span>
          {trace.mode === 'observed_replay'
            ? `Captured ${trace.createdAt ? new Date(trace.createdAt).toLocaleString() : ''}. Playback is not a live process.`
            : `${scenario.assumption} Runtime values remain unknown.`}
        </span>
      </div>
      {(error || progressError) && (
        <p role="alert" className="journey-alert">
          {error || progressError}
        </p>
      )}
      <section className="journey-timeline-panel">
        <div className="journey-row-between">
          <h2>Follow the thread</h2>
          <span className="journey-step-count">
            Event {state.index + 1} of {trace.events.length}
          </span>
        </div>
        <div className="journey-scenario-controls">
          <label>
            Selected path
            <select
              aria-label="Journey scenario"
              value={scenario.id}
              onChange={(e) => selectScenario(e.target.value)}
            >
              {journey.scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <span>
            Changing the path opens an explained scenario. It never changes a captured trace.
          </span>
        </div>
        <JourneyRope
          journey={journey}
          trace={trace}
          playback={state}
          onJump={(index) => dispatch({ type: 'jump', index })}
          onChoose={selectScenario}
          drawerOpen={questionOpen}
        />
        <div className="journey-playback-controls">
          <Button icon={RotateCcw} onClick={() => dispatch({ type: 'restart' })}>
            Restart
          </Button>
          <Button
            icon={ArrowLeft}
            disabled={!state.index}
            onClick={() => dispatch({ type: 'back' })}
          >
            Back
          </Button>
          <Button
            variant="primary"
            icon={state.playing ? Pause : Play}
            disabled={blocked || state.completed}
            onClick={() => dispatch({ type: state.playing ? 'pause' : 'play' })}
          >
            {state.playing ? 'Pause' : 'Play'}
          </Button>
          <Button
            icon={ArrowRight}
            disabled={blocked || state.completed}
            onClick={() => dispatch({ type: 'next' })}
          >
            {state.index === trace.events.length - 1 ? 'Finish journey' : 'Next event'}
          </Button>
          <label>
            Speed
            <select
              aria-label="Playback speed"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {[0.5, 1, 1.5, 2].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </label>
          <progress
            value={state.visited.length}
            max={trace.events.length}
            aria-label="Visited path events"
          />
        </div>
      </section>
      <div className="journey-theater-grid">
        <section className="journey-source-panel" ref={sourcePanel}>
          <div className="journey-row-between">
            <h2>
              <Code2 size={17} />
              Source for this event
            </h2>
            <Button
              icon={ZoomIn}
              disabled={
                journey.origin === 'repository' &&
                (!repositorySource || repositorySource.file !== event.source.file)
              }
              onClick={() => {
                sourcePanel.current
                  ?.querySelector<HTMLButtonElement>('button[aria-label="Expand source code"]')
                  ?.click();
                sourcePanel.current?.scrollIntoView({ block: 'nearest' });
              }}
            >
              Zoom to source
            </Button>
          </div>
          <details className="journey-source-context">
            <summary>
              Source details · lines {event.source.startLine}–{event.source.endLine}
            </summary>
            <p>
              {event.source.file} · commit {(journey.commit || journey.sourceHash).slice(0, 12)}
            </p>
          </details>
          {sourceError && <p role="alert">{sourceError}</p>}
          {journey.origin === 'repository' && !repositorySource && !sourceError && (
            <p role="status">Loading the selected source file…</p>
          )}
          {(journey.origin !== 'repository' ||
            (repositorySource && repositorySource.file === event.source.file)) && (
            <RepositorySource
              ideTarget={journey.origin === 'repository' && journey.repository && journey.commit
                ? { snapshotId: journey.snapshotId, repository: journey.repository, commit: journey.commit }
                : undefined}
              compact
              source={{
                ...(repositorySource || {}),
                file: event.source.file,
                excerpt:
                  journey.origin === 'repository' ? repositorySource!.excerpt : journey.source,
                startLine: 1,
                endLine: (journey.origin === 'repository'
                  ? repositorySource!.excerpt
                  : journey.source
                ).split('\n').length,
                complete: true,
                linkLabel:
                  journey.origin === 'repository' ? 'Open on GitHub' : 'Open saved source evidence',
                url:
                  journey.origin === 'repository'
                    ? repositorySource!.url
                    : `/api/journey-snapshots/${journey.snapshotId}/source?referenceId=${encodeURIComponent(event.sourceRefId)}`,
              }}
              commit={journey.commit || journey.sourceHash}
              versionLabel={journey.origin === 'repository' ? 'commit' : 'source hash'}
              focusRange={event.source}
            />
          )}
          {trace.mode === 'observed_replay' && (
            <div className="journey-recorded-fields">
              <h3>Explicitly recorded fields</h3>
              <pre>{JSON.stringify(event.observedFields, null, 2)}</pre>
            </div>
          )}
        </section>
      </div>
      <JourneyQuestion
        key={event.id}
        event={event}
        trace={trace}
        level={level}
        open={questionOpen}
        onAsk={() => {
          dispatch({ type: 'pause' });
          if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        }}
        onClose={() => {
          setQuestionOpen(false);
          requestAnimationFrame(() => mentorLauncher.current?.focus());
        }}
        onResume={() => {
          setQuestionOpen(false);
          dispatch({ type: 'play' });
          requestAnimationFrame(() => mentorLauncher.current?.focus());
        }}
      >
        <div className="journey-levels" aria-label="Explanation level">
          {(['beginner', 'intermediate', 'advanced'] as const).map((value) => (
            <button key={value} aria-pressed={value === level} onClick={() => setLevel(value)}>
              {value}
            </button>
          ))}
        </div>
        {journey.origin === 'repository' && journey.repository && (
          <RelatedTeamKnowledge
            snapshotId={journey.snapshotId}
            referenceId={event.sourceRefId}
            repository={journey.repository}
          />
        )}
        <div className="journey-mentor-tools">
          <Button
            icon={Volume2}
            aria-label={voice ? 'Turn narration off' : 'Turn narration on'}
            aria-pressed={voice}
            onClick={() => {
              if (!('speechSynthesis' in window)) {
                setVoiceError('This browser does not support speech. Text remains available.');
                return;
              }
              setVoice(!voice);
            }}
          >
            Narration {voice ? 'on' : 'off'}
          </Button>
        </div>
        <details className="journey-visual-details">
          <summary>Visual explanation</summary>
          <JourneyScene event={event} journey={journey} level={level} alternative={false} />
        </details>
        {voiceError && <p role="status">{voiceError}</p>}
        {event.prediction && (
          <div className="journey-prediction">
            <span className="eyebrow">PAUSE / MAKE A PREDICTION</span>
            <h3>{event.prediction.question}</h3>
            {event.prediction.options.map((option) => (
              <button
                key={option.id}
                disabled={!!prediction}
                aria-pressed={prediction?.answer === option.id}
                onClick={() => dispatch({ type: 'answer', answer: option.id })}
              >
                {option.text}
              </button>
            ))}
            {prediction && (
              <p role="status">
                {prediction.correct ? 'Correct.' : 'Review the source condition.'}{' '}
                {event.prediction.options.find((o) => o.id === event.prediction!.correct)?.text}{' '}
                {!prediction.correct &&
                  'You can choose Beginner for a simpler explanation; your level remains your choice.'}
              </p>
            )}
          </div>
        )}
        <details className="journey-event-facts" open={level === 'advanced'}>
          <summary>Operation, values & evidence</summary>
          <dl>
            <dt>Source condition</dt>
            <dd>
              <code>{event.condition}</code>
            </dd>
            <dt>Inputs / outputs</dt>
            <dd>
              {trace.mode === 'observed_replay'
                ? 'Only explicitly recorded fields below are known; other inputs and outputs remain unknown.'
                : journey.origin === 'repository'
                  ? `${event.inputs} ${event.outputs}`
                  : 'unknown / unknown'}
            </dd>
            <dt>State changes / side effects</dt>
            <dd>
              {trace.mode === 'observed_replay'
                ? JSON.stringify(event.observedFields)
                : event.sideEffects}
            </dd>
            <dt>Next relationship</dt>
            <dd>
              {trace.events[state.index + 1]?.title || 'End of this path'} ·{' '}
              {trace.mode === 'observed_replay'
                ? 'recorded sequence'
                : journey.origin === 'repository'
                  ? 'resolved static connection; execution order unknown'
                  : 'reviewed possible path'}
            </dd>
            <dt>Coverage</dt>
            <dd>{event.observationCoverage}</dd>
            {event.connections && event.connections.length > 0 && (
              <>
                <dt>Connection evidence</dt>
                <dd>
                  {event.connections.map((connection) => (
                    <p key={connection.referenceId}>
                      <a href={connection.source.url} target="_blank" rel="noreferrer">
                        {connection.type.replaceAll('_', ' ')} · {connection.source.file}:L
                        {connection.source.startLine}–{connection.source.endLine}
                      </a>
                    </p>
                  ))}
                </dd>
              </>
            )}
            {event.timestamp && (
              <>
                <dt>Recorded time</dt>
                <dd>{event.timestamp}</dd>
              </>
            )}
          </dl>
        </details>
      </JourneyQuestion>
      {!questionOpen && (
        <button
          type="button"
          ref={mentorLauncher}
          className="journey-mentor-launcher"
          aria-label="Ask Shishimaru"
          title="Open mentor"
          aria-expanded={false}
          aria-controls="shishimaru-mentor-panel"
          onClick={() => ask(true)}
        >
          <span className="journey-launcher-art">
            <img
              src="/mentor/shishimaru-welcoming.png"
              alt="Shishimaru, your code mentor"
              width="84"
              height="92"
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = '/codebase_mentor_logo_transparent.svg';
              }}
            />
            <MessageSquare size={16} />
          </span>
        </button>
      )}
      {journey.origin === 'repository' ? (
        <section className="journey-run-panel">
          <div>
            <h2>Source evidence, without invented execution</h2>
            <p>
              This repository has no approved runtime capture recipe. You are exploring actual saved
              components and source links; runtime values and branch outcomes remain unknown.
            </p>
          </div>
        </section>
      ) : (
        <JourneyRunPanel
          journey={journey}
          trace={trace}
          scenario={scenario}
          onTrace={openTrace}
          onPause={() => dispatch({ type: 'pause' })}
        />
      )}
      <details className="journey-coverage">
        <summary>Evidence boundaries & missing spans</summary>
        {trace.coverage.map((c) => (
          <p key={c}>{c}</p>
        ))}
        <p>
          Framework internals, unsupported async boundaries and missing spans remain unknown. No
          arbitrary repository code runs here.
        </p>
      </details>
      {state.completed && (
        <section className="journey-complete" role="status">
          <InteractiveBrandMentor mode="complete" />
          <span className="journey-complete-badge">
            <CheckCheck size={14} /> Path explored
          </span>
          <h2>You followed this path to its end.</h2>
          <p>
            {scenario.outcome} Playback completion is a learning checkpoint, not a successful test
            or deployment verdict.
          </p>
          <div className="journey-related">
            {journey.related.map((id) => (
              <Link key={id} to={`/learn/${id}`}>
                Explore {id}
                <ArrowRight size={14} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
