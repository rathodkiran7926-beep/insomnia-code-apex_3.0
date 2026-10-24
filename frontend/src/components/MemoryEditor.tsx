import { useEffect, useState } from 'react';
import { Modal, Button } from './UI';
import { useCollaboration } from '../state/CollaborationContext';
import { useRepositoryAnalysis } from '../state/RepositoryAnalysisContext';
import { handoffApi } from '../services/handoffApi';
import {
  emptyMemory,
  fieldsForMemory,
  memoryLabels,
  type MemoryContent,
  type MemoryRecord,
} from '../services/engineeringMemory';
export function MemoryEditor({
  open,
  onOpenChange,
  record,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  record?: MemoryRecord;
  onSaved: (v: MemoryRecord) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={record ? 'Create a new knowledge revision' : 'Capture engineering knowledge'}
      description="Save a draft tied to actual source. A maintainer approves the exact revision before it becomes reusable team guidance."
      className="memory-editor-dialog"
    >
      <Editor
        key={`${record?.id || 'new'}:${record?.revision}:${open}`}
        record={record}
        onSaved={onSaved}
      />
    </Modal>
  );
}
function Editor({
  record,
  onSaved,
}: {
  record?: MemoryRecord;
  onSaved: (v: MemoryRecord) => void;
}) {
  const { workspace } = useCollaboration(),
    { snapshot } = useRepositoryAnalysis();
  const [type, setType] = useState<MemoryRecord['type']>(record?.type || 'decision');
  const [content, setContent] = useState<MemoryContent>({ ...emptyMemory, ...record?.content });
  const choices =
    snapshot?.components
      .filter((c) => c.role !== 'module')
      .flatMap((c) => {
        const ref = snapshot.references.find((r) => r.id === c.referenceId);
        return ref ? [{ ...ref, name: c.name }] : [];
      }) || [];
  const [referenceId, setReferenceId] = useState(choices[0]?.id || ''),
    [updateSource, setUpdateSource] = useState(!record);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const sourceAllowed = !!snapshot && (!record || record.repository_id === snapshot.repository);
  useEffect(() => {
    setReferenceId(
      choices.find((c) => c.name === record?.evidence[0]?.componentName)?.id ||
        choices[0]?.id ||
        '',
    );
  }, [snapshot?.snapshotId]);
  return (
    <form
      className="dialog-body handoff-form memory-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!workspace || busy) return;
        setBusy(true);
        setError('');
        try {
          if ((!record || updateSource) && (!sourceAllowed || !referenceId))
            throw new Error('Analyze the repository and choose a source component first.');
          const evidence =
            !record || updateSource
              ? { snapshotId: snapshot!.snapshotId, referenceIds: [referenceId] }
              : {};
          const saved = await handoffApi<MemoryRecord>(
            record ? `/api/memory/records/${record.id}/revisions` : '/api/memory/records',
            record
              ? { expectedRevision: record.revision, content, ...evidence }
              : { workspaceId: workspace.id, type, content, ...evidence },
          );
          onSaved(saved);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {!record && (
        <label>
          Knowledge type
          <select
            aria-label="Knowledge type"
            value={type}
            onChange={(e) => setType(e.target.value as MemoryRecord['type'])}
          >
            <option value="decision">Design decision</option>
            <option value="failure_lesson">Failure lesson</option>
          </select>
        </label>
      )}
      <label>
        Title
        <input
          name="memoryTitle"
          required
          maxLength={160}
          value={content.title}
          onChange={(e) => setContent({ ...content, title: e.target.value })}
          placeholder="What should the next developer remember?"
        />
      </label>
      {fieldsForMemory(type).map((field) => (
        <label key={field}>
          {memoryLabels[field]}
          <textarea
            name={field}
            rows={field === 'rationale' || field === 'observedFailure' ? 3 : 2}
            maxLength={5000}
            value={content[field]}
            onChange={(e) => setContent({ ...content, [field]: e.target.value })}
            placeholder={
              field === 'suspectedCause'
                ? 'Leave empty when unknown. A failure does not prove its cause.'
                : field === 'rationale'
                  ? 'Record an explicit engineering explanation; do not infer historical intent from code alone.'
                  : ''
            }
          />
        </label>
      ))}
      {type === 'failure_lesson' && (
        <div className="memory-form-pair">
          <label>
            Cause status
            <select
              value={content.causeStatus}
              onChange={(e) => setContent({ ...content, causeStatus: e.target.value })}
            >
              <option value="unknown">Unknown</option>
              <option value="suspected">Suspected, not established</option>
              <option value="maintainer_reported">Maintainer reported</option>
            </select>
          </label>
          <label>
            Resolution verification
            <select
              value={content.resolutionStatus}
              onChange={(e) => setContent({ ...content, resolutionStatus: e.target.value })}
            >
              <option value="not_verified">Not verified</option>
              <option value="maintainer_reported">Maintainer reported (describe notes)</option>
            </select>
          </label>
        </div>
      )}
      {record && sourceAllowed && (
        <label className="memory-checkbox">
          <input
            type="checkbox"
            checked={updateSource}
            onChange={(e) => setUpdateSource(e.target.checked)}
          />{' '}
          Attach the selected repository version to this new revision
        </label>
      )}
      {(!record || updateSource) && (
        <label>
          Source component{' '}
          {sourceAllowed ? (
            <>
              <small>
                {snapshot!.repository.replace('https://github.com/', '')} ·{' '}
                {snapshot!.commit.slice(0, 12)}
              </small>
              <select
                aria-label="Knowledge source component"
                required
                value={referenceId}
                onChange={(e) => setReferenceId(e.target.value)}
              >
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.file}:{c.startLine}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span>
              Analyze this repository first. Existing revisions keep their original evidence.
            </span>
          )}
        </label>
      )}
      {record && !updateSource && (
        <small>
          The new revision keeps the original source references. Previous content and approvals
          remain in history.
        </small>
      )}
      <p className="memory-honesty">
        A failure lesson can have an unknown cause. Maintainer-reported claims are human input; no
        code, tests or reproduction steps are executed here.
      </p>
      {error && (
        <p role="alert" className="handoff-error">
          {error}
        </p>
      )}
      <Button variant="primary" disabled={busy || (!record && !sourceAllowed)}>
        {busy ? 'Saving draft…' : record ? 'Save new draft revision' : 'Save knowledge draft'}
      </Button>
    </form>
  );
}
