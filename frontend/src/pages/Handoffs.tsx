import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  Copy,
  MessageSquareText,
  Plus,
  RefreshCw,
  Send,
  Users,
} from 'lucide-react';
import { Button, Badge, PageHeading } from '../components/UI';
import { HandoffRepositoryBrowser } from '../components/HandoffRepositoryBrowser';
import { HandoffAccountGate, HandoffTeamAccess } from '../components/HandoffAccount';
import { useCollaboration } from '../state/CollaborationContext';
import {
  handoffApi,
  type HandoffDetail,
  type HandoffSession,
  type HandoffComment,
  type TeamMember,
} from '../services/handoffApi';
import '../styles/handoffs.css';

const statusLabel = (value: string) => value.toLowerCase().replaceAll('_', ' ');
const date = (value: string) => new Date(value).toLocaleString();
function Status({ value }: { value: string }) {
  return (
    <Badge tone={value === 'RESOLVED' ? 'green' : value === 'NEEDS_CONTEXT' ? 'amber' : 'violet'}>
      {statusLabel(value)}
    </Badge>
  );
}
export default function Handoffs() {
  const { id } = useParams();
  return (
    <div className="handoff-page">
      <HandoffAccountGate>{id ? <Review key={id} id={id} /> : <SessionList />}</HandoffAccountGate>
    </div>
  );
}
function SessionList() {
  const { workspace } = useCollaboration();
  const [filter, setFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [repository, setRepository] = useState(''),
    [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0),
    [reload, setReload] = useState(0);
  const [data, setData] = useState<{
    sessions: HandoffSession[];
    total: number;
    repositories: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    setOffset(0);
  }, [filter, query, repository, status, workspace?.id]);
  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        workspaceId: workspace.id,
        filter,
        search: query,
        repository,
        status,
        offset: String(offset),
      });
      handoffApi<typeof data>(`/api/handoffs?${params}`)
        .then((r) => {
          if (!cancelled) setData(r);
        })
        .catch((e) => {
          if (!cancelled) {
            setError(e.message);
            setData(null);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workspace?.id, filter, query, repository, status, offset, reload]);
  return (
    <>
      <PageHeading
        eyebrow="COLLABORATE / CONTEXT HANDOFFS"
        title="A question, with the code attached."
        description="Give your teammate the original code, your debugging context, and a place to work through the answer."
        actions={
          <>
            <HandoffTeamAccess />
            <Link className="button button-primary" to="/workspace">
              <Plus size={15} />
              New handoff
            </Link>
          </>
        }
      />
      <div className="handoff-list-toolbar">
        <div className="handoff-filter-tabs" aria-label="Handoff filters">
          {[
            ['all', 'All sessions'],
            ['mine', 'My sessions'],
            ['assigned', 'Assigned to me'],
            ['open', 'Open'],
            ['resolved', 'Resolved'],
          ].map(([id, label]) => (
            <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="handoff-filters">
          <label>
            Search
            <input
              placeholder="Title or question"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={160}
            />
          </label>
          <label>
            Repository
            <select value={repository} onChange={(e) => setRepository(e.target.value)}>
              <option value="">All repositories</option>
              {data?.repositories.map((r) => (
                <option key={r} value={r}>
                  {r.replace('https://github.com/', '')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {['OPEN', 'IN_REVIEW', 'NEEDS_CONTEXT', 'RESOLVED', 'CLOSED'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <Button icon={RefreshCw} onClick={() => setReload((v) => v + 1)}>
            Refresh
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="handoff-error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="handoff-empty">
          Loading your sessions…
        </p>
      ) : data && !data.sessions.length ? (
        <div className="handoff-empty">
          <MessageSquareText size={30} />
          <h2>
            {query || filter !== 'all'
              ? 'No matching sessions'
              : 'Start with a focused code question'}
          </h2>
          <p>
            Open Workspace, choose a component or click a line number, then choose Create Handoff
            Snapshot.
          </p>
          <Link to="/workspace" className="button button-primary">
            Choose code <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div className="handoff-session-list">
          {data?.sessions.map((s) => (
            <Link className="handoff-session-card" key={s.id} to={`/handoffs/${s.id}`}>
              <div className="handoff-session-icon">
                <MessageSquareText size={19} />
              </div>
              <div>
                <div className="handoff-actions">
                  <h3>{s.title}</h3>
                  <Status value={s.status} />
                </div>
                <p>{s.question}</p>
                <small>
                  {s.repository_id.replace('https://github.com/', '')} /{' '}
                  {s.file_path?.split('/').pop()} · {s.commit_sha?.slice(0, 7)}
                </small>
                <small>
                  {s.author_name} · Updated {date(s.updated_at)}
                </small>
              </div>
              <ArrowRight size={18} />
            </Link>
          ))}
        </div>
      )}
      {data && data.total > 30 && (
        <div className="handoff-actions">
          <Button disabled={!offset} onClick={() => setOffset((v) => Math.max(0, v - 30))}>
            Previous
          </Button>
          <span>
            {offset + 1}–{Math.min(offset + 30, data.total)} of {data.total}
          </span>
          <Button disabled={offset + 30 >= data.total} onClick={() => setOffset((v) => v + 30)}>
            Next
          </Button>
        </div>
      )}
    </>
  );
}
function Review({ id }: { id: string }) {
  const { account, workspace, select } = useCollaboration();
  const [data, setData] = useState<HandoffDetail | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]),
    [comment, setComment] = useState(''),
    [contextRequest, setContextRequest] = useState(false);
  const [line, setLine] = useState<number | null>(null),
    [lineEnd, setLineEnd] = useState<number | null>(null);
  const [extraComments, setExtraComments] = useState<HandoffComment[]>([]),
    [showSolution, setShowSolution] = useState(false),
    [copyMessage, setCopyMessage] = useState('');
  const load = useCallback(async () => {
    try {
      const result = await handoffApi<HandoffDetail>(`/api/handoffs/${id}`);
      setData(result);
      setError('');
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const workspaceId = data?.session.workspace_id;
    if (!workspaceId) return;
    select(workspaceId);
    let cancelled = false;
    handoffApi<{ members: TeamMember[] }>(`/api/collaboration/workspaces/${workspaceId}/members`)
      .then((r) => {
        if (!cancelled) setMembers(r.members);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [data?.session.workspace_id]);
  async function mutate(suffix: string, body: unknown, method = 'POST') {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      const result = await handoffApi<HandoffDetail>(`/api/handoffs/${id}${suffix}`, body, method);
      setData((old) => ({ ...result, role: old?.role }));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <p role="status" className="handoff-empty">
        Opening the saved handoff…
      </p>
    );
  if (!data)
    return (
      <div className="handoff-empty">
        <h2>Handoff unavailable</h2>
        <p role="alert">{error}</p>
        <p>Use the same backend as your teammate and ask for a workspace invitation.</p>
        <Button onClick={load}>Retry</Button>
        <Link to="/handoffs">Back to handoffs</Link>
      </div>
    );
  const { session: s, snapshot: p } = data;
  const author = account?.user.id === s.created_by,
    canReview = data.role === 'maintainer' || data.role === 'reviewer';
  const locked = ['RESOLVED', 'CLOSED'].includes(s.status),
    allComments = [
      ...data.comments,
      ...extraComments.filter((c) => !data.comments.some((d) => d.id === c.id)),
    ];
  const annotated = [
    ...new Set(
      allComments
        .filter((c) => c.line_start)
        .flatMap((c) =>
          Array.from(
            { length: (c.line_end || c.line_start!) - c.line_start! + 1 },
            (_, i) => c.line_start! + i,
          ),
        ),
    ),
  ];
  const latestResolution = data.resolutions[0];
  async function copyLink() {
    try {
      const result = await handoffApi<{ path: string }>(`/api/handoffs/${id}/share`, {});
      await navigator.clipboard.writeText(
        `${location.origin}${location.pathname}${result.path.slice(1)}`,
      );
      setCopyMessage('Session link copied. Team membership is required.');
    } catch {
      setCopyMessage('Copy this page’s address to share it with an invited teammate.');
    }
  }
  return (
    <>
      <Link className="handoff-back" to="/handoffs">
        <ArrowLeft size={15} />
        All handoffs
      </Link>
      <header className="handoff-review-heading">
        <div>
          <span className="eyebrow">CONTEXT HANDOFF</span>
          <h1>{s.title}</h1>
          <p>
            {s.repository_id.replace('https://github.com/', '')} ·{' '}
            {p.branch_name || 'Pinned commit'} · <code>{p.commit_sha.slice(0, 12)}</code>
          </p>
          <small>
            Asked by {s.author_name} · {date(s.created_at)}
          </small>
        </div>
        <div className="handoff-actions">
          <Status value={s.status} />
          <Button icon={Copy} onClick={copyLink}>
            Copy link
          </Button>
          <Button icon={RefreshCw} disabled={busy} onClick={load}>
            Refresh
          </Button>
          <HandoffTeamAccess />
        </div>
      </header>
      {copyMessage && (
        <p role="status" className="handoff-note">
          {copyMessage}
        </p>
      )}
      {error && (
        <p role="alert" className="handoff-error">
          {error}
        </p>
      )}
      <div className="handoff-review-layout">
        <div className="handoff-main-column">
          <HandoffRepositoryBrowser
            data={data}
            annotationLines={annotated}
            annotationRange={line ? { startLine: line, endLine: lineEnd || line } : null}
            onAnnotate={(start, end) => {
              setLine(start);
              setLineEnd(end);
              document.getElementById('handoff-comment')?.focus({ preventScroll: true });
            }}
          />
          <section className="handoff-panel">
            <div className="handoff-panel-title">
              <h2>
                <MessageSquareText size={18} />
                Developer & senior discussion
              </h2>
              <small>{data.commentCount} replies</small>
            </div>
            <div className="handoff-panel-body">
              {!allComments.length && (
                <p className="muted">
                  No replies yet. Ask for clarification or share your first answer.
                </p>
              )}
              {allComments.map((c) => (
                <article
                  className={`handoff-comment ${line && c.line_start && line >= c.line_start && line <= (c.line_end || c.line_start) ? 'handoff-comment-focused' : ''}`}
                  key={c.id}
                >
                  <div className="handoff-actions">
                    <strong>{c.author_name}</strong>
                    <time>{date(c.created_at)}</time>
                    {c.kind === 'context_request' && <Badge tone="amber">Context requested</Badge>}
                    {c.line_start && (
                      <button
                        onClick={() => {
                          setLine(c.line_start);
                          setLineEnd(c.line_end);
                        }}
                      >
                        L{c.line_start}
                        {c.line_end !== c.line_start ? `–${c.line_end}` : ''} ·{' '}
                        {p.file_path.split('/').pop()}
                      </button>
                    )}
                  </div>
                  <p>{c.content}</p>
                </article>
              ))}
              {allComments.length < data.commentCount && (
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await handoffApi<{ comments: HandoffComment[] }>(
                        `/api/handoffs/${id}/comments?offset=${allComments.length}`,
                      );
                      setExtraComments((old) => [...old, ...r.comments]);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Load earlier conversation pages
                </Button>
              )}
              {!locked && (
                <form
                  className="handoff-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (
                      await mutate('/comments', {
                        content: comment,
                        ...(line ? { lineStart: line, lineEnd: lineEnd || line } : {}),
                        kind: contextRequest ? 'context_request' : 'comment',
                      })
                    ) {
                      setComment('');
                      setLine(null);
                      setLineEnd(null);
                      setContextRequest(false);
                    }
                  }}
                >
                  {line && (
                    <div className="handoff-note">
                      Annotating {p.file_path.split('/').pop()}:L{line}
                      {lineEnd && lineEnd !== line ? `–${lineEnd}` : ''}
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setLine(null);
                          setLineEnd(null);
                        }}
                      >
                        Clear selection
                      </Button>
                    </div>
                  )}
                  <label>
                    {contextRequest
                      ? 'What extra context do you need?'
                      : author
                        ? 'Add a follow-up question or context'
                        : 'Your answer or review comment'}
                    <textarea
                      id="handoff-comment"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      maxLength={5000}
                      rows={4}
                      required
                      placeholder="Explain your reasoning and refer to the saved code…"
                    />
                  </label>
                  <div className="handoff-actions">
                    <Button
                      variant="primary"
                      type="submit"
                      icon={Send}
                      disabled={busy || !comment.trim()}
                    >
                      {busy ? 'Saving…' : contextRequest ? 'Request context' : 'Post reply'}
                    </Button>
                    {canReview && (
                      <label className="handoff-inline-check">
                        <input
                          type="checkbox"
                          checked={contextRequest}
                          onChange={(e) => setContextRequest(e.target.checked)}
                        />
                        Request more context
                      </label>
                    )}
                  </div>
                </form>
              )}
            </div>
          </section>
        </div>
        <div className="handoff-side-column">
          <aside className="handoff-panel handoff-context">
            <div className="handoff-panel-title">
              <h2>The developer’s question</h2>
            </div>
            <div className="handoff-panel-body">
              <p className="handoff-question">{s.question}</p>
              {[
                ['Expected behavior', s.expected_behavior],
                ['Actual behavior', s.actual_behavior],
                ['Already tried', s.attempted_solutions],
              ].map(
                ([label, value]) =>
                  value && (
                    <section key={label}>
                      <h3>{label}</h3>
                      <p>{value}</p>
                    </section>
                  ),
              )}
              <div className="handoff-briefing">
                <h3>Focused AI briefing</h3>
                <p className="muted">
                  {p.briefing?.notice ||
                    'Your snapshot is saved. A briefing can be generated from its evidence.'}
                </p>
                {p.briefing?.purpose && (
                  <p>
                    {p.briefing.purpose.text}
                    <CitationLinks ids={p.briefing.purpose.referenceIds} data={data} />
                  </p>
                )}
                {p.briefing?.findings?.length ? (
                  <section>
                    <h4>Evidence-backed findings</h4>
                    {p.briefing.findings.map((f, i) => (
                      <p key={i}>
                        {f.text}
                        <CitationLinks ids={f.referenceIds} data={data} />
                      </p>
                    ))}
                  </section>
                ) : null}
                {[
                  ['Possible explanations', p.briefing?.hypotheses],
                  ['Unresolved questions', p.briefing?.unresolved],
                  ['For senior review', p.briefing?.review],
                ].map(
                  ([label, values]) =>
                    Array.isArray(values) &&
                    values.length > 0 && (
                      <section key={String(label)}>
                        <h4>{String(label)}</h4>
                        <ul>
                          {values.map((v, i) => (
                            <li key={i}>{v}</li>
                          ))}
                        </ul>
                      </section>
                    ),
                )}
                <Button
                  disabled={busy || p.briefing?.state === 'complete'}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await handoffApi(`/api/handoffs/${id}/context`, {});
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy
                    ? 'Working…'
                    : p.briefing?.state === 'complete'
                      ? 'Briefing saved'
                      : 'Generate / retry briefing'}
                </Button>
              </div>
              {p.context.limitations.map((l) => (
                <small className="handoff-limit" key={l}>
                  {l}
                </small>
              ))}
            </div>
          </aside>
          <aside className="handoff-panel">
            <div className="handoff-panel-title">
              <h2>Review & resolution</h2>
            </div>
            <div className="handoff-panel-body handoff-form">
              <label>
                Assigned reviewer
                <select
                  value={s.assigned_to || ''}
                  disabled={busy || locked || (!author && data.role !== 'maintainer')}
                  onChange={(e) => void mutate('', { assignedTo: e.target.value || null }, 'PATCH')}
                >
                  <option value="">Anyone on the team</option>
                  {members
                    .filter((m) => m.role !== 'developer')
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="handoff-actions">
                {!locked && canReview && (
                  <Button
                    disabled={busy}
                    onClick={() => void mutate('/status', { status: 'IN_REVIEW' }, 'PATCH')}
                  >
                    Start review
                  </Button>
                )}
                {(author || data.role === 'maintainer' || (canReview && locked)) && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void mutate('/status', { status: locked ? 'OPEN' : 'CLOSED' }, 'PATCH')
                    }
                  >
                    {locked ? 'Reopen session' : 'Close session'}
                  </Button>
                )}
              </div>
              {latestResolution && (
                <div className="handoff-resolution">
                  <Badge tone={latestResolution.confirmed_at ? 'green' : 'amber'}>
                    {latestResolution.confirmed_at ? 'Accepted solution' : 'Proposed solution'}
                  </Badge>
                  <h3>{latestResolution.author_name}</h3>
                  <p>{latestResolution.solution}</p>
                  <h4>Why this helps</h4>
                  <p>{latestResolution.explanation}</p>
                  <a href={p.source_url} target="_blank" rel="noreferrer">
                    Original code · {p.commit_sha.slice(0, 7)}
                  </a>
                  {author && !locked && !latestResolution.confirmed_at && (
                    <Button
                      variant="primary"
                      icon={CheckCheck}
                      disabled={busy}
                      onClick={() =>
                        void mutate('/confirm-resolution', { resolutionId: latestResolution.id })
                      }
                    >
                      This solved my question
                    </Button>
                  )}
                  {latestResolution.confirmed_at && (
                    <small>
                      Confirmed by the question author on {date(latestResolution.confirmed_at)}
                    </small>
                  )}
                  {data.role === 'maintainer' &&
                    latestResolution.confirmed_at &&
                    locked &&
                    !latestResolution.approved_for_knowledge && (
                      <Button disabled={busy} onClick={() => void mutate('/approve-knowledge', {})}>
                        Approve for Team Knowledge
                      </Button>
                    )}
                  {!!latestResolution.approved_for_knowledge && (
                    <Link to="/knowledge">Published in Team Knowledge</Link>
                  )}
                </div>
              )}
              {canReview && !author && !locked && (
                <>
                  <Button onClick={() => setShowSolution(!showSolution)}>
                    {showSolution ? 'Cancel proposal' : 'Propose a solution'}
                  </Button>
                  {showSolution && (
                    <form
                      className="handoff-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = new FormData(e.currentTarget);
                        if (
                          await mutate('/resolution', {
                            solution: String(form.get('solution')),
                            explanation: String(form.get('explanation')),
                          })
                        )
                          setShowSolution(false);
                      }}
                    >
                      <label>
                        Proposed solution
                        <textarea name="solution" required maxLength={5000} rows={3} />
                      </label>
                      <label>
                        Final explanation
                        <textarea name="explanation" required maxLength={5000} rows={3} />
                      </label>
                      <Button type="submit" variant="primary" disabled={busy}>
                        Send solution for confirmation
                      </Button>
                    </form>
                  )}
                </>
              )}
              {author && !locked && (
                <p className="muted">
                  A senior or reviewer can propose a solution. You confirm whether it answers your
                  question.
                </p>
              )}
              <details>
                <summary>Session activity</summary>
                {data.activity.map((a) => (
                  <p className="handoff-activity" key={a.id}>
                    <strong>{a.actor_name}</strong> {a.event_type.replaceAll('_', ' ')}
                    <small>{date(a.created_at)}</small>
                  </p>
                ))}
              </details>
              <small>
                Code and annotations remain pinned to {p.commit_sha.slice(0, 12)}. Later repository
                changes do not move them.
              </small>
            </div>
          </aside>
        </div>
      </div>
      {workspace && (
        <small className="muted">
          <Users size={13} /> Shared with {workspace.name} only.
        </small>
      )}
    </>
  );
}
function CitationLinks({ ids, data }: { ids: string[]; data: HandoffDetail }) {
  return (
    <span className="handoff-citations">
      {ids.map((id) => {
        const ref =
          id === 'selection'
            ? {
                file: data.snapshot.file_path,
                url: data.snapshot.source_url,
                startLine: data.snapshot.start_line,
                endLine: data.snapshot.end_line,
              }
            : data.snapshot.context.references.find((r) => r.id === id);
        return ref ? (
          <a key={id} href={ref.url} target="_blank" rel="noreferrer">
            {ref.file.split('/').pop()}:L{ref.startLine}–{ref.endLine}
          </a>
        ) : null;
      })}
    </span>
  );
}
