import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, RotateCcw } from 'lucide-react';
import { Badge, Button, PanelHeading, TiltCard } from './UI';
import { useWorkspace } from '../state/WorkspaceContext';
import {
  getPracticeLearnerId,
  startQuiz,
  submitQuizAnswer,
  type PracticeDifficulty,
  type QuizAnswer,
  type QuizSession,
} from '../services/practiceApi';
import { buildPracticeContext } from '../services/practiceContext';

export function PracticeQuiz({ difficulty }: { difficulty: PracticeDifficulty }) {
  const { state } = useWorkspace();
  const context = useMemo(
    () =>
      buildPracticeContext({
        goal: state.goal,
        profile: state.profile,
        journeyId: state.journeyId,
        activeLesson: state.activeLesson,
        completed: state.completed,
      }),
    [state.goal, state.profile, state.journeyId, state.activeLesson, state.completed],
  );
  const learnerId = useMemo(() => getPracticeLearnerId(), []);
  const [session, setSession] = useState<QuizSession | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<QuizAnswer | null>(null);
  const [score, setScore] = useState(0);
  const [selectedOption, setSelectedOption] = useState('');
  const [creating, setCreating] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setCreating(true);
    setError('');
    setSession(null);
    setIndex(0);
    setScore(0);
    setAnswer(null);
    setSelectedOption('');
    Promise.all([
      startQuiz({
        learnerId,
        difficulty,
        context,
      }),
      new Promise<void>((resolve) => window.setTimeout(resolve, 1000)),
    ])
      .then(([value]) => {
        if (cancelled) return;
        setSession(value);
        setIndex(0);
        setScore(0);
        setAnswer(null);
        setSelectedOption('');
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'Could not create quiz.');
      })
      .finally(() => {
        if (!cancelled) setCreating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    learnerId,
    difficulty,
    context.goal,
    context.profile,
    context.journey,
    context.lesson,
    context.studiedConcepts?.join('|'),
    refresh,
  ]);

  const current = session?.questions[index];
  const finished = Boolean(session && index >= session.questions.length);

  async function submitAnswer() {
    if (!session || !current || !selectedOption) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await submitQuizAnswer(session.id, {
        learnerId,
        questionId: current.id,
        optionId: selectedOption,
      });
      setAnswer(result);
      if (result.correct) setScore((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not submit your answer.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <TiltCard className="panel practice-feature-panel practice-quiz-panel">
      <PanelHeading icon={BookOpen} title="Quick review">
        <Badge tone="violet">{difficulty}</Badge>
      </PanelHeading>
      <p className="muted">
        Short questions adapt to your learning goal and recently studied concepts.
      </p>
      {creating ? (
        <p className="muted practice-quiz-loading" role="status" aria-live="polite">
          Preparing your quiz…
        </p>
      ) : error ? (
        <div className="practice-result">
          <AlertCircle size={18} />
          <div>
            <strong>Could not prepare this review.</strong>
            <p>{error}</p>
            <Button icon={RotateCcw} onClick={() => setRefresh((value) => value + 1)}>
              Retry review
            </Button>
          </div>
        </div>
      ) : !session?.questions.length ? (
        <div className="practice-result">
          <AlertCircle size={18} />
          <div>
            <strong>{session?.message || 'No review questions are available.'}</strong>
            <p>Try again to prepare a fresh set of learning-journey questions.</p>
            <Button icon={RotateCcw} onClick={() => setRefresh((value) => value + 1)}>
              Retry review
            </Button>
          </div>
        </div>
      ) : finished ? (
        <div className="practice-quiz-finished">
          <CheckCircle2 size={24} />
          <h3>Review complete</h3>
          <p>
            Score: {score}/{session.questions.length}. Missed concepts are scheduled for an earlier
            revisit; correct concepts return later.
          </p>
          <Button icon={RotateCcw} onClick={() => setRefresh((value) => value + 1)}>
            Start another short review
          </Button>
        </div>
      ) : current ? (
        <div className="practice-quiz-question">
          <div className="row between">
            <span className="tiny-label">
              QUESTION {index + 1} OF {session.questions.length}
            </span>
            <Badge>{current.category === 'collaboration' ? 'Teamwork' : 'Coding practice'}</Badge>
          </div>
          <p className="practice-quiz-concept">{current.concept}</p>
          <h3>{current.prompt}</h3>
          <div className="practice-quiz-options">
            {current.options.map((option) => {
              const correctOption = answer?.correctOption === option.id;
              const selectedWrong = answer && selectedOption === option.id && !answer.correct;
              return (
                <button
                  key={option.id}
                  className={`practice-quiz-option${selectedOption === option.id ? ' selected' : ''}${answer && correctOption ? ' correct' : ''}${selectedWrong ? ' wrong' : ''}`}
                  disabled={Boolean(answer) || submitting}
                  onClick={() => setSelectedOption(option.id)}
                  type="button"
                >
                  {option.text}
                </button>
              );
            })}
          </div>
          {!answer ? (
            <Button
              variant="primary"
              disabled={!selectedOption || submitting}
              onClick={() => void submitAnswer()}
            >
              {submitting ? 'Checking…' : 'Check answer'}
            </Button>
          ) : (
            <>
              <div className={`practice-result${answer.correct ? ' success' : ''}`}>
                {answer.correct ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                <div>
                  <strong>{answer.correct ? 'Correct' : 'Not quite'}</strong>
                  <p>{answer.explanation}</p>
                  {answer.citations?.map((citation) => (
                    <a
                      href={citation.url}
                      target="_blank"
                      rel="noreferrer"
                      key={citation.referenceId}
                    >
                      {citation.file}:{citation.startLine}-{citation.endLine}
                    </a>
                  ))}
                </div>
              </div>
              <Button
                variant="primary"
                onClick={() => {
                  setIndex((value) => value + 1);
                  setAnswer(null);
                  setSelectedOption('');
                }}
              >
                {index + 1 === session.questions.length ? 'Finish review' : 'Continue'}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </TiltCard>
  );
}
