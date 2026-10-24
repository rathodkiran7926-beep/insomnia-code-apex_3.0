import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Send, GitCommitHorizontal, Users } from 'lucide-react';
import type { RepositorySnapshot } from '../domain/analysisTypes';
import { useCollaboration } from '../state/CollaborationContext';
import { handoffApi, type HandoffDetail, type TeamMember } from '../services/handoffApi';
import { HandoffAccountGate, HandoffTeamAccess } from './HandoffAccount';
import { RepositorySource } from './RepositorySource';
import { Modal, Button } from './UI';

export function CreateHandoffModal({
  open,
  onOpenChange,
  snapshot,
  referenceId,
  source,
  selection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: RepositorySnapshot;
  referenceId: string;
  source: { file: string; excerpt: string; endLine: number };
  selection: { startLine: number; endLine: number };
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Create Handoff Snapshot"
      description="Ask a teammate about this code. The original source stays pinned to this commit."
      className="handoff-create-dialog"
    >
      <HandoffAccountGate>
        <CreateForm
          key={`${snapshot.snapshotId}:${referenceId}:${selection.startLine}:${selection.endLine}:${open}`}
          {...{ snapshot, referenceId, source, selection }}
        />
      </HandoffAccountGate>
    </Modal>
  );
}
function CreateForm({
  snapshot,
  referenceId,
  source,
  selection,
}: Omit<Parameters<typeof CreateHandoffModal>[0], 'open' | 'onOpenChange'>) {
  const { workspace } = useCollaboration();
  const [start, setStart] = useState(selection.startLine),
    [end, setEnd] = useState(selection.endLine);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [created, setCreated] = useState<HandoffDetail | null>(null);
  const requestId = useRef(crypto.randomUUID()),
    lock = useRef(false);
  useEffect(() => {
    setMembers([]);
    if (!workspace) return;
    let cancelled = false;
    handoffApi<{ members: TeamMember[] }>(`/api/collaboration/workspaces/${workspace.id}/members`)
      .then((r) => {
        if (!cancelled) setMembers(r.members);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace?.id]);
  const code = source.excerpt
    .split('\n')
    .slice(start - 1, end)
    .join('\n');
  const valid =
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 1 &&
    end >= start &&
    end <= source.endLine &&
    end - start < 300 &&
    code.length <= 18000 &&
    !!code.trim();
  if (created) {
    const link = `${location.origin}${location.pathname}#/handoffs/${created.session.id}`;
    return (
      <div className="dialog-body handoff-form">
        <div className="handoff-emblem">
          <Users />
        </div>
        <h3>Your handoff is ready</h3>
        <p>{created.session.title}</p>
        <label>
          Session link
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
        </label>
        <small>
          Only authorized workspace members can open it. Invite your senior using Team access.
        </small>
        <div className="handoff-actions">
          <Button
            icon={Copy}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setError('Link copied.');
              } catch {
                setError('Select and copy the link above.');
              }
            }}
          >
            Copy link
          </Button>
          <Link className="button button-primary" to={`/handoffs/${created.session.id}`}>
            Open session
          </Link>
          <HandoffTeamAccess />
        </div>
        {error && <p role="status">{error}</p>}
      </div>
    );
  }
  return (
    <form
      className="dialog-body handoff-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || !workspace || lock.current) return;
        lock.current = true;
        setBusy(true);
        setError('');
        const data = new FormData(e.currentTarget);
        try {
          setCreated(
            await handoffApi<HandoffDetail>('/api/handoffs', {
              requestId: requestId.current,
              workspaceId: workspace.id,
              snapshotId: snapshot.snapshotId,
              referenceId,
              startLine: start,
              endLine: end,
              title: String(data.get('title')),
              question: String(data.get('question')),
              expectedBehavior: String(data.get('expected')),
              actualBehavior: String(data.get('actual')),
              attemptedSolutions: String(data.get('tried')),
              assignedTo: data.get('assigned') || null,
            }),
          );
        } catch (err) {
          setError((err as Error).message);
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <div className="handoff-source-meta">
        <strong>{snapshot.repository.replace('https://github.com/', '')}</strong>
        <span>{source.file}</span>
        <span>
          <GitCommitHorizontal size={13} /> {snapshot.commit.slice(0, 12)} · {workspace?.name}
        </span>
      </div>
      <div className="handoff-columns">
        <label>
          From line
          <input
            type="number"
            min={1}
            max={source.endLine}
            value={start}
            onChange={(e) => setStart(Number(e.target.value))}
            required
          />
        </label>
        <label>
          To line
          <input
            type="number"
            min={start}
            max={source.endLine}
            value={end}
            onChange={(e) => setEnd(Number(e.target.value))}
            required
          />
        </label>
      </div>
      {!valid && (
        <p className="handoff-error" role="alert">
          Select 1–300 non-empty lines inside this file, up to 18,000 characters.
        </p>
      )}
      <label>
        Session title
        <input
          name="title"
          maxLength={160}
          required
          placeholder="What do you need help understanding?"
        />
      </label>
      <label>
        Your question
        <textarea
          name="question"
          maxLength={2500}
          required
          rows={3}
          placeholder="Why does this code behave this way?"
        />
      </label>
      <details>
        <summary>Add debugging notes (optional)</summary>
        <div className="handoff-form">
          <label>
            What have you tried?
            <textarea name="tried" maxLength={2500} rows={2} />
          </label>
          <label>
            Expected behavior
            <textarea name="expected" maxLength={2500} rows={2} />
          </label>
          <label>
            Actual behavior
            <textarea name="actual" maxLength={2500} rows={2} />
          </label>
        </div>
      </details>
      <label>
        Ask a senior / reviewer
        <select name="assigned" key={workspace?.id}>
          <option value="">Anyone on the team</option>
          {members
            .filter((m) => m.role !== 'developer')
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.role}
              </option>
            ))}
        </select>
      </label>
      <small>
        This shares the saved analyzed files and architecture at this commit, with your selected
        lines highlighted. Local edits and unrelated mentor chat are excluded.
      </small>
      {valid && (
        <RepositorySource
          source={{
            file: source.file,
            excerpt: code,
            startLine: start,
            endLine: end,
            url: `${snapshot.repository}/blob/${snapshot.commit}/${source.file}#L${start}-L${end}`,
          }}
          commit={snapshot.commit}
          focusRange={{ startLine: start, endLine: end }}
        />
      )}
      {error && (
        <p className="handoff-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" icon={Send} disabled={busy || !valid || !workspace}>
        {busy ? 'Saving snapshot…' : 'Create handoff'}
      </Button>
    </form>
  );
}
