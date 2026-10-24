import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ArrowUpRight } from 'lucide-react';
import { useCollaboration } from '../state/CollaborationContext';
import { handoffApi } from '../services/handoffApi';
import type { MemoryRecord } from '../services/engineeringMemory';
import '../styles/engineering-memory.css';
export function RelatedTeamKnowledge({
  snapshotId,
  referenceId,
  repository,
}: {
  snapshotId: string;
  referenceId: string;
  repository: string;
}) {
  const { workspace, account } = useCollaboration();
  const [entries, setEntries] = useState<MemoryRecord[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    setEntries([]);
    setError('');
    if (!workspace || !account) return;
    let cancelled = false;
    handoffApi<{ entries: MemoryRecord[] }>(
      `/api/memory/records?${new URLSearchParams({ workspaceId: workspace.id, repository, snapshotId, referenceId })}`,
    )
      .then((r) => {
        if (!cancelled) setEntries(r.entries.slice(0, 3));
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace?.id, account?.user.id, snapshotId, referenceId, repository]);
  if (!account || (!entries.length && !error)) return null;
  return (
    <aside className="related-team-knowledge">
      <h4>
        <BookOpen size={14} /> Existing team knowledge for this code
      </h4>
      {error ? (
        <p>Knowledge search unavailable: {error}</p>
      ) : (
        entries.map((entry) => (
          <Link key={entry.id} to={`/knowledge?record=${entry.id}`}>
            <span>
              <strong>{entry.content.title}</strong>
              <small>
                {entry.type === 'decision' ? 'Decision' : 'Failure lesson'} ·{' '}
                {entry.authoritative
                  ? 'Approved at its recorded version'
                  : 'Review applicability before reuse'}
              </small>
            </span>
            <ArrowUpRight size={14} />
          </Link>
        ))
      )}
      <p>
        Check a reviewed explanation before creating another handoff. You can still ask your senior
        for clarification.
      </p>
    </aside>
  );
}
