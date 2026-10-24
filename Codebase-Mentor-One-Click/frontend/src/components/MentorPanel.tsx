import { useState } from 'react';
import {
  ArrowRight,
  ArrowUp,
  BookOpen,
  ChevronRight,
  Compass,
  GitPullRequest,
  Lightbulb,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { graphNodes, versions } from '../data/fixtures';
import { getJourneySteps } from '../domain/model';
import { useWorkspace } from '../state/WorkspaceContext';
import { Badge, Button, SourceLink } from './UI';
import { JourneyPlayer } from './JourneyPlayer';
import { useEffect, useRef } from 'react';

export function MentorPanel() {
  const { state, patch, startJourney, selectNode } = useWorkspace();
  const go = useNavigate();
  const node = graphNodes.find((x) => x.id === state.selectedNode)!;
  const step = state.journeyId
    ? getJourneySteps(state.journeyId, state.scenario, state.snapshot)[state.step]
    : null;
  const [tab, setTab] = useState<'mentor' | 'inspector'>('mentor');
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.journeyId) setTab('mentor');
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [state.journeyId, state.step, state.snapshot]);
  const isWhy = /why|reason|decision/i.test(asked);
  const isValidation = /valid|password|input/i.test(asked);
  const relatedSource = isValidation
    ? { path: 'src/middleware/validate.ts', start: 10, end: 16 }
    : { path: 'src/services/user.service.ts', start: 9, end: 13 };
  function ask(value: string) {
    if (!value.trim()) return;
    setAsked(value.trim());
    setQuestion('');
  }
  return (
    <aside className="panel mentor-panel">
      <div className="mentor-tabs">
        <button className={tab === 'mentor' ? 'active' : ''} onClick={() => setTab('mentor')}>
          <Sparkles size={15} />
          Your mentor
        </button>
        <button className={tab === 'inspector' ? 'active' : ''} onClick={() => setTab('inspector')}>
          <MessageSquareText size={14} />
          Inspector
        </button>
        <span className="mentor-presence" title="Prepared demo responses" />
      </div>
      <div className="mentor-body" ref={bodyRef}>
        {tab === 'mentor' ? (
          <>
            {state.journeyId && <JourneyPlayer mode="details" />}
            <div className={`mentor-intro ${state.journeyId ? 'journey-replaced' : ''}`}>
              <span className="mentor-orbit">
                <Sparkles size={20} strokeWidth={1.6} />
              </span>
              <div>
                <strong>A little context goes a long way.</strong>
                <span>Let’s make this codebase click.</span>
              </div>
            </div>
            <div className={`mentor-selection ${state.journeyId ? 'journey-replaced' : ''}`}>
              <div className="tiny-label">{step ? 'YOUR CURRENT STEP' : 'YOU’RE EXPLORING'}</div>
              <div className="row between">
                <h3>{step?.title ?? node.label}</h3>
                <span className="selection-dot" />
              </div>
              <p>
                {state.detail === 'technical'
                  ? (step?.technical ?? node.technical)
                  : (step?.explanation ?? node.description)}
              </p>
              {(step?.source ?? node.source) && (
                <SourceLink source={step?.source ?? node.source!} />
              )}
              <div className="mentor-evidence-label">
                <ShieldCheck size={12} />
                Sample source · {versions[state.snapshot].commit}
              </div>
            </div>
            <div className="detail-toggle">
              <button
                className={state.detail === 'beginner' ? 'active' : ''}
                onClick={() => patch({ detail: 'beginner' })}
              >
                Keep it simple
              </button>
              <button
                className={state.detail === 'technical' ? 'active' : ''}
                onClick={() => patch({ detail: 'technical' })}
              >
                Go technical
              </button>
            </div>
            {!state.journeyId && (
              <div className="mentor-journey">
                <div className="row gap-8">
                  <Compass size={16} />
                  <span className="tiny-label">CONNECT THE DOTS</span>
                </div>
                <h3>Follow a signup request</h3>
                <p>See where this component fits, from the first request to a new account.</p>
                <button onClick={() => startJourney('signup')}>
                  Start the code journey
                  <ArrowRight size={15} />
                </button>
                <div className="journey-meta">
                  <span>6 steps</span>
                  <i />8 min<span>·</span>
                  <span>2 checkpoints</span>
                </div>
              </div>
            )}
            <div className="ask-suggestions">
              <div className="tiny-label">GOOD QUESTIONS TO ASK</div>
              {[
                'Where does validation happen?',
                'What if the email already exists?',
                'Why separate the service and repository?',
              ].map((x) => (
                <button key={x} onClick={() => ask(x)}>
                  {x}
                  <ChevronRight size={12} />
                </button>
              ))}
            </div>
            {asked && (
              <div className="mentor-answer" aria-live="polite">
                <span className="tiny-label">PREPARED DEMO ANSWER</span>
                <strong>{asked}</strong>
                {isWhy ? (
                  <>
                    <p>
                      The source shows the separation, but cannot establish the original reason. A
                      maintainer explanation is needed.
                    </p>
                    <button className="text-link" onClick={() => go('/knowledge')}>
                      Open the knowledge-gap question <ArrowRight size={13} />
                    </button>
                  </>
                ) : /valid|password|input|email|account|signup/i.test(asked) ? (
                  <>
                    <p>
                      {isValidation
                        ? 'validateSignup checks the request with signupSchema. Invalid input returns 400 before next() is called.'
                        : 'The service looks up the email and throws ConflictError if it exists. That prevents the later account insert, although the lookup itself accesses storage.'}
                    </p>
                    <SourceLink source={relatedSource} />
                    <button
                      className="text-link"
                      onClick={() => selectNode(isValidation ? 'validation' : 'user-service')}
                    >
                      Show on map <ArrowRight size={12} />
                    </button>
                  </>
                ) : (
                  <p>
                    This prototype has prepared answers for validation, duplicate emails, and design
                    rationale. Try one of the questions above; open-ended AI answers are not
                    connected.
                  </p>
                )}
              </div>
            )}
            {state.decision === 'published' && (
              <div className="approved-knowledge">
                <Badge tone="green">Approved demo rationale</Badge>
                <p>{state.rationale}</p>
                <button className="text-link" onClick={() => go('/knowledge')}>
                  View decision and provenance <ArrowRight size={12} />
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="inspector-content stack-20">
            {step?.check && <JourneyPlayer mode="details" />}
            <div>
              <span className="tiny-label">COMPONENT INSPECTOR</span>
              <h3>{node.label}</h3>
              <Badge tone={node.category === 'external' ? 'amber' : 'violet'}>
                {node.category}
              </Badge>
            </div>
            <p>{node.technical}</p>
            <div>
              <span className="tiny-label">SOURCE LOCATION</span>
              {node.source ? (
                <SourceLink source={node.source} />
              ) : (
                <p className="muted">Conceptual external entity; no source location.</p>
              )}
            </div>
            <div>
              <span className="tiny-label">VERSION IDENTITY</span>
              <p className="mono">{versions[state.snapshot].commit}</p>
              <p className="muted">{versions[state.snapshot].branch}</p>
            </div>
            <div className="info-callout">
              <Lightbulb size={17} />
              <p>
                Source facts describe implementation. Historical reasons need documented intent;
                runtime claims need execution evidence.
              </p>
            </div>
            <Button
              icon={BookOpen}
              onClick={() => {
                startJourney('signup');
                go('/demo-workspace');
              }}
            >
              Related signup journey
            </Button>
            <Button icon={GitPullRequest} onClick={() => go('/changes')}>
              Explore related changes
            </Button>
          </div>
        )}
      </div>
      <form
        className="mentor-composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <label className="sr-only" htmlFor="mentor-question">
          Ask about this codebase
        </label>
        <input
          id="mentor-question"
          placeholder="Ask about this codebase..."
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button aria-label="Ask mentor" disabled={!question.trim()}>
          <ArrowUp size={15} />
        </button>
        <span>Prepared responses · grounded in sample source</span>
      </form>
    </aside>
  );
}
