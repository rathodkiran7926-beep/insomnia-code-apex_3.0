import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Code2,
  Download,
  ExternalLink,
  LoaderCircle,
  RotateCcw,
  Send,
} from 'lucide-react';
import { Badge, Button, PanelHeading, TiltCard } from './UI';
import { useRepositoryAnalysis } from '../state/RepositoryAnalysisContext';
import { useWorkspace } from '../state/WorkspaceContext';
import {
  getPracticeLearnerId,
  loadPracticeAttempts,
  loadPracticeTasks,
  submitPracticeAttempt,
  type PracticeDifficulty,
  type PracticeAttemptSummary,
  type PracticeTask,
} from '../services/practiceApi';
import { buildPracticeContext } from '../services/practiceContext';

export function RepositoryPractice({ difficulty }: { difficulty: PracticeDifficulty }) {
  const { snapshot, loading, error: analysisError } = useRepositoryAnalysis();
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
  const [tasks, setTasks] = useState<PracticeTask[]>([]);
  const [history, setHistory] = useState<PracticeAttemptSummary[]>([]);
  const [selected, setSelected] = useState<PracticeTask | null>(null);
  const [code, setCode] = useState('');
  const [reflection, setReflection] = useState('');
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof submitPracticeAttempt>> | null>(
    null,
  );
  const completedKey = state.completed.slice(-30).join('|');
  const operation = useRef(0);

  useEffect(() => {
    if (!snapshot) return;
    operation.current++;
    let cancelled = false;
    setLoadingTasks(true);
    setError('');
    setMessage('');
    setSelected(null);
    setTasks([]);
    setHistory([]);
    setResult(null);
    setSaving(false);
    loadPracticeTasks({
      snapshotId: snapshot.snapshotId,
      learnerId,
      difficulty,
      context: { ...context, studiedConcepts: completedKey ? completedKey.split('|') : [] },
    })
      .then(async (response) => {
        if (cancelled) return;
        setTasks(response.tasks);
        const firstTask = response.tasks[0] || null;
        setSelected(firstTask);
        setCode(firstTask?.startingCode || '');
        setReflection('');
        setMessage(response.message);
        const pastAttempts = await loadPracticeAttempts(learnerId, response.snapshotId);
        if (!cancelled) setHistory(pastAttempts.attempts);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'Could not load practice data.');
      })
      .finally(() => {
        if (!cancelled) setLoadingTasks(false);
      });
    return () => {
      cancelled = true;
      operation.current++;
    };
  }, [
    snapshot?.snapshotId,
    learnerId,
    difficulty,
    context.goal,
    context.profile,
    context.journey,
    context.lesson,
    completedKey,
    refresh,
  ]);

  function selectTask(task: PracticeTask) {
    operation.current++;
    setSaving(false);
    setSelected(task);
    setCode(task.startingCode);
    setReflection('');
    setResult(null);
  }

  function downloadDraft() {
    if (!selected) return;
    const fileName = selected.evidence.file.split('/').pop() || 'practice-draft.ts';
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function submitAnswer() {
    if (!selected || !snapshot || saving) return;
    const version = operation.current;
    setSaving(true);
    setError('');
    setResult(null);
    try {
      const response = await submitPracticeAttempt({
        learnerId,
        taskId: selected.id,
        code,
        reflection,
      });
      if (operation.current !== version) return;
      setResult(response);
      setMessage(`Attempt saved for ${snapshot.repository} at ${snapshot.commit.slice(0, 8)}.`);
      const pastAttempts = await loadPracticeAttempts(learnerId, snapshot.snapshotId);
      if (operation.current !== version) return;
      setHistory(pastAttempts.attempts);
    } catch (reason) {
      if (operation.current !== version) return;
      setError(reason instanceof Error ? reason.message : 'Could not review this answer. Please submit again.');
    } finally {
      if (operation.current === version) setSaving(false);
    }
  }

  if (loading)
    return (
      <TiltCard className="panel practice-feature-panel">
        <PanelHeading icon={Code2} title="Repository-backed practice" />
        <p className="muted">Waiting for repository analysis to finish…</p>
      </TiltCard>
    );
  if (!snapshot)
    return (
      <TiltCard className="panel practice-feature-panel">
        <PanelHeading icon={Code2} title="Repository-backed practice" />
        <p>Analyze a repository on the Repository page to generate source-grounded coding tasks.</p>
        {analysisError && <p className="error-callout">{analysisError}</p>}
      </TiltCard>
    );

  const completedTasks = new Set(
    history
      .filter((attempt) => attempt.verificationStatus === 'passed')
      .map((attempt) => attempt.taskId),
  );

  return (
    <div className="practice-repository-layout">
      <main className="practice-editor-column">
        {loadingTasks ? (
          <TiltCard className="panel practice-task-workbench practice-editor-loading">
            <PanelHeading icon={Code2} title="Preparing your practice workspace" />
            <p className="muted row gap-8">
              <LoaderCircle size={16} className="practice-spin" /> Studying {snapshot.repository}
              at {snapshot.commit.slice(0, 8)}…
            </p>
          </TiltCard>
        ) : selected ? (
          <TiltCard className="panel practice-task-workbench">
            <PanelHeading icon={Code2} title={selected.title}>
              <div className="practice-editor-badges">
                <Badge tone="blue" className="practice-repository-badge">
                  {snapshot.repository.replace(/^https?:\/\/github\.com\//, '')}
                </Badge>
                <Badge tone="violet">{selected.difficulty}</Badge>
              </div>
            </PanelHeading>
            <p>{selected.brief}</p>
            <p className="practice-task-rationale">{selected.whyItMatters}</p>
            <div className="practice-task-citations">
              {selected.citations.map((citation) => (
                <a
                  className="practice-evidence-link"
                  href={citation.url}
                  target="_blank"
                  rel="noreferrer"
                  key={citation.referenceId}
                >
                  <ExternalLink size={14} />
                  {citation.file}:{citation.startLine}-{citation.endLine}
                </a>
              ))}
            </div>
            <h3>Acceptance criteria</h3>
            <ul>
              {selected.criteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ul>
            <p className="practice-first-hint">
              <strong>First hint:</strong> {selected.firstHint}
            </p>
            <label className="field-label" htmlFor="repository-practice-code">
              Your code
              <textarea
                id="repository-practice-code"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  setResult(null);
                }}
                disabled={saving}
                spellCheck={false}
                rows={12}
              />
            </label>
            <label className="field-label" htmlFor="repository-practice-reflection">
              Explain your change
              <textarea
                id="repository-practice-reflection"
                value={reflection}
                onChange={(event) => { setReflection(event.target.value); setResult(null); }}
                disabled={saving}
                rows={3}
                placeholder="What behavior are you changing, and why does it belong here?"
              />
            </label>
            <p className="muted">AI will review your answer and suggest fixes only for major issues.</p>
            <Button
              variant="primary"
              icon={Send}
              disabled={saving || code === selected.startingCode}
              onClick={() => void submitAnswer()}
            >
              {saving ? 'Reviewing...' : 'Submit'}
            </Button>
            {result && (
              <Button variant="ghost" icon={Download} onClick={downloadDraft}>
                Download proposed full-file change
              </Button>
            )}
            {error && (
              <p className="error-callout">
                <AlertCircle size={16} />
                {error}
              </p>
            )}
            {result && (
              <div
                className={
                  result.verification.status === 'passed'
                    ? 'practice-result success'
                    : 'practice-result'
                }
              >
                {result.verification.status === 'passed' ? (
                  <CheckCircle2 size={18} />
                ) : (
                  <AlertCircle size={18} />
                )}
                <div>
                  <strong>{result.verification.message}</strong>
                  {result.verification.checks.length > 0 && (
                    <p>Checks run: {result.verification.checks.join(', ')}.</p>
                  )}
                  {result.verification.errors.map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                  <small>
                    Attempt {result.id.slice(0, 8)} · repository/runtime tests executed: no
                  </small>
                </div>
              </div>
            )}
          </TiltCard>
        ) : (
          <TiltCard className="panel practice-task-workbench practice-editor-loading">
            <PanelHeading
              icon={Code2}
              title={error ? 'Could not generate repository tasks' : 'No generated coding task'}
            />
            <p>
              {error ||
                message ||
                'The mentor could not find enough supported source to suggest a task.'}
            </p>
            {error && (
              <Button icon={RotateCcw} onClick={() => setRefresh((value) => value + 1)}>
                Retry task generation
              </Button>
            )}
          </TiltCard>
        )}
      </main>
      <aside className="practice-roadmap">
        <TiltCard className="panel practice-roadmap-card">
          <PanelHeading icon={Code2} title="Your task roadmap">
            <Badge tone="blue">{tasks.length}</Badge>
          </PanelHeading>
          <p className="muted practice-roadmap-repo">
            {snapshot.repository} · {snapshot.commit.slice(0, 8)}
          </p>
          {tasks.length ? (
            <ol className="practice-roadmap-list">
              {tasks.map((task, index) => {
                const complete = completedTasks.has(task.id);
                return (
                  <li key={task.id}>
                    <button
                      type="button"
                      className={`practice-roadmap-task${selected?.id === task.id ? ' active' : ''}${complete ? ' complete' : ''}`}
                      aria-current={selected?.id === task.id ? 'step' : undefined}
                      onClick={() => selectTask(task)}
                    >
                      <span className="practice-roadmap-step">
                        {complete ? <CheckCircle2 size={15} /> : index + 1}
                      </span>
                      <span className="practice-roadmap-title">
                        <strong>{task.title}</strong>
                        <small>{task.component.name}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="muted">{loadingTasks ? 'Generating tasks…' : message}</p>
          )}
          {history.length > 0 && (
            <div className="practice-attempt-history">
              <h3>Recent attempts</h3>
              {history.slice(0, 5).map((attempt) => (
                <div className="practice-attempt-row" key={attempt.id}>
                  <span>{new Date(attempt.createdAt).toLocaleString()}</span>
                  <Badge tone={attempt.verificationStatus === 'passed' ? 'green' : 'amber'}>
                    {attempt.verificationStatus}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </TiltCard>
      </aside>
    </div>
  );
}
