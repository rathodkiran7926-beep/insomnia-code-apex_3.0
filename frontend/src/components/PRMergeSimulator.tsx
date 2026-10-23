import { useEffect, useRef, useState } from 'react';
import { GitMerge, LoaderCircle, Download } from 'lucide-react';
import { analysisApi } from '../services/analysisApi';

type Simulation = {
  comparisonId: string;
  path: string;
  status: 'clean' | 'conflict';
  conflicts: number;
  reason: string;
  baseCommit: string;
  targetCommit: string;
  headCommit: string;
  base: string | null;
  target: string | null;
  incoming: string | null;
  merged: string | null;
  limitation: string;
};
export function PRMergeSimulator({
  comparison,
}: {
  comparison: {
    id: string;
    pr: {
      baseCommit: string;
      targetCommit: string;
      headCommit: string;
      files: { path: string; hidden: boolean; previousPath: string | null }[];
    };
  };
}) {
  const files = comparison.pr.files.filter((f) => !f.hidden && !f.previousPath);
  const [path, setPath] = useState(files[0]?.path || '');
  const [results, setResults] = useState<Record<string, Simulation>>({});
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [view, setView] = useState<'merged' | 'target' | 'incoming' | 'base'>('merged');
  const [draft, setDraft] = useState<string | null>(null),
    [edited, setEdited] = useState(false),
    [editing, setEditing] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const drafts = useRef<Record<string, { content: string | null; edited: boolean }>>({});
  const current = results[path];
  useEffect(() => {
    operation.current?.abort();
    setPending(false);
    setError('');
    setView('merged');
    setEditing(false);
    setEdited(drafts.current[path]?.edited || false);
    setDraft(drafts.current[path] ? drafts.current[path].content : (results[path]?.merged ?? null));
    return () => operation.current?.abort();
  }, [path]);
  async function simulate() {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError('');
    try {
      const value = await analysisApi<Simulation>(`/api/pr/comparisons/${comparison.id}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (value.comparisonId !== comparison.id || value.path !== path)
        throw new Error('Simulation source does not match this selection.');
      setResults((old) => ({ ...old, [path]: value }));
      setDraft(value.merged);
      drafts.current[path] = { content: value.merged, edited: false };
      setEdited(false);
      setEditing(false);
      setView('merged');
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }
  const content = view === 'merged' ? draft : (current?.[view] ?? null);
  function choose(value: string | null) {
    drafts.current[path] = { content: value, edited: true };
    setDraft(value);
    setEdited(true);
    setView('merged');
  }
  return (
    <section className="pr-card pr-simulator">
      <h2>
        <GitMerge size={19} /> How does this PR integrate with the old code?
      </h2>
      <p>
        Preview one changed text file using the common ancestor, the captured target branch, and the
        PR version. Git combines independent changes and marks overlaps for review.
      </p>
      <ol className="pr-merge-steps">
        <li>
          <strong>Old starting point</strong>
          <code>{comparison.pr.baseCommit.slice(0, 12)}</code>
          <small>Common ancestor</small>
        </li>
        <li>
          <strong>Combine both changes</strong>
          <code>
            {comparison.pr.targetCommit.slice(0, 12)} + {comparison.pr.headCommit.slice(0, 12)}
          </code>
          <small>Target branch + PR</small>
        </li>
        <li>
          <strong>Review the result</strong>
          <small>No files or branches are changed</small>
        </li>
      </ol>
      <label htmlFor="merge-file">Changed file</label>
      <div className="pr-simulator-picker">
        <select id="merge-file" value={path} onChange={(e) => setPath(e.target.value)}>
          {files.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path}
              {results[f.path] ? ` · ${results[f.path].status}` : ''}
            </option>
          ))}
        </select>
        <button disabled={!path || pending} onClick={() => void simulate()}>
          {pending ? <LoaderCircle size={15} className="mentor-spin" /> : <GitMerge size={15} />}{' '}
          {pending ? 'Combining code…' : 'Simulate integration'}
        </button>
      </div>
      <p>
        <small>
          Text files up to 256 KB. Sensitive paths are hidden. Renames and tree-level conflicts are
          outside this preview. Target commit is captured with the comparison; reanalyze the PR to
          refresh it.
        </small>
      </p>
      {!files.length && <p>No eligible changed paths are available for this per-file simulator.</p>}
      {error && (
        <p className="pr-warning" role="alert">
          {error}
        </p>
      )}
      {current && (
        <>
          <div className={`pr-merge-status ${current.status}`} role="status">
            <strong>
              {current.status === 'clean'
                ? 'This file combines without a text conflict'
                : `${current.conflicts} conflict(s) need review`}
            </strong>
            <p>{current.reason}</p>
          </div>
          <div className="pr-version-tabs">
            {(
              [
                ['merged', 'Integrated result'],
                ['target', 'Target branch / old code'],
                ['incoming', 'PR changes'],
                ['base', 'Common ancestor'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                aria-pressed={view === id}
                onClick={() => {
                  setView(id);
                  setEditing(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="pr-actions">
            <button
              onClick={() => {
                setView('merged');
                setEditing((v) => !v);
              }}
            >
              {editing ? 'Read preview' : 'Edit local draft'}
            </button>
            <button
              onClick={() => {
                setDraft(current.merged);
                drafts.current[path] = { content: current.merged, edited: false };
                setEdited(false);
                setEditing(false);
                setView('merged');
              }}
            >
              Reset draft
            </button>
            <button
              onClick={() => {
                const blob = new Blob(
                  [
                    JSON.stringify(
                      {
                        comparisonId: comparison.id,
                        path,
                        baseCommit: current.baseCommit,
                        targetCommit: current.targetCommit,
                        headCommit: current.headCommit,
                        textMergeStatus: current.status,
                        edited,
                        proposedContent: draft,
                        executionVerified: false,
                      },
                      null,
                      2,
                    ),
                  ],
                  { type: 'application/json' },
                );
                const href = URL.createObjectURL(blob),
                  a = document.createElement('a');
                a.href = href;
                a.download = 'merge-preview.json';
                a.click();
                setTimeout(() => URL.revokeObjectURL(href), 1000);
              }}
            >
              <Download size={14} /> Download preview
            </button>
          </div>
          {current.status === 'conflict' && (
            <p className="pr-merge-choices">
              <button onClick={() => choose(current.target)}>Use target as local draft</button>
              <button onClick={() => choose(current.incoming)}>Use PR as local draft</button>
              <small>
                Choosing one side may discard the other side’s changes. Review the complete result.
              </small>
            </p>
          )}
          {edited && (
            <p className="pr-warning">
              Local draft only. Edits and choices have not been validated, applied, or committed.
            </p>
          )}
          {view === 'merged' && editing ? (
            <textarea
              className="pr-merge-editor"
              aria-label="Integrated code draft"
              spellCheck={false}
              value={draft ?? ''}
              onChange={(e) => {
                choose(e.target.value);
              }}
            />
          ) : content === null ? (
            <p className="pr-merge-absent">
              {view === 'merged'
                ? 'The proposed result has no file at this path (deletion).'
                : 'This version has no file at this path.'}
            </p>
          ) : (
            <pre className="pr-merge-code" tabIndex={0} aria-label="Merge simulation code">
              {content.split('\n').map((line, i) => (
                <div
                  key={i}
                  className={/^(<{7}|\|{7}|={7}|>{7})/.test(line) ? 'conflict-marker' : ''}
                >
                  <span>{i + 1}</span>
                  <code>{line || ' '}</code>
                </div>
              ))}
            </pre>
          )}
          <p className="pr-warning">{current.limitation}</p>
        </>
      )}
    </section>
  );
}
