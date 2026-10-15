import { useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Compass,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { journeys } from '../data/fixtures';
import type { Scenario } from '../data/types';
import { canAdvance, getJourneySteps } from '../domain/model';
import { useWorkspace } from '../state/WorkspaceContext';
import { Badge, Button, IconButton, SourceLink } from './UI';

export function JourneyPlayer({ mode = 'full' }: { mode?: 'full' | 'controls' | 'details' }) {
  const { state, patch, next, goStep, predict, startJourney } = useWorkspace();
  const go = useNavigate();
  const journey = journeys.find((x) => x.id === state.journeyId);
  const steps = journey ? getJourneySteps(journey.id, state.scenario, state.snapshot) : [];
  const step = steps[state.step];
  const key = `${state.journeyId}:${state.scenario}:${state.snapshot}:${step?.id}`;
  const prediction = state.predictions[key];
  const blocked = !canAdvance(Boolean(step?.check), prediction);
  const finished = Boolean(
    journey &&
    state.completedRuns.includes(`${journey.id}:${state.scenario}:${state.snapshot}`) &&
    state.step === steps.length - 1 &&
    (!state.activeLesson || state.completed.includes(state.activeLesson)),
  );
  useEffect(() => {
    if (mode === 'details' || !state.playing || !journey) return;
    const timer = setInterval(next, 4800);
    return () => clearInterval(timer);
  }, [state.playing, state.step, state.journeyId, next, journey]);
  useEffect(() => {
    if (mode === 'details' || !journey) return;
    const handle = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input, textarea, select, [role="dialog"], [role="application"]',
        ) ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goStep(state.step - 1);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [journey, state.step, next, goStep]);
  if (!journey || !step) return null;
  return (
    <section className={`journey-player journey-player-${mode}`}>
      <div className="journey-player-top">
        <div className="row gap-10">
          <span className="journey-icon">
            <Compass size={19} />
          </span>
          <div>
            <span className="tiny-label">FOLLOW THE REQUEST</span>
            <h2>{journey.title}</h2>
          </div>
        </div>
        <div className="row gap-10">
          <Badge tone="violet">Explained path</Badge>
          <label className="scenario-select">
            <select
              aria-label="Journey scenario"
              value={state.scenario}
              onChange={(e) =>
                startJourney(journey.id, e.target.value as Scenario, state.activeLesson)
              }
            >
              <option value="success">
                {journey.id === 'signup' ? 'New account' : 'Valid credentials'}
              </option>
              {journey.id === 'signup' && <option value="duplicate">Existing email</option>}
              <option value="invalid">
                {journey.id === 'signup' ? 'Invalid input' : 'Invalid credentials'}
              </option>
            </select>
          </label>
          <IconButton
            icon={X}
            label="Exit journey"
            onClick={() => patch({ journeyId: null, playing: false })}
          />
        </div>
      </div>
      <div className="journey-timeline" role="list" aria-label="Journey steps">
        {steps.map((item, i) => (
          <button
            role="listitem"
            key={item.id}
            className={`timeline-step ${i === state.step ? 'current' : ''} ${i < state.step ? 'past' : ''}`}
            onClick={() => goStep(i)}
            aria-current={i === state.step ? 'step' : undefined}
          >
            <span className="timeline-number">{i < state.step ? <Check size={12} /> : i + 1}</span>
            <span>{item.short}</span>
            {item.check && <CircleHelp size={11} className="step-check-icon" />}
          </button>
        ))}
      </div>
      <div className="journey-active">
        <div className="journey-explanation">
          <div className="row gap-8">
            <Badge>
              Step {state.step + 1} of {steps.length}
            </Badge>
            {step.check && <Badge tone="amber">Prediction checkpoint</Badge>}
          </div>
          <h3>{step.title}</h3>
          <p>{state.detail === 'technical' ? step.technical : step.explanation}</p>
          <SourceLink source={step.source} />
        </div>
        {step.check ? (
          <div className="prediction-card">
            <div className="row gap-8">
              <CircleHelp size={15} className="violet-text" />
              <span className="tiny-label">PAUSE. MAKE A PREDICTION.</span>
            </div>
            <strong>{step.check.question}</strong>
            <div className="prediction-options">
              {step.check.options.map((option) => (
                <button
                  key={option.id}
                  className={
                    prediction?.latest === option.id
                      ? option.id === step.check!.correct
                        ? 'answer-correct'
                        : 'answer-incorrect'
                      : ''
                  }
                  onClick={() => predict(option.id)}
                >
                  <span className="radio-dot" />
                  {option.text}
                  {prediction?.latest === option.id && option.id === step.check!.correct && (
                    <Check size={14} />
                  )}
                </button>
              ))}
            </div>
            {prediction && (
              <div
                className={`prediction-feedback ${prediction.latest === step.check.correct ? 'correct' : 'incorrect'}`}
                role="status"
              >
                <strong>
                  {prediction.latest === step.check.correct
                    ? 'You found the deciding condition.'
                    : 'Let’s inspect the condition.'}
                </strong>
                <p>{step.check.explanation}</p>
                <small>
                  First attempt:{' '}
                  {prediction.first === step.check.correct ? 'correct' : 'needs review'} ·{' '}
                  {prediction.attempts} {prediction.attempts === 1 ? 'attempt' : 'attempts'}
                </small>
              </div>
            )}
          </div>
        ) : (
          <div className="journey-context">
            <span className="tiny-label">WHAT TO NOTICE</span>
            <p>
              {state.scenario === 'invalid' && state.step === steps.length - 1
                ? 'This is the failure boundary. The invalid request stops here.'
                : state.scenario === 'duplicate' && state.step === steps.length - 1
                  ? 'A lookup happened. An insert did not. Inspect the throw before continuing.'
                  : 'Keep an eye on the highlighted source. Each step explains a possible path through this sample code.'}
            </p>
            <span>
              <span className="status-dot" />
              {state.snapshot === 'head' ? 'PR preview source' : 'Base source'} · not executed
            </span>
          </div>
        )}
      </div>
      <div className="journey-controls">
        <div className="row gap-8">
          <IconButton
            icon={RotateCcw}
            label="Restart journey"
            onClick={() => startJourney(journey.id, state.scenario, state.activeLesson)}
          />
          <Button
            icon={blocked ? CircleHelp : state.playing ? Pause : Play}
            disabled={finished}
            onClick={() => {
              if (blocked) {
                const targets = Array.from(document.querySelectorAll('.prediction-card'));
                const visible = targets.find((el) => (el as HTMLElement).offsetParent !== null);
                visible?.scrollIntoView({
                  behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                    ? 'instant'
                    : 'smooth',
                  block: 'center',
                });
              } else patch({ playing: !state.playing });
            }}
          >
            {blocked ? 'Answer checkpoint' : state.playing ? 'Pause' : 'Play'}
          </Button>
          <span className="playback-note">Your pace. Pause at every decision.</span>
        </div>
        <div className="row gap-8">
          <Button
            icon={ChevronLeft}
            disabled={state.step === 0}
            onClick={() => goStep(state.step - 1)}
          >
            Previous
          </Button>
          {finished ? (
            <Button variant="primary" icon={ArrowRight} onClick={() => go('/practice')}>
              Continue to practice
            </Button>
          ) : (
            <Button variant="primary" onClick={next} disabled={blocked}>
              {state.step === steps.length - 1
                ? state.scenario === 'success'
                  ? 'Complete journey'
                  : 'Complete scenario'
                : 'Next step'}
              <ChevronRight size={15} />
            </Button>
          )}
        </div>
      </div>
      {finished && (
        <div className="journey-completed" role="status">
          <Check size={15} />
          Scenario completed. Your learning evidence is saved locally.
          <button onClick={() => go('/progress')}>
            View progress <ArrowLeft size={12} />
          </button>
        </div>
      )}
    </section>
  );
}
