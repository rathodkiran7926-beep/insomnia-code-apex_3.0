import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Code2,
  FlaskConical,
  Lightbulb,
  Play,
  RotateCcw,
  WandSparkles,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useScrollReveal } from '../animations/gsapHooks';
import { CodeViewer } from '../components/CodeViewer';
import {
  Badge,
  Button,
  ChecklistItem,
  PageHeading,
  PanelHeading,
  SourceLink,
  TiltCard,
} from '../components/UI';
import { hints, initialPractice, solutionPractice } from '../data/fixtures';
import { runPracticeChecks } from '../domain/practice';
import { demoService } from '../services/demoService';
import { useWorkspace } from '../state/WorkspaceContext';

export default function Practice() {
  const { state, patch, startJourney, applyPracticeResult } = useWorkspace();
  const go = useNavigate();
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState('exercise');
  const [located, setLocated] = useState(false);
  const [reflection, setReflection] = useState('');
  const [saved, setSaved] = useState(false);
  const passing = state.practiceResult === 'solution';
  const unsupported = state.practiceResult === 'unsupported';
  const report = state.practiceResult ? runPracticeChecks(state.practiceCode) : null;
  const mounted = useRef(true);
  const layoutRef = useScrollReveal<HTMLDivElement>({ stagger: 0.1 });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run() {
    const submittedCode = state.practiceCode;
    setRunning(true);
    try {
      const result = await demoService.checkPractice(submittedCode);
      if (mounted.current) applyPracticeResult(submittedCode, result);
    } finally {
      if (mounted.current) setRunning(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="PRACTICE / YOUR FIRST CONTRIBUTION"
        title="Small change. Real understanding."
        description="Apply what you learned to the same signup flow, with guidance when you need it."
        actions={
          <Button
            icon={BookOpen}
            onClick={() => {
              startJourney('signup');
              go('/workspace');
            }}
          >
            Revisit the signup journey
            <ArrowRight size={14} />
          </Button>
        }
      />
      <div ref={layoutRef} className="practice-layout">
        <TiltCard className="panel practice-brief" maxTilt={4}>
          <div className="row between">
            <Badge tone="green">Starter exercise</Badge>
            <span className="muted row gap-4">
              <Clock3 size={12} />
              12 min
            </span>
          </div>
          <h2>A stronger password, a safer signup.</h2>
          <p>
            Require at least one number in a new account’s password, while preserving the existing
            minimum length.
          </p>
          <div className="tag-list">
            <Badge>Validation</Badge>
            <Badge tone="blue">TypeScript</Badge>
          </div>
          <div className="subsection-divider" />
          <div className="behavior-block">
            <span className="tiny-label">CURRENT BEHAVIOR</span>
            <p>Any password with 8 or more characters is accepted, including “abcdefgh”.</p>
          </div>
          <div className="behavior-block desired">
            <span className="tiny-label">DESIRED BEHAVIOR</span>
            <p>Passwords need at least 8 characters and at least one digit. “abcdefg1” passes.</p>
          </div>
          <div className="subsection-divider" />
          <h3>Acceptance criteria</h3>
          <ChecklistItem checked={Boolean(report?.checks[0]?.passed)}>
            Reject a letters-only password
          </ChecklistItem>
          <ChecklistItem checked={Boolean(report?.checks[1]?.passed)}>
            Accept a valid mixed password
          </ChecklistItem>
          <ChecklistItem checked={Boolean(report?.checks[2]?.passed)}>
            Keep the existing length check
          </ChecklistItem>
          <div className="subsection-divider" />
          <h3>Your contribution checklist</h3>
          <label className="checkbox-row compact">
            <input
              type="checkbox"
              checked={located}
              onChange={(e) => setLocated(e.target.checked)}
            />
            I located the input-validation rule
          </label>
          <ChecklistItem checked={state.practiceCode !== initialPractice}>
            Update the prepared schema
          </ChecklistItem>
          <ChecklistItem checked={passing}>Pass all schema assertions</ChecklistItem>
          <SourceLink source={{ path: 'src/middleware/validate.ts', start: 4, end: 8 }} navigate />
          <div className="exercise-origin">
            <FlaskConical size={14} />
            <span>
              Curated demo exercise. This is not an upstream issue or a maintainer-approved task.
            </span>
          </div>
        </TiltCard>
        <div className="practice-center">
          <TiltCard className="panel exercise-editor" maxTilt={3}>
            <div className="code-topbar">
              <div className="code-tabs">
                <button
                  className={tab === 'exercise' ? 'active' : ''}
                  onClick={() => setTab('exercise')}
                >
                  <Code2 size={14} />
                  Your change
                </button>
                <button
                  className={tab === 'reference' ? 'active' : ''}
                  onClick={() => setTab('reference')}
                >
                  <BookOpen size={14} />
                  Reference source
                </button>
              </div>
              <Badge>Local exercise</Badge>
            </div>
            {tab === 'exercise' ? (
              <>
                <div className="file-path">
                  <span className="ts-icon">TS</span>
                  <span>src/middleware/validate.ts</span>
                  <Badge tone="amber">Unsaved sample patch</Badge>
                </div>
                <div className="editable-code">
                  <div className="editor-line-numbers" aria-hidden="true">
                    {state.practiceCode.split('\n').map((_, i) => (
                      <span key={i}>{i + 1}</span>
                    ))}
                  </div>
                  <textarea
                    aria-label="Edit the signup validation schema"
                    value={state.practiceCode}
                    onChange={(e) => patch({ practiceCode: e.target.value, practiceResult: null })}
                    spellCheck={false}
                  />
                </div>
                <div className="editor-actions">
                  <Button
                    variant="ghost"
                    icon={RotateCcw}
                    onClick={() => patch({ practiceCode: initialPractice, practiceResult: null })}
                  >
                    Reset change
                  </Button>
                  <Button
                    variant="ghost"
                    icon={WandSparkles}
                    onClick={() => patch({ practiceCode: solutionPractice, practiceResult: null })}
                  >
                    Apply guided example
                  </Button>
                </div>
              </>
            ) : (
              <CodeViewer source={{ path: 'src/middleware/validate.ts', start: 4, end: 16 }} />
            )}
          </TiltCard>
          <TiltCard className="panel test-panel" maxTilt={3}>
            <PanelHeading icon={FlaskConical} title="Schema assertion results">
              {running ? (
                <Badge tone="violet">Running…</Badge>
              ) : state.practiceResult && !unsupported ? (
                <Badge tone={passing ? 'green' : 'amber'}>
                  {report?.checks.filter((check) => check.passed).length ?? 0}/3 assertions pass
                </Badge>
              ) : (
                <Badge>Ready to run</Badge>
              )}
            </PanelHeading>
            <div className="test-actions">
              <Button
                variant="primary"
                icon={Play}
                disabled={running}
                magnetic
                onClick={() => void run()}
              >
                {running ? 'Running assertions…' : 'Run checks'}
              </Button>
              <span>Local Zod assertions · supported schema rules</span>
            </div>
            {unsupported ? (
              <div className="error-callout">
                <CircleAlert size={18} />
                <div>
                  <strong>This edit uses unsupported syntax</strong>
                  <p>
                    Keep the schema structure and edit the password chain using .min(length) and
                    .regex(/[0-9]/) or .regex(/\d/), with an optional message. Arbitrary JavaScript
                    is not evaluated. Apply the guided example to continue.
                  </p>
                </div>
              </div>
            ) : state.practiceResult ? (
              <div className="test-results">
                {report?.checks.map(({ title, detail, passed }) => (
                  <div key={title} className="test-row">
                    {passed ? (
                      <CheckCircle2 size={16} className="green-text" />
                    ) : (
                      <CircleAlert size={16} className="amber-text" />
                    )}
                    <span>
                      <strong>{title}</strong>
                      <small className="mono">{detail}</small>
                    </span>
                    <Badge tone={passed ? 'green' : 'red'}>{passed ? 'PASS' : 'FAIL'}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="checks-empty">
                <FlaskConical size={22} />
                <p>Run the baseline, then update the password rule and compare.</p>
              </div>
            )}
            <div className="test-disclosure">
              Supported password rules are parsed into a real Zod schema and checked against input
              assertions. This checks validation behavior, not the full API or database.
            </div>
          </TiltCard>
          {passing && (
            <TiltCard className="panel reflection-panel" maxTilt={3}>
              <PanelHeading icon={CheckCircle2} title="Explain your contribution" />
              <div className="panel-body stack-12">
                <p>
                  Why does this rule belong in validation, and which rejected input demonstrates the
                  change?
                </p>
                <textarea
                  aria-label="Explain your contribution"
                  placeholder="The rule belongs here because…"
                  value={reflection}
                  onChange={(e) => {
                    setReflection(e.target.value);
                    setSaved(false);
                  }}
                />
                <Button
                  disabled={!reflection.trim()}
                  icon={saved ? Check : ArrowRight}
                  magnetic
                  onClick={() => setSaved(true)}
                >
                  {saved ? 'Reflection noted for this session' : 'Note reflection'}
                </Button>
                <small className="muted">
                  Self-reflection is not automatically graded or counted as demonstrated mastery.
                </small>
              </div>
            </TiltCard>
          )}
        </div>
        <aside className="practice-hints stack-20">
          <TiltCard className="panel" maxTilt={4}>
            <PanelHeading icon={Lightbulb} title="A nudge, when you need it" />
            <div className="panel-body stack-12">
              <p className="muted">Start with the problem. Reveal one hint at a time.</p>
              {hints.slice(0, state.hints).map((hint, i) => (
                <div className="hint-card" key={hint.title}>
                  <span className="hint-number">{i + 1}</span>
                  <div>
                    <strong>{hint.title}</strong>
                    <p>{hint.text}</p>
                  </div>
                </div>
              ))}
              {state.hints < hints.length ? (
                <Button
                  variant="ghost"
                  icon={Lightbulb}
                  onClick={() => patch({ hints: state.hints + 1 })}
                >
                  Reveal hint {state.hints + 1}
                  <ChevronRight size={14} />
                </Button>
              ) : (
                <Badge tone="violet">All 3 hints revealed</Badge>
              )}
            </div>
          </TiltCard>
          <TiltCard className="practice-insight" maxTilt={4}>
            <span className="insight-icon">
              <BookOpen size={21} />
            </span>
            <h3>Put the rule at the boundary.</h3>
            <p>
              Shape validation belongs before business logic. That keeps invalid requests out of the
              service and makes the rule easier to test.
            </p>
            <SourceLink
              source={{ path: 'src/middleware/validate.ts', start: 10, end: 16 }}
              navigate
            />
            <button
              onClick={() => {
                startJourney('signup', 'invalid');
                go('/workspace');
              }}
            >
              Follow the invalid-input path
              <ArrowRight size={13} />
            </button>
          </TiltCard>
        </aside>
      </div>
    </>
  );
}
