import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  GitBranch,
  ShieldCheck,
  Plus,
  RefreshCw,
  TriangleAlert,
  History,
} from 'lucide-react';
import { HandoffAccountGate, HandoffTeamAccess } from '../components/HandoffAccount';
import { CollaborationTabs } from '../components/CollaborationTabs';
import { MemoryEditor } from '../components/MemoryEditor';
import { PageHeading, Badge, Button } from '../components/UI';
import { useCollaboration } from '../state/CollaborationContext';
import { useRepositoryAnalysis } from '../state/RepositoryAnalysisContext';
import { handoffApi } from '../services/handoffApi';
import { fieldsForMemory, memoryLabels, type MemoryRecord } from '../services/engineeringMemory';
import '../styles/handoffs.css';
const label = (s: string) => s.replaceAll('_', ' ');
function RecordStatus({ record }: { record: MemoryRecord }) {
  return (
    <div className="memory-status-row">
      <Badge
        tone={
          record.status === 'approved'
            ? 'green'
            : record.status === 'needs_review'
              ? 'amber'
              : 'violet'
        }
      >
        {label(record.status)}
      </Badge>
      <Badge tone="violet">
        {record.type === 'decision' ? 'Design decision' : 'Failure lesson'}
      </Badge>
      <small>Revision {record.revision}</small>
    </div>
  );
}
export default function TeamKnowledge() {
  return (
    <div className="handoff-page">
      <CollaborationTabs />
      <HandoffAccountGate>
        <Knowledge />
      </HandoffAccountGate>
    </div>
  );
}
function Knowledge() {
  const { workspace, account } = useCollaboration(),
    { snapshot } = useRepositoryAnalysis();
  const [params, setParams] = useSearchParams(),
    selectedId = params.get('record');
  const [query, setQuery] = useState(''),
    [type, setType] = useState(''),
    [status, setStatus] = useState(''),
    [drafts, setDrafts] = useState(false),
    [offset, setOffset] = useState(0),
    [reload, setReload] = useState(0);
  const [entries, setEntries] = useState<MemoryRecord[]>([]),
    [total, setTotal] = useState(0),
    [record, setRecord] = useState<MemoryRecord | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [detailLoading, setDetailLoading] = useState(false);
  const [editor, setEditor] = useState<MemoryRecord | 'new' | null>(null);
  useEffect(() => {
    setOffset(0);
  }, [query, type, status, drafts, workspace?.id]);
  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    setLoading(true);
    setEntries([]);
    setError('');
    const timer = setTimeout(
      () =>
        handoffApi<{ entries: MemoryRecord[]; total: number }>(
          `/api/memory/records?${new URLSearchParams({ workspaceId: workspace.id, q: query, type, status, includeDrafts: String(drafts), offset: String(offset) })}`,
        )
          .then((r) => {
            if (!cancelled) {
              setEntries(r.entries);
              setTotal(r.total);
            }
          })
          .catch((e) => {
            if (!cancelled) setError(e.message);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          }),
      180,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workspace?.id, query, type, status, drafts, offset, reload]);
  useEffect(() => {
    setRecord(null);
    if (!selectedId || !workspace) return;
    let cancelled = false;
    setDetailLoading(true);
    handoffApi<MemoryRecord>(`/api/memory/records/${selectedId}`)
      .then(async (base) => {
        if (base.workspace_id !== workspace.id)
          throw new Error('Choose this record’s workspace through Team access before opening it.');
        const next =
          snapshot?.repository === base.repository_id
            ? await handoffApi<MemoryRecord>(
                `/api/memory/records/${selectedId}?snapshotId=${snapshot.snapshotId}`,
              )
            : base;
        if (!cancelled) setRecord(next);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, workspace?.id, snapshot?.snapshotId, reload]);
  const refresh = () => setReload((n) => n + 1);
  return (
    <>
      <PageHeading
        eyebrow="COLLABORATE / LIVING ENGINEERING MEMORY"
        title="Keep the reason. Remember the lesson."
        description="Handoffs hold the conversation. Team Knowledge preserves reviewed decisions and failure lessons, with source evidence and revision history."
        actions={<HandoffTeamAccess />}
      />
      <div className="memory-toolbar">
        <label className="memory-search">
          Search team knowledge
          <input
            aria-label="Search team knowledge"
            value={query}
            maxLength={160}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Decision, rationale, failure or lesson"
          />
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Decisions & failure lessons</option>
            <option value="decision">Design decisions</option>
            <option value="failure_lesson">Failure lessons</option>
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All visible statuses</option>
            {(drafts
              ? ['draft', 'awaiting_review', 'approved', 'needs_review', 'superseded', 'withdrawn']
              : ['approved', 'needs_review']
            ).map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
        <Button icon={RefreshCw} onClick={refresh}>
          Refresh knowledge
        </Button>
        <Button variant="primary" icon={Plus} onClick={() => setEditor('new')}>
          Capture knowledge
        </Button>
      </div>
      <label className="memory-checkbox">
        <input
          type="checkbox"
          checked={drafts}
          onChange={(e) => {
            setDrafts(e.target.checked);
            setStatus('');
          }}
        />{' '}
        Include drafts and historical records (never presented as current approved guidance)
      </label>
      {error && (
        <p role="alert" className="handoff-error">
          {error}
        </p>
      )}
      {detailLoading && <p role="status">Opening the saved knowledge revision…</p>}
      {record && (
        <MemoryDetails
          key={`${record.id}:${record.revision}:${record.status}:${record.applicability.state}`}
          record={record}
          canEdit={record.created_by === account?.user.id || workspace?.role === 'maintainer'}
          canApprove={workspace?.role === 'maintainer'}
          onClose={() => setParams({})}
          onEdit={() => setEditor(record)}
          onChanged={refresh}
          replacements={entries.filter(
            (e) =>
              e.id !== record.id &&
              e.status === 'approved' &&
              e.repository_id === record.repository_id,
          )}
        />
      )}
      {loading ? (
        <p role="status">Loading team knowledge…</p>
      ) : !entries.length ? (
        <div className="handoff-empty">
          <BookOpen size={30} />
          <h2>
            {query || type || status
              ? 'No knowledge matches these filters'
              : 'No published knowledge yet'}
          </h2>
          <p>
            Save a confirmed handoff answer, or capture a decision or failure lesson directly. A
            maintainer approves the exact revision before publication.
          </p>
          <Link to="/handoffs" className="button">
            Open handoffs
          </Link>
          <Button onClick={() => setEditor('new')}>Capture knowledge</Button>
        </div>
      ) : (
        <div className="handoff-knowledge-grid">
          {entries.map((e) => (
            <article className="handoff-panel memory-card" key={e.id}>
              <div className="handoff-panel-body">
                <span className="memory-type-icon">
                  {e.type === 'decision' ? <GitBranch size={18} /> : <TriangleAlert size={18} />}
                </span>
                <RecordStatus record={e} />
                <h2>{e.content.title}</h2>
                <p>{e.content.summary || e.content.rationale || e.content.observedFailure}</p>
                {snapshot?.repository === e.repository_id &&
                  e.evidence.some((ref) => ref.commit !== snapshot.commit) && (
                    <Badge tone="amber">Different source version</Badge>
                  )}
                <small>{e.repository_id.replace('https://github.com/', '')}</small>
                {e.approvedBy && (
                  <small>
                    Approved by {e.approvedBy}
                    {e.approvedAt ? ` · ${new Date(e.approvedAt).toLocaleString()}` : ''}
                  </small>
                )}
                <Button onClick={() => setParams({ record: e.id })}>Open knowledge</Button>
                {e.origin_session_id && (
                  <Link to={`/handoffs/${e.origin_session_id}`}>Read the original discussion</Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="handoff-actions">
        {offset > 0 && (
          <Button onClick={() => setOffset((n) => Math.max(0, n - 30))}>Previous</Button>
        )}
        {offset + 30 < total && <Button onClick={() => setOffset((n) => n + 30)}>Next</Button>}
      </div>
      <MemoryEditor
        open={!!editor}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        record={typeof editor === 'object' ? editor || undefined : undefined}
        onSaved={(saved) => {
          setEditor(null);
          setDrafts(true);
          setStatus('');
          setQuery('');
          setParams({ record: saved.id });
          refresh();
        }}
      />
    </>
  );
}
function MemoryDetails({
  record,
  canEdit,
  canApprove,
  onClose,
  onEdit,
  onChanged,
  replacements,
}: {
  record: MemoryRecord;
  canEdit: boolean;
  canApprove: boolean;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
  replacements: MemoryRecord[];
}) {
  const { snapshot } = useRepositoryAnalysis();
  const [reason, setReason] = useState(''),
    [replacement, setReplacement] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [history, setHistory] = useState<{
    revisions: {
      revision: number;
      content: MemoryRecord['content'];
      approvedBy: string | null;
      approvedAt: string | null;
      createdAt: string;
    }[];
    events: { id: string; action: string; actor: string; created_at: string; metadata: unknown }[];
  } | null>(null);
  async function action(name: string, body: object = {}) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await handoffApi(`/api/memory/records/${record.id}/${name}`, {
        expectedRevision: record.revision,
        ...body,
      });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const archived = ['superseded', 'withdrawn'].includes(record.status);
  return (
    <section className="memory-detail" aria-label="Knowledge record details">
      <div className="memory-detail-head">
        <div>
          <RecordStatus record={record} />
          <h2>{record.content.title}</h2>
        </div>
        <Button onClick={onClose}>Close record</Button>
      </div>
      <p className={record.authoritative ? 'memory-honesty' : 'memory-notice'}>
        <ShieldCheck size={14} />{' '}
        {record.status === 'approved'
          ? 'This revision was approved by a maintainer.'
          : 'This record is not current approved guidance.'}{' '}
        {record.applicability.note}
      </p>
      {fieldsForMemory(record.type)
        .filter((key) => record.content[key])
        .map((key) => (
          <div key={key}>
            <h3>{memoryLabels[key]}</h3>
            <p>{record.content[key]}</p>
          </div>
        ))}
      {record.type === 'failure_lesson' && (
        <p className="memory-notice">
          Cause: {label(record.content.causeStatus)}. Resolution verification:{' '}
          {label(record.content.resolutionStatus)}. These are reported knowledge fields; Codebase
          Mentor has not executed a reproduction.
        </p>
      )}
      <div className="memory-evidence">
        <strong>Original source evidence</strong>
        {record.evidence.map((e) => (
          <a key={`${e.snapshotId}:${e.referenceId}`} href={e.url} target="_blank" rel="noreferrer">
            {e.componentName || e.file} · {e.file}:{e.startLine}–{e.endLine} ·{' '}
            {e.commit.slice(0, 12)}
          </a>
        ))}
      </div>
      {record.origin_session_id && (
        <Link className="button" to={`/handoffs/${record.origin_session_id}`}>
          Open the original handoff conversation
        </Link>
      )}
      {record.superseded_by && (
        <Link className="button" to={`/knowledge?record=${record.superseded_by}`}>
          Open replacement knowledge
        </Link>
      )}
      <p className="memory-honesty">{record.publicationNote}</p>
      {error && (
        <p role="alert" className="handoff-error">
          {error}
        </p>
      )}
      <div className="memory-actions">
        {canEdit && !archived && (
          <Button disabled={busy} onClick={onEdit}>
            Revise knowledge
          </Button>
        )}
        {canEdit && record.status === 'draft' && (
          <Button disabled={busy} onClick={() => void action('submit')}>
            Submit for review
          </Button>
        )}
        {canApprove && record.status === 'awaiting_review' && (
          <Button variant="primary" disabled={busy} onClick={() => void action('approve')}>
            Approve this revision
          </Button>
        )}
        {canApprove &&
          snapshot?.repository === record.repository_id &&
          ['approved', 'needs_review'].includes(record.status) && (
            <Button
              disabled={busy}
              onClick={() =>
                void action('check-applicability', { snapshotId: snapshot.snapshotId })
              }
            >
              Check selected source version
            </Button>
          )}
      </div>
      {canApprove && !archived && (
        <details className="memory-history">
          <summary>Publication & applicability actions</summary>
          <label>
            Review / withdrawal note
            <textarea
              aria-label="Knowledge action reason"
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain the review or withdrawal. History is preserved."
            />
          </label>
          <div className="memory-actions">
            <Button
              disabled={busy || !reason.trim()}
              onClick={() => void action('withdraw', { reason })}
            >
              Withdraw knowledge
            </Button>
            {record.status === 'needs_review' && (
              <Button
                disabled={busy || !reason.trim()}
                onClick={() => void action('review', { outcome: 'still_applicable', reason })}
              >
                Keep historical approval
              </Button>
            )}
          </div>
          {replacements.length > 0 && (
            <>
              <h3>Supersede with an approved record</h3>
              <select
                aria-label="Replacement knowledge"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
              >
                <option value="">Choose an approved replacement</option>
                {replacements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.content.title}
                  </option>
                ))}
              </select>
              <Button
                disabled={busy || !replacement || !reason.trim()}
                onClick={() => void action('supersede', { replacementId: replacement, reason })}
              >
                Supersede knowledge
              </Button>
            </>
          )}
        </details>
      )}
      <details
        className="memory-history"
        onToggle={async (e) => {
          if (!e.currentTarget.open || history) return;
          try {
            setHistory(await handoffApi(`/api/memory/records/${record.id}/history`));
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <summary>
          <History size={14} /> Revision history & audit trail
        </summary>
        {history?.revisions.map((revision) => (
          <article key={revision.revision}>
            <strong>
              Revision {revision.revision} ·{' '}
              {revision.approvedBy
                ? `Approved by ${revision.approvedBy}${revision.approvedAt ? '' : ' · historical approval time not recorded'}`
                : 'Unapproved draft'}
            </strong>
            <p>{revision.content.title}</p>
            <pre>
              {revision.content.rationale ||
                revision.content.observedFailure ||
                revision.content.summary}
            </pre>
          </article>
        ))}
        {history?.events.map((event) => (
          <p key={event.id}>
            {label(event.action)} · {event.actor} · {new Date(event.created_at).toLocaleString()}
          </p>
        ))}
      </details>
    </section>
  );
}
