import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CircleDashed,
  Compass,
  Download,
  FlaskConical,
  GitPullRequest,
  LocateFixed,
  RotateCcw,
  Target,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  DemoNote,
  Modal,
  PageHeading,
  PanelHeading,
  TiltCard,
} from '../components/UI';
import { journeys } from '../data/fixtures';
import { getJourneySteps } from '../domain/model';
import { useWorkspace } from '../state/WorkspaceContext';
import { RelearningCard } from '../components/RelearningCard';
import { buildProgressReportSnapshot } from '../domain/progressSelectors';
import { RepositoryProgress } from '../components/RepositoryProgress';

export default function Progress() {
  const [sample, setSample] = useState(false);
  if (!sample) return <RepositoryProgress onSample={() => setSample(true)} />;
  return <><Button onClick={() => setSample(false)}>Back to repository progress</Button><SampleProgress /></>;
}

function SampleProgress() {
  const { state, learningEvents, startJourney, reset, notify } = useWorkspace();
  const go = useNavigate();
  const [resetOpen, setResetOpen] = useState(false);

  const attempts = Object.entries(state.predictions)
    .map(([key, prediction]) => {
      const [id, scenario, snapshot, stepId] = key.split(':');
      const check =
        (id === 'signup' || id === 'login') && (snapshot === 'base' || snapshot === 'head')
          ? getJourneySteps(id, scenario as 'success' | 'duplicate' | 'invalid', snapshot).find(
              (s) => s.id === stepId,
            )?.check
          : undefined;
      return { key, prediction, check, id, scenario, snapshot, stepId };
    })
    .filter((x) => x.check);
  const report = useMemo(
    () => buildProgressReportSnapshot(state, learningEvents),
    [state, learningEvents],
  );

  function exportData() {
    const { predictions, completed, review, profile, goal, practiceResult, hints } = state;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            schema: 1,
            repository: 'acme/relay-api (synthetic sample)',
            evidence: 'Local frontend interactions; no real execution or peer study',
            predictions,
            completed,
            review,
            profile,
            goal,
            practiceResult,
            hints,
            learningEvents,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'codebase-mentor-learning.json';
    link.click();
    URL.revokeObjectURL(url);
    notify('Local learning activity exported.');
  }

  return (
    <div className="progress-report-page">
      <PageHeading
        className="progress-page-heading"
        eyebrow="MY PROGRESS"
        title="My Progress & Updates"
        description="A record of what you explored, what you explained, and what deserves another look."
        actions={
          <>
            <Button icon={Download} magnetic onClick={exportData}>
              Export learning activity
            </Button>
            <Button icon={BookOpen} magnetic onClick={() => window.print()}>
              Print / Save as PDF
            </Button>
          </>
        }
      />
      <div className="progress-summary-grid">
        {[
          {
            icon: Compass,
            title: 'Journeys completed',
            value: `${report.summary.journeysCompleted} / ${report.summary.journeyTotal}`,
            note: 'Explored to the final step',
            tone: 'violet',
          },
          {
            icon: Target,
            title: 'First-attempt predictions',
            value: report.summary.checkpointCount ? `${report.summary.checkpointFirstCorrect} / ${report.summary.checkpointCount}` : 'Not assessed',
            note: report.summary.checkpointCount
              ? 'First-attempt results from recorded checkpoint answers'
              : 'Answer a journey checkpoint to begin',
            tone: 'blue',
          },
          {
            icon: FlaskConical,
            title: 'Contribution practice',
            value: report.summary.practice,
            note: 'Local schema assertions · full API not executed',
            tone: 'green',
          },
          {
            icon: GitPullRequest,
            title: 'Concepts to revisit',
            value: String(report.summary.reviewCount),
            note: 'Studied concepts flagged by the sample update',
            tone: 'amber',
          },
        ].map(({ icon: Icon, title, value, note, tone }) => (
          <TiltCard className="panel progress-stat" key={title} maxTilt={5}>
            <span className={`stat-icon ${tone}`}>
              <Icon size={19} />
            </span>
            <span className="stat-title">{title}</span>
            <strong>{value}</strong>
            <p>{note}</p>
          </TiltCard>
        ))}
      </div>
      <div className="progress-layout">
        <div className="stack-20">
          <TiltCard className="panel" maxTilt={3}>
            <PanelHeading icon={BookOpen} title="Recorded learning evidence">
              <Badge tone="violet">Activity and assessment are separate</Badge>
            </PanelHeading>
            <div className="concept-list">
              {journeys.map((j) => (
                <div className="concept-row" key={j.id}>
                  <span
                    className={`concept-icon ${state.completed.includes(j.id) ? 'complete' : ''}`}
                  >
                    {state.completed.includes(j.id) ? (
                      <CheckCircle2 size={20} />
                    ) : (
                      <CircleDashed size={20} />
                    )}
                  </span>
                  <div>
                    <h3>
                      {j.id === 'signup'
                        ? 'Signup, validation, and account creation'
                        : 'Credential checks and token signing'}
                    </h3>
                    <p>
                      {state.review.includes(j.id)
                        ? 'Previously studied. The prepared email-verification update affects this flow.'
                        : state.completed.includes(j.id)
                          ? 'Journey completed. Review checkpoint evidence separately below.'
                          : 'Start a source-linked journey to explore this concept.'}
                    </p>
                  </div>
                  <Badge
                    tone={
                      state.review.includes(j.id)
                        ? 'amber'
                        : state.completed.includes(j.id)
                          ? 'green'
                          : 'neutral'
                    }
                  >
                    {state.review.includes(j.id)
                      ? 'Review suggested'
                      : state.completed.includes(j.id)
                        ? 'Studied'
                        : 'Not assessed'}
                  </Badge>
                  <button
                    className="concept-action"
                    aria-label={`Open ${j.id} journey`}
                    onClick={() => {
                      startJourney(j.id);
                      go('/demo-workspace');
                    }}
                  >
                    <ArrowRight size={16} />
                  </button>
                </div>
              ))}
            </div>
          </TiltCard>
          <TiltCard className="panel" maxTilt={3}>
            <PanelHeading icon={LocateFixed} title="Prediction evidence">
              <Badge tone="neutral">Hints used in workspace: {state.hints}</Badge>
            </PanelHeading>
            {attempts.length ? (
              <div className="assessment-list">
                {attempts.map(({ key, prediction, check, id, scenario, snapshot, stepId }) => (
                  <div className="assessment-row" key={key}>
                    <div>
                      <h3>{check?.question}</h3>
                      <p>
                        {id} / {scenario} · {stepId} · {snapshot} synthetic snapshot · {prediction.attempts}{' '}
                        {prediction.attempts === 1 ? 'attempt' : 'attempts'}
                      </p>
                    </div>
                    <div>
                      <Badge tone={prediction.first === check?.correct ? 'green' : 'amber'}>
                        First: {prediction.first === check?.correct ? 'correct' : 'needs review'}
                      </Badge>
                      {prediction.attempts > 1 && (
                        <small>
                          Latest:{' '}
                          {prediction.latest === check?.correct ? 'correct' : 'needs review'}
                        </small>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Target size={28} />
                <strong>Your first prediction is ahead.</strong>
                <p>
                  Checkpoint answers record specific understanding. Time on page and lesson
                  completion do not count as mastery.
                </p>
                <Button
                  icon={Compass}
                  magnetic
                  onClick={() => {
                    startJourney('signup');
                    go('/demo-workspace');
                  }}
                >
                  Try a signup checkpoint
                </Button>
              </div>
            )}
          </TiltCard>
          <TiltCard className="panel progress-evidence-panel" maxTilt={3}>
            <PanelHeading icon={Target} title="Skill map">
              <Badge tone="violet">Evidence counts, no proficiency score</Badge>
            </PanelHeading>
            <div className="progress-skill-list">
              {Object.entries(report.skills).map(([skill, item]) => (
                <div className="progress-skill-row" key={skill}>
                  <div>
                    <strong>{skill}</strong>
                    <small>{item.evidenceCount} supporting {item.evidenceCount === 1 ? 'record' : 'records'}</small>
                    {item.evidence.length > 0 && <p>{item.evidence.join(' · ')}</p>}
                  </div>
                  <Badge tone={item.state === 'Demonstrated' ? 'green' : item.state === 'Review suggested' ? 'amber' : 'neutral'}>{item.state}</Badge>
                </div>
              ))}
            </div>
          </TiltCard>
          <TiltCard className="panel progress-evidence-panel" maxTilt={3}>
            <PanelHeading icon={BookOpen} title="Learning timeline">
              <Badge tone="neutral">{report.timeline.length} dated events</Badge>
            </PanelHeading>
            {report.timeline.length ? (
              <ol className="progress-graphic-timeline" aria-label="Dated learning milestones in chronological order">
                {report.timeline.map((event) => (
                  <li key={event.id}>
                    <span className="progress-timeline-marker" aria-hidden="true" />
                    <div>
                      <time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time>
                      <strong>{event.type.replaceAll('_', ' ')}</strong>
                      <p>{event.journeyId ? `${event.journeyId} · ` : ''}{event.outcome}{event.reference ? ` · ${event.reference}` : ''}</p>
                      <Badge tone="neutral">{event.evidence.replaceAll('_', ' ')}</Badge>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="empty-state progress-empty-history">
                <BookOpen size={24} />
                <strong>No dated learning events yet.</strong>
                <p>Earlier saved progress has no reliable timestamps, so it is shown as evidence above and is not added to this timeline.</p>
              </div>
            )}
          </TiltCard>
        </div>
        <aside className="stack-20">
          {state.review.length > 0 && <RelearningCard />}
          <TiltCard className="next-activity" maxTilt={4}>
            <span className="tiny-label">NEXT USEFUL STEP</span>
            <Compass size={27} strokeWidth={1.4} />
            {report.nextStep ? <>
              <h2>{report.nextStep.title}</h2>
              <p>{report.nextStep.reason}</p>
              <small>Evidence: {report.nextStep.evidenceReference}</small>
              <Button variant="primary" icon={ArrowRight} magnetic onClick={() => {
                if (report.nextStep?.destination === '/demo-workspace') {
                  const journey = report.nextStep.evidenceReference.startsWith('signup') ? 'signup' : report.nextStep.evidenceReference.startsWith('login') ? 'login' : 'signup';
                  startJourney(journey);
                }
                go(report.nextStep!.destination);
              }}>Continue from here</Button>
            </> : <>
              <h2>No evidence-backed next step is available.</h2>
              <p>Current records do not point to a specific action. Continue exploring when you are ready.</p>
            </>}
          </TiltCard>
          <TiltCard className="panel data-controls" maxTilt={4}>
            <h3>Your activity, in your browser.</h3>
            <p>Minimal learning data is stored locally. Export it at any time or start fresh.</p>
            <Button variant="ghost" icon={RotateCcw} onClick={() => setResetOpen(true)}>
              Reset local learning data
            </Button>
            <DemoNote>No peer-study results are fabricated</DemoNote>
          </TiltCard>
        </aside>
      </div>
      <section className="progress-print-report" aria-hidden="true">
        <header className="print-report-header">
          <p>CODEBASE MENTOR · LEARNER REPORT · TEMPLATE 1</p>
          <h1>My Learning Progress</h1>
          <p>Generated {new Date(report.generatedAt).toLocaleString()}</p>
          <p>{report.repository} · local browser evidence</p>
          <p>Reporting period: {report.reportingPeriod ? `${new Date(report.reportingPeriod.from).toLocaleDateString()} – ${new Date(report.reportingPeriod.to).toLocaleDateString()}` : 'No dated events recorded'}</p>
        </header>
        <section>
          <h2>Learning snapshot</h2>
          <div className="print-report-metrics">
            <p><strong>Journeys completed</strong><br />{report.summary.journeysCompleted} of {report.summary.journeyTotal}</p>
            <p><strong>First-attempt checkpoints</strong><br />{report.summary.checkpointCount ? `${report.summary.checkpointFirstCorrect} correct of ${report.summary.checkpointCount}` : 'Not assessed'}</p>
            <p><strong>Contribution practice</strong><br />{report.summary.practice}</p>
            <p><strong>Review suggestions</strong><br />{report.summary.reviewCount}</p>
          </div>
        </section>
        <section>
          <h2>Assessment rubric and skills</h2>
          <table>
            <thead><tr><th>Skill</th><th>Evidence state</th><th>Evidence recorded</th></tr></thead>
            <tbody>{Object.entries(report.skills).map(([skill, item]) => (
              <tr key={skill}><th>{skill}</th><td>{item.state}</td><td>{item.evidenceCount ? item.evidence.join('; ') : 'No suitable evidence recorded'}</td></tr>
            ))}</tbody>
          </table>
          <p>Journey activity alone does not demonstrate mastery. “Demonstrated” applies only to the scoped checkpoint or local assertion shown in its evidence.</p>
        </section>
        <section>
          <h2>Journey progress</h2>
          <table>
            <thead><tr><th>Journey</th><th>Status</th></tr></thead>
            <tbody>{journeys.map((journey) => (
              <tr key={journey.id}><th>{journey.title}</th><td>{state.completed.includes(journey.id) ? 'Completed · activity evidence' : 'Not completed'}</td></tr>
            ))}</tbody>
          </table>
        </section>
        <section>
          <h2>Checkpoint evidence</h2>
          {attempts.length ? <ul>{attempts.map(({ key, prediction, check, id, scenario, snapshot, stepId }) => (
            <li key={key}>{id} / {scenario} · {stepId} · {snapshot} synthetic snapshot: first attempt {prediction.first === check?.correct ? 'correct' : 'incorrect'}; {prediction.attempts} attempt(s){prediction.attempts > 1 ? `; latest ${prediction.latest === check?.correct ? 'correct' : 'incorrect'}` : ''}.</li>
          ))}</ul> : <p>Not assessed. No checkpoint answers are recorded in the current workspace.</p>}
        </section>
        <section>
          <h2>Practice and review</h2>
          <p><strong>Practice:</strong> {report.summary.practice}. Local schema assertions do not represent full API or sandbox execution.</p>
          {state.review.length ? <ul>{state.review.map((item) => <li key={item}>{item}: review suggested against the prepared PR #402 synthetic update. Prior assessment outcomes are unchanged.</li>)}</ul> : <p>No current review suggestions.</p>}
        </section>
        <section>
          <h2>Dated learning milestones</h2>
          {report.timeline.length ? <ol>{report.timeline.map((event) => (
            <li key={event.id}>{new Date(event.timestamp).toLocaleString()} · {event.type.replaceAll('_', ' ')} · {event.outcome} · {event.evidence.replaceAll('_', ' ')}{event.journeyId ? ` · ${event.journeyId}` : ''}{event.reference ? ` · ${event.reference}` : ''}</li>
          ))}</ol> : <p>No dated learning events are available. Existing local progress records have no reliable historical timestamps.</p>}
        </section>
        {report.nextStep && <section><h2>Suggested next step</h2><p><strong>{report.nextStep.title}.</strong> {report.nextStep.reason} Evidence: {report.nextStep.evidenceReference}.</p></section>}
        <footer><p>Synthetic sample repository; local-only evidence. No mentor review, peer-study result, full source, secret, or private chat is included.</p></footer>
      </section>
      <Modal
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Start fresh in this browser?"
        description="This clears local journey completions, answers, practice, and maintainer demo records."
      >
        <div className="dialog-body stack-16">
          <p>
            Export learning activity first if you want to keep a copy. This affects only this
            prototype’s local data.
          </p>
          <div className="row gap-8">
            <Button onClick={() => setResetOpen(false)}>Keep my activity</Button>
            <Button
              variant="danger"
              onClick={() => {
                reset();
                setResetOpen(false);
              }}
            >
              Reset local data
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
