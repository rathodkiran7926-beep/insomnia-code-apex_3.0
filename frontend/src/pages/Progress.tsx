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
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScrollReveal } from '../animations/gsapHooks';
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

export default function Progress() {
  const { state, startJourney, reset, notify } = useWorkspace();
  const go = useNavigate();
  const [resetOpen, setResetOpen] = useState(false);
  const metricsRef = useScrollReveal<HTMLDivElement>({ stagger: 0.1 });
  const layoutRef = useScrollReveal<HTMLDivElement>({ stagger: 0.12 });

  const attempts = Object.entries(state.predictions)
    .map(([key, prediction]) => {
      const [id, scenario, snapshot, stepId] = key.split(':');
      const check =
        (id === 'signup' || id === 'login') && (snapshot === 'base' || snapshot === 'head')
          ? getJourneySteps(id, scenario as 'success' | 'duplicate' | 'invalid', snapshot).find(
              (s) => s.id === stepId,
            )?.check
          : undefined;
      return { key, prediction, check, id, snapshot };
    })
    .filter((x) => x.check);
  const correct = attempts.filter((x) => x.prediction.first === x.check?.correct).length;
  const completed = journeys.filter((j) => state.completed.includes(j.id));

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
    <>
      <PageHeading
        eyebrow="MY PROGRESS"
        title="Understanding is built, one connection at a time."
        description="A record of what you explored, what you explained, and what deserves another look."
        actions={
          <Button icon={Download} magnetic onClick={exportData}>
            Export learning activity
          </Button>
        }
      />
      <div ref={metricsRef} className="progress-summary-grid">
        {[
          {
            icon: Compass,
            title: 'Journeys completed',
            value: `${completed.length} / 2`,
            note: 'Explored to the final step',
            tone: 'violet',
          },
          {
            icon: Target,
            title: 'First-attempt predictions',
            value: attempts.length ? `${correct} / ${attempts.length}` : 'Not assessed',
            note: attempts.length
              ? 'Correct before retrying'
              : 'Answer a journey checkpoint to begin',
            tone: 'blue',
          },
          {
            icon: FlaskConical,
            title: 'Contribution practice',
            value: state.practiceResult === 'solution' ? 'Assertions passed' : 'Not completed',
            note: 'Local schema assertions · full API not executed',
            tone: 'green',
          },
          {
            icon: GitPullRequest,
            title: 'Concepts to revisit',
            value: String(state.review.length),
            note: 'Studied material affected by a change',
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
      <div ref={layoutRef} className="progress-layout">
        <div className="stack-20">
          <TiltCard className="panel" maxTilt={3}>
            <PanelHeading icon={BookOpen} title="What you can now connect">
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
                        ? 'Previously studied. Email verification changes this flow.'
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
                      ? 'Needs review'
                      : state.completed.includes(j.id)
                        ? 'Studied'
                        : 'Not assessed'}
                  </Badge>
                  <button
                    className="concept-action"
                    aria-label={`Open ${j.id} journey`}
                    onClick={() => {
                      startJourney(j.id);
                      go('/workspace');
                    }}
                  >
                    <ArrowRight size={16} />
                  </button>
                </div>
              ))}
            </div>
          </TiltCard>
          <TiltCard className="panel" maxTilt={3}>
            <PanelHeading icon={LocateFixed} title="Prediction evidence" />
            {attempts.length ? (
              <div className="assessment-list">
                {attempts.map(({ key, prediction, check, id, snapshot }) => (
                  <div className="assessment-row" key={key}>
                    <div>
                      <h3>{check?.question}</h3>
                      <p>
                        {id} · {snapshot} demo snapshot · {prediction.attempts}{' '}
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
                    go('/workspace');
                  }}
                >
                  Try a signup checkpoint
                </Button>
              </div>
            )}
          </TiltCard>
          <TiltCard className="panel measurement-note" maxTilt={3}>
            <LocateFixed size={22} />
            <div>
              <h3>Some things still need real assessment.</h3>
              <p>
                Code-location accuracy, independent explanations, sandbox-verified contributions,
                and peer-study outcomes have not been assessed. No broad skill score is inferred
                from this demo activity.
              </p>
            </div>
          </TiltCard>
        </div>
        <aside className="stack-20">
          {state.review.length > 0 && <RelearningCard />}
          <TiltCard className="next-activity" maxTilt={4}>
            <span className="tiny-label">A USEFUL NEXT STEP</span>
            <Compass size={27} strokeWidth={1.4} />
            <h2>
              {state.review.length
                ? 'Reconnect with the changed code.'
                : completed.length
                  ? 'Put your understanding into practice.'
                  : 'Follow your first request.'}
            </h2>
            <p>
              {state.review.length
                ? 'Email verification changed the account lifecycle. Compare the source and revisit the new guard.'
                : completed.length
                  ? 'Try the password-validation contribution and run the local schema assertions.'
                  : 'The signup journey connects the architecture, source code, and two decision checkpoints.'}
            </p>
            <Button
              variant="primary"
              icon={ArrowRight}
              magnetic
              onClick={() => {
                if (state.review.length) go('/changes');
                else if (completed.length) go('/practice');
                else {
                  startJourney('signup');
                  go('/workspace');
                }
              }}
            >
              Continue from here
            </Button>
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
    </>
  );
}
