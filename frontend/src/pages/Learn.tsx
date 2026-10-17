import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  FlaskConical,
  GitPullRequest,
  Lightbulb,
  Map,
  Route,
  Target,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useScrollReveal } from '../animations/gsapHooks';
import { Badge, Button, ChecklistItem, PageHeading, ProgressBar, TiltCard } from '../components/UI';
import type { Goal, Lesson, Profile } from '../data/types';
import { getRoute } from '../domain/model';
import { useWorkspace } from '../state/WorkspaceContext';

export default function Learn() {
  const { state, patch, startJourney, selectNode, complete, setSnapshot } = useWorkspace();
  const go = useNavigate();
  const setupRef = useScrollReveal<HTMLDivElement>({ stagger: 0.1 });
  const gridRef = useScrollReveal<HTMLDivElement>({ stagger: 0.12 });

  const route = getRoute(
    state.personalized ? state.profile : 'beginner',
    state.personalized ? state.goal : 'contribute',
  );
  const completed = route.filter((x) => state.completed.includes(x.id));
  const current = route.find((x) => !state.completed.includes(x.id)) ?? route[0];

  function open(lesson: Lesson) {
    if (lesson.journey) {
      startJourney(lesson.journey, 'success', lesson.id);
      go('/workspace');
    } else if (lesson.id === 'practice') {
      patch({ activeLesson: null, journeyId: null, playing: false });
      go('/practice');
    } else if (lesson.id === 'edge-tests') {
      patch({ activeLesson: 'edge-tests', journeyId: null, playing: false });
      selectNode('validation');
      go('/practice');
    } else {
      selectNode('router');
      complete('architecture');
      go('/workspace');
    }
  }

  const goals: { id: Goal; label: string; icon: typeof Target; description: string }[] = [
    {
      id: 'contribute',
      label: 'Make a first contribution',
      icon: Code2,
      description: 'A small change with a clear purpose.',
    },
    {
      id: 'understand',
      label: 'Understand the codebase',
      icon: Map,
      description: 'Build a map of how things work.',
    },
    {
      id: 'testing',
      label: 'Improve test coverage',
      icon: FlaskConical,
      description: 'Turn behavior into useful checks.',
    },
  ];

  return (
    <>
      <PageHeading
        eyebrow="MY LEARNING PATH"
        title="A route that starts where you are."
        description="Understand the right things, in the right order, with a contribution to work toward."
        actions={
          <Button
            variant="primary"
            icon={ArrowRight}
            magnetic
            onClick={() => open(current)}
          >
            Continue learning
          </Button>
        }
      />
      <div ref={setupRef} className="learning-setup">
        <TiltCard className="panel profile-panel" maxTilt={4}>
          <div className="row between">
            <span className="tiny-label">YOUR STARTING POINT</span>
            <UserRound size={16} className="muted" />
          </div>
          <div className="profile-line">
            <div className="large-avatar">JD</div>
            <div>
              <h3>Jordan Davis</h3>
              <p>Curious developer. New codebase.</p>
            </div>
          </div>
          <label className="field-label">
            Experience
            <select
              value={state.profile}
              onChange={(e) => patch({ profile: e.target.value as Profile })}
            >
              <option value="beginner">New to backend development</option>
              <option value="experienced">Experienced, new to this codebase</option>
            </select>
          </label>
          <div className="tag-list">
            <Badge tone="blue">TypeScript</Badge>
            <Badge>React</Badge>
            <Badge tone="violet">
              {state.profile === 'beginner' ? 'Learning backend' : 'Backend experience'}
            </Badge>
          </div>
        </TiltCard>
        <TiltCard className="panel goal-panel" maxTilt={4}>
          <div className="row between">
            <div>
              <span className="tiny-label">A LITTLE DIRECTION GOES A LONG WAY</span>
              <h2>What would you like to achieve?</h2>
            </div>
            <Target size={21} className="violet-text" />
          </div>
          <div className="goal-options">
            {goals.map(({ id, label, icon: Icon, description }) => (
              <button
                className={state.goal === id ? 'selected' : ''}
                key={id}
                onClick={() => patch({ goal: id })}
              >
                <Icon size={20} strokeWidth={1.6} />
                <strong>{label}</strong>
                <small>{description}</small>
                {state.goal === id && (
                  <span className="goal-selected">
                    <Check size={11} />
                  </span>
                )}
              </button>
            ))}
          </div>
          <p className="personalization-reason">
            <Lightbulb size={14} />
            {!state.personalized
              ? 'Personalization is off. Showing the default beginner contribution route.'
              : state.profile === 'beginner'
                ? 'We’ve included middleware fundamentals before the feature journey.'
                : 'Your backend experience lets you skip the middleware introduction.'}
          </p>
        </TiltCard>
      </div>
      <div ref={gridRef} className="learning-grid">
        <section className="panel learning-route">
          <div className="panel-heading">
            <div>
              <h2>Your next chapter, mapped out.</h2>
              <p className="muted">{route.length} lessons · built around your selected goal</p>
            </div>
            <Badge tone="violet">
              {completed.length}/{route.length} reviewed
            </Badge>
          </div>
          <div className="route-list">
            {route.map((lesson, i) => {
              const done = state.completed.includes(lesson.id);
              const active = current.id === lesson.id;
              return (
                <button
                  className={`route-lesson ${done ? 'done' : ''} ${active ? 'current' : ''}`}
                  onClick={() => open(lesson)}
                  key={lesson.id}
                >
                  <span className="route-step">{done ? <Check size={17} /> : i + 1}</span>
                  <div>
                    <div className="row gap-8">
                      <h3>{lesson.title}</h3>
                      {active && !done && <Badge tone="violet">Up next</Badge>}
                    </div>
                    <p>{lesson.description}</p>
                    <span className="lesson-kind">
                      {lesson.journey ? (
                        <Route size={12} />
                      ) : lesson.id === 'practice' ? (
                        <FlaskConical size={12} />
                      ) : (
                        <BookOpen size={12} />
                      )}
                      {lesson.journey
                        ? 'Interactive code journey'
                        : lesson.id === 'practice'
                          ? 'Guided contribution'
                          : 'Source exploration'}
                    </span>
                  </div>
                  <span className="lesson-duration">
                    <Clock3 size={12} />
                    {lesson.duration}
                  </span>
                  <ChevronRight size={16} />
                </button>
              );
            })}
          </div>
        </section>
        <div className="stack-20">
          <TiltCard className="panel route-overview" maxTilt={4}>
            <span className="tiny-label">YOUR PATH AT A GLANCE</span>
            <div className="route-progress-number">
              {completed.length}
              <span>/ {route.length} lessons</span>
            </div>
            <ProgressBar value={(completed.length / route.length) * 100} />
            <p>Each small connection brings the codebase into focus.</p>
            <div className="subsection-divider" />
            <h3>You’re working toward</h3>
            <ChecklistItem checked={state.completed.includes('architecture')}>
              Locate a feature in the architecture
            </ChecklistItem>
            <ChecklistItem checked={state.completed.includes('signup')}>
              Explain the signup failure branch
            </ChecklistItem>
            <ChecklistItem checked={state.practiceResult === 'solution'}>
              Review a small validation contribution
            </ChecklistItem>
            <small className="muted">
              Lesson completion records activity. Check answers provide separate understanding
              evidence.
            </small>
          </TiltCard>
          <TiltCard className="learning-update-card" maxTilt={4}>
            <div className="row gap-8">
              <GitPullRequest size={17} />
              <span className="tiny-label">YOUR LEARNING STAYS CURRENT</span>
            </div>
            <h3>A change to the code is a new connection to make.</h3>
            <p>
              PR #402 introduces email verification. Compare the changed steps, then revisit only
              what’s affected.
            </p>
            <button
              onClick={() => {
                setSnapshot('head');
                startJourney('login');
                go('/workspace');
              }}
            >
              Explore the verification lesson
              <ArrowRight size={14} />
            </button>
          </TiltCard>
        </div>
      </div>
    </>
  );
}
