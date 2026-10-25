import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LoaderCircle, Maximize2, Play } from 'lucide-react';
import { Modal } from './UI';
import type { RepositorySnapshot } from '../domain/analysisTypes';
import { analysisApi } from '../services/analysisApi';
import {
  analyzeImpactCodeChange,
  fetchImpactPreview,
  type ImpactCodeAnalysis,
  type ImpactPreviewResult,
  type ImpactReference,
} from '../services/impactPreview';
import '../styles/impact-preview.css';

type SnapshotSource = {
  file: string;
  excerpt: string;
  complete: boolean;
  snapshotId: string;
};

export function ImpactPreviewPanel({
  snapshot,
  active,
  targetId,
  onOpenReference,
  onResultsChange,
}: {
  snapshot: RepositorySnapshot;
  active: boolean;
  targetId: string | null;
  onOpenReference: (reference: ImpactReference) => void;
  onResultsChange: (result: ImpactPreviewResult | null) => void;
}) {
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState('');
  const [retry, setRetry] = useState(0);
  const [baseline, setBaseline] = useState<{ key: string; code: string } | null>(null);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [baselineError, setBaselineError] = useState('');
  const [proposedCode, setProposedCode] = useState('');
  const [question, setQuestion] = useState('');
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [codeAnalysis, setCodeAnalysis] = useState<ImpactCodeAnalysis | null>(null);
  const [codeAnalysisLoading, setCodeAnalysisLoading] = useState(false);
  const [codeAnalysisError, setCodeAnalysisError] = useState('');
  const codeAnalysisController = useRef<AbortController | null>(null);
  const selected = snapshot.components.find((component) => component.id === targetId);
  const selectedReference = snapshot.references.find(
    (reference) =>
      reference.id === selected?.referenceId && reference.snapshotId === snapshot.snapshotId,
  );
  const baselineKey = selectedReference
    ? `${snapshot.snapshotId}:${targetId}:${selectedReference.id}`
    : '';
  const baselineCode = baseline?.key === baselineKey ? baseline.code : null;
  const referenceById = new Map(
    snapshot.references
      .filter((reference) => reference.snapshotId === snapshot.snapshotId)
      .map((reference) => [reference.id, reference]),
  );

  useEffect(() => {
    if (!active || !targetId) {
      onResultsChange(null);
      setResultLoading(false);
      setResultError('');
      return;
    }
    const controller = new AbortController();
    setResultLoading(true);
    setResultError('');
    onResultsChange(null);
    fetchImpactPreview(snapshot.snapshotId, targetId, 'behavior-change', controller.signal)
      .then((preview) => {
        if (!controller.signal.aborted) onResultsChange(preview);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setResultError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setResultLoading(false);
      });
    return () => controller.abort();
  }, [active, targetId, snapshot.snapshotId, retry, onResultsChange]);

  useEffect(() => {
    if (!active || !targetId || !selectedReference) {
      setBaseline(null);
      setBaselineLoading(false);
      setBaselineError('');
      return;
    }
    const key = `${snapshot.snapshotId}:${targetId}:${selectedReference.id}`;
    const controller = new AbortController();
    setBaseline(null);
    setBaselineLoading(true);
    setBaselineError('');
    analysisApi<SnapshotSource>(
      `/api/snapshots/${encodeURIComponent(snapshot.snapshotId)}/source?referenceId=${encodeURIComponent(selectedReference.id)}`,
      { signal: controller.signal },
    )
      .then((source) => {
        if (
          source.snapshotId !== snapshot.snapshotId ||
          source.file !== selectedReference.file ||
          source.complete !== true
        )
          throw new Error('Snapshot source version mismatch');
        const code = source.excerpt
          .split(/\r?\n/)
          .slice(selectedReference.startLine - 1, selectedReference.endLine)
          .join('\n');
        if (!code.trim()) throw new Error('Selected source span is empty');
        if (!controller.signal.aborted) {
          setBaseline({ key, code });
          setProposedCode(code);
          setCodeAnalysis(null);
          setCodeAnalysisError('');
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setBaselineError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBaselineLoading(false);
      });
    return () => controller.abort();
  }, [active, targetId, snapshot.snapshotId, selectedReference]);

  useEffect(() => {
    codeAnalysisController.current?.abort();
    setQuestion('');
    setEditorExpanded(false);
    setCodeAnalysis(null);
    setCodeAnalysisError('');
    setCodeAnalysisLoading(false);
    return () => codeAnalysisController.current?.abort();
  }, [active, targetId, snapshot.snapshotId]);

  async function analyzeProposedCode() {
    if (!targetId || !baselineCode) return;
    if (!proposedCode.trim() && !question.trim()) {
      setCodeAnalysisError('Enter proposed code or a scenario before analyzing.');
      return;
    }
    codeAnalysisController.current?.abort();
    const controller = new AbortController();
    codeAnalysisController.current = controller;
    setCodeAnalysisLoading(true);
    setCodeAnalysisError('');
    setCodeAnalysis(null);
    try {
      const analysis = await analyzeImpactCodeChange(
        snapshot.snapshotId,
        targetId,
        'behavior-change',
        proposedCode,
        controller.signal,
        question,
      );
      if (!controller.signal.aborted) setCodeAnalysis(analysis);
    } catch (cause) {
      if (!controller.signal.aborted) setCodeAnalysisError((cause as Error).message);
    } finally {
      if (!controller.signal.aborted) setCodeAnalysisLoading(false);
    }
  }

  function updateDraft(value: string, field: 'code' | 'question') {
    codeAnalysisController.current?.abort();
    setCodeAnalysisLoading(false);
    setCodeAnalysis(null);
    setCodeAnalysisError('');
    if (field === 'code') setProposedCode(value);
    else setQuestion(value);
  }

  function editorFields(expanded: boolean) {
    const suffix = expanded ? '-expanded' : '';
    return (
      <div className="impact-code-fields">
        <div className="impact-code-editor-heading">
          <label htmlFor={`impact-proposed-code${suffix}`}>After · proposed code</label>
          {!expanded && (
            <button
              type="button"
              className="impact-editor-expand"
              aria-haspopup="dialog"
              onClick={() => setEditorExpanded(true)}
            >
              <Maximize2 size={13} /> Expand editor
            </button>
          )}
        </div>
        <textarea
          id={`impact-proposed-code${suffix}`}
          spellCheck={false}
          maxLength={8000}
          value={proposedCode}
          onChange={(event) => updateDraft(event.target.value, 'code')}
        />
        <label htmlFor={`impact-scenario-question${suffix}`}>Scenario or question (optional)</label>
        <textarea
          id={`impact-scenario-question${suffix}`}
          className="impact-code-question"
          maxLength={2000}
          value={question}
          onChange={(event) => updateDraft(event.target.value, 'question')}
          aria-describedby={`impact-scenario-help${suffix}`}
          placeholder="What happens if GitHub returns 403, or this caller times out?"
        />
        <small id={`impact-scenario-help${suffix}`} className="impact-code-privacy">
          Ask a hypothetical question without editing the code. No code is executed.
        </small>
      </div>
    );
  }

  return (
    <section className="impact-preview-panel" aria-label="Try a code change">
      <Modal
        open={editorExpanded && active && baselineCode !== null}
        onOpenChange={setEditorExpanded}
        title="Edit proposed code"
        description="Explore a code change or ask about a hypothetical scenario. Your draft is kept when you close this view."
        className="impact-editor-dialog"
      >
        {editorFields(true)}
        <button
          type="button"
          className="impact-code-analyze"
          onClick={() => setEditorExpanded(false)}
        >
          Done editing
        </button>
      </Modal>
      <div className="impact-preview-scroll">
        <section className="impact-code-editor" aria-label="Try a code change">
          <strong className="impact-code-editor-title">Try a code change</strong>
          {baselineLoading && (
            <p className="impact-preview-status" role="status">
              <LoaderCircle className="mentor-spin" size={14} /> Loading snapshot code…
            </p>
          )}
          {baselineError && (
            <p className="impact-preview-error" role="alert">
              Could not load the snapshot code: {baselineError}
            </p>
          )}
          {baselineCode !== null && (
            <>
              <details className="impact-code-before">
                <summary>
                  Before · analyzed snapshot <ChevronDown size={13} />
                </summary>
                <pre>
                  <code>{baselineCode}</code>
                </pre>
              </details>
              {editorFields(false)}
              <button
                className="impact-code-analyze"
                disabled={
                  codeAnalysisLoading ||
                  baselineCode.length > 8000 ||
                  (!proposedCode.trim() && !question.trim())
                }
                onClick={() => void analyzeProposedCode()}
              >
                {codeAnalysisLoading ? (
                  <LoaderCircle className="mentor-spin" size={14} />
                ) : (
                  <Play size={13} />
                )}
                {codeAnalysisLoading
                  ? 'Analyzing…'
                  : question.trim()
                    ? 'Analyze scenario'
                    : 'Analyze proposed code'}
              </button>
              {baselineCode.length > 8000 && (
                <p className="impact-preview-warning" role="status">
                  The selected source exceeds the 8,000-character comparison limit.
                </p>
              )}
            </>
          )}
          {codeAnalysisError && (
            <p className="impact-preview-error" role="alert">
              {codeAnalysisError}
            </p>
          )}
          {resultError && (
            <p className="impact-preview-error" role="alert">
              Could not load indexed dependency evidence: {resultError}{' '}
              <button onClick={() => setRetry((value) => value + 1)}>Retry</button>
            </p>
          )}
          {resultLoading && !codeAnalysisLoading && (
            <p className="impact-preview-status" role="status">
              <LoaderCircle className="mentor-spin" size={14} /> Loading dependency evidence…
            </p>
          )}
        </section>
        {codeAnalysis && (
          <section className="impact-code-analysis" aria-live="polite">
            <strong>Impact analysis</strong>
            <p>{codeAnalysis.analysis.summary}</p>
            {codeAnalysis.analysis.behaviorChanges.length > 0 && (
              <div>
                <small>Likely behavior changes</small>
                <ul>
                  {codeAnalysis.analysis.behaviorChanges.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {codeAnalysis.analysis.dependencyImpacts.length > 0 && (
              <div>
                <small>Dependency considerations</small>
                <ul>
                  {codeAnalysis.analysis.dependencyImpacts.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {codeAnalysis.analysis.reviewChecks.length > 0 && (
              <div>
                <small>Suggested checks</small>
                <ul>
                  {codeAnalysis.analysis.reviewChecks.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="impact-preview-citations">
              {codeAnalysis.analysis.referenceIds.map((id) => {
                const evidence = referenceById.get(id);
                return evidence ? (
                  <button
                    key={id}
                    onClick={() => onOpenReference(evidence)}
                    title={`Open ${evidence.file} at lines ${evidence.startLine}-${evidence.endLine}`}
                  >
                    {evidence.file}:{evidence.startLine}-{evidence.endLine}
                  </button>
                ) : null;
              })}
            </div>
            <small>
              {codeAnalysis.analysis.mode === 'ai' ? 'AI-assisted · ' : 'Source facts · '}
              {codeAnalysis.analysis.notice}
            </small>
          </section>
        )}
      </div>
    </section>
  );
}
