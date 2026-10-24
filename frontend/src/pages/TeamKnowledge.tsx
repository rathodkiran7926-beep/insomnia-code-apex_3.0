import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { HandoffAccountGate, HandoffTeamAccess } from '../components/HandoffAccount';
import { PageHeading, Badge, Button } from '../components/UI';
import { useCollaboration } from '../state/CollaborationContext';
import { useRepositoryAnalysis } from '../state/RepositoryAnalysisContext';
import { handoffApi } from '../services/handoffApi';
import '../styles/handoffs.css';
type Entry = {
  id: string;
  title: string;
  repository_id: string;
  file_path: string;
  commit_sha: string;
  source_url: string;
  explanation: string;
  solution: string;
  approved_by: string;
  confirmed_at: string;
};
export default function TeamKnowledge() {
  return (
    <div className="handoff-page">
      <HandoffAccountGate>
        <Knowledge />
      </HandoffAccountGate>
    </div>
  );
}
function Knowledge() {
  const { workspace } = useCollaboration();
  const { snapshot } = useRepositoryAnalysis();
  const [query, setQuery] = useState(''),
    [entries, setEntries] = useState<Entry[]>([]),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    setOffset(0);
  }, [query, workspace?.id]);
  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(
      () =>
        handoffApi<{ entries: Entry[] }>(
          `/api/handoffs/knowledge?${new URLSearchParams({ workspaceId: workspace.id, search: query, offset: String(offset) })}`,
        )
          .then((r) => {
            if (!cancelled) {
              setEntries(r.entries);
              setError('');
            }
          })
          .catch((e) => {
            if (!cancelled) {
              setError(e.message);
              setEntries([]);
            }
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
  }, [workspace?.id, query, offset]);
  return (
    <>
      <PageHeading
        eyebrow="COLLABORATE / TEAM KNOWLEDGE"
        title="Answers your team has reviewed."
        description="Accepted handoff solutions become reusable knowledge only after a maintainer approves them."
        actions={<HandoffTeamAccess />}
      />
      <label className="handoff-knowledge-search">
        Search approved answers
        <input
          value={query}
          maxLength={160}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a question or explanation"
        />
      </label>
      {error && (
        <p role="alert" className="handoff-error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading approved explanations…</p>
      ) : !entries.length ? (
        <div className="handoff-empty">
          <BookOpen size={30} />
          <h2>No approved answers yet</h2>
          <p>
            Resolve a handoff, confirm the answer, then ask a maintainer to approve it for Team
            Knowledge.
          </p>
          <Link to="/handoffs" className="button button-primary">
            Open handoffs
          </Link>
        </div>
      ) : (
        <div className="handoff-knowledge-grid">
          {entries.map((e) => (
            <article className="handoff-panel" key={e.id}>
              <div className="handoff-panel-body">
                <Badge tone="green">Maintainer approved</Badge>
                {snapshot?.repository === e.repository_id && snapshot.commit !== e.commit_sha && (
                  <Badge tone="amber">Different commit from selected analysis</Badge>
                )}
                <h2>{e.title}</h2>
                <p>{e.explanation}</p>
                <h3>Accepted solution</h3>
                <p>{e.solution}</p>
                <a href={e.source_url} target="_blank" rel="noreferrer">
                  {e.file_path} · {e.commit_sha.slice(0, 12)}
                </a>
                <small>
                  Approved by {e.approved_by}. Answer confirmed{' '}
                  {new Date(e.confirmed_at).toLocaleString()}.
                </small>
                <small>
                  This explanation belongs to the pinned commit above. Later behavior may differ.
                </small>
                <Link className="button" to={`/handoffs/${e.id}`}>
                  Read the original discussion
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="handoff-actions">
        {offset > 0 && (
          <Button onClick={() => setOffset((v) => Math.max(0, v - 30))}>Previous</Button>
        )}
        {entries.length === 30 && <Button onClick={() => setOffset((v) => v + 30)}>Next</Button>}
      </div>
    </>
  );
}
