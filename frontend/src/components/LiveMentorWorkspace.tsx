import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Code2,
  Columns2,
  Download,
  FileCode2,
  GitCommitHorizontal,
  LoaderCircle,
  MessageCircle,
  Network,
  PanelLeft,
  PanelRight,
  Search,
  Send,
} from 'lucide-react';
import { Background, Controls, MarkerType, Position, ReactFlow } from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import { useRepositoryAnalysis } from '../state/RepositoryAnalysisContext';
import { analysisApi } from '../services/analysisApi';
import type { RepositorySnapshot } from '../domain/analysisTypes';
import { RepositorySource } from './RepositorySource';
import { ComponentDocumentation } from './ComponentDocumentation';
import { clearConnections, clearEdgeTypes, withConnectionBounds } from './GraphConnections';
import { directedLayout } from '../domain/graphLayout';
import '../styles/repository-source.css';
import '../styles/mentor-workspace.css';

type Reference = RepositorySnapshot['references'][number];
type Source = Omit<Reference, 'id'> & { complete?: boolean };
type Answer = {
  answer: string;
  notice: string;
  snapshotId: string;
  componentId: string;
  citations: Reference[];
};
type Turn = Answer & { question: string };

export default function LiveMentorWorkspace() {
  const { snapshot, loading, job, error } = useRepositoryAnalysis();
  if (!snapshot)
    return (
      <div className="mentor-empty">
        <Code2 size={30} />
        <h1>Your code workspace</h1>
        <p>
          Inspect components, read their connections, try local changes, and ask questions about
          your code.
        </p>
        {(loading || job?.status === 'running') && (
          <p role="status">
            <LoaderCircle className="mentor-spin" size={16} />{' '}
            {job?.message || 'Loading your analysis…'}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <Link className="mentor-primary" to="/repository">
          {job?.status === 'running' ? 'View analysis progress' : 'Analyze a repository'}{' '}
          <ArrowRight size={15} />
        </Link>
      </div>
    );
  return <CodeWorkspace key={snapshot.snapshotId} snapshot={snapshot} />;
}

function CodeWorkspace({ snapshot }: { snapshot: RepositorySnapshot }) {
  const refs = useMemo(() => new Map(snapshot.references.map((r) => [r.id, r])), [snapshot]);
  const components = useMemo(
    () => snapshot.components.filter((c) => refs.has(c.referenceId)),
    [snapshot, refs],
  );
  const [selectedId, setSelectedId] = useState(
    components.find((c) => c.role !== 'module')?.id || components[0]?.id || '',
  );
  const selected = components.find((c) => c.id === selectedId);
  const reference = selected ? refs.get(selected.referenceId) : undefined;
  const [view, setView] = useState<'code' | 'split' | 'connections'>('split');
  const [explorer, setExplorer] = useState(true);
  const [mentor, setMentor] = useState(true);
  const [search, setSearch] = useState('');
  const [fullSource, setFullSource] = useState<Source | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [asking, setAsking] = useState(false);
  const [questionError, setQuestionError] = useState('');
  const file = reference?.file || '';
  const fileReference = useMemo(
    () => snapshot.references.find((r) => r.file === file),
    [snapshot, file],
  );
  useEffect(() => {
    let cancelled = false;
    setFullSource(null);
    setSourceError('');
    setEditing(false);
    if (!fileReference) return;
    setSourceLoading(true);
    analysisApi<Source>(
      `/api/snapshots/${snapshot.snapshotId}/source?referenceId=${encodeURIComponent(fileReference.id)}`,
    )
      .then((source) => {
        if (!cancelled) {
          if (source.snapshotId !== snapshot.snapshotId || source.file !== file)
            throw new Error('Source version mismatch');
          setFullSource(source);
        }
      })
      .catch((e) => {
        if (!cancelled) setSourceError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot.snapshotId, fileReference, file]);
  useEffect(() => {
    setQuestion('');
    setQuestionError('');
  }, [selectedId]);
  const edges = snapshot.relationships.filter(
    (e) => e.source === selectedId || e.target === selectedId,
  );
  const outgoing = edges.filter((e) => e.source === selectedId);
  const incoming = edges.filter((e) => e.target === selectedId);
  const files = [...new Set(components.map((c) => refs.get(c.referenceId)!.file))].sort();
  const filteredFiles = files.filter(
    (path) =>
      path.toLowerCase().includes(search.toLowerCase()) ||
      components.some(
        (c) =>
          refs.get(c.referenceId)?.file === path &&
          c.name.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  const source = fullSource?.file === file ? fullSource : reference;
  const draft = drafts[file];
  const dirty = draft !== undefined && fullSource?.file === file && draft !== fullSource.excerpt;
  function select(id: string) {
    setSelectedId(id);
    setEditing(false);
  }
  async function ask(text: string) {
    if (!selected || asking || !text.trim()) return;
    const id = selected.id;
    setAsking(true);
    setQuestionError('');
    setQuestion('');
    try {
      const answer = await analysisApi<Answer>(`/api/snapshots/${snapshot.snapshotId}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentId: id, question: text.trim() }),
      });
      if (answer.snapshotId !== snapshot.snapshotId || answer.componentId !== id)
        throw new Error('Answer version mismatch');
      setTurns((old) => [...old, { ...answer, question: text.trim() }]);
    } catch (e) {
      setQuestionError((e as Error).message);
      setQuestion(text);
    } finally {
      setAsking(false);
    }
  }
  function downloadDraft() {
    if (!fullSource) return;
    const url = URL.createObjectURL(
      new Blob([drafts[file] ?? fullSource.excerpt], { type: 'text/plain;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.split('/').pop() || 'source.txt';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const connectionButtons = (items: typeof edges, direction: 'source' | 'target') =>
    items.length ? (
      items.map((e) => {
        const other = components.find((c) => c.id === e[direction]);
        return other ? (
          <button key={e.id} onClick={() => select(other.id)}>
            <span>{e.type.replaceAll('_', ' ')}</span>
            <strong>{other.name}</strong>
            <small>{refs.get(other.referenceId)?.file}</small>
          </button>
        ) : null;
      })
    ) : (
      <p>No connections resolved by static analysis.</p>
    );

  return (
    <div className="code-workspace" data-snapshot-id={snapshot.snapshotId}>
      <header className="code-workspace-header">
        <div>
          <Code2 size={19} />
          <strong>{snapshot.repository.replace('https://github.com/', '')}</strong>
          <span> / Mentor workspace</span>
        </div>
        <Link to="/repository">
          Architecture & documentation <ArrowRight size={14} />
        </Link>
      </header>
      <div className="code-workspace-toolbar">
        <div className="mentor-view-tabs" aria-label="Workspace view">
          {(
            [
              { id: 'code', label: 'Code', icon: Code2 },
              { id: 'split', label: 'Split', icon: Columns2 },
              { id: 'connections', label: 'Connections', icon: Network },
            ] as const
          ).map((v) => (
            <button key={v.id} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
              <v.icon size={14} />
              {v.label}
            </button>
          ))}
        </div>
        <p>Choose a component. Follow connections. Ask about the code.</p>
        <div className="mentor-layout-buttons">
          <button aria-pressed={explorer} onClick={() => setExplorer(!explorer)}>
            <PanelLeft size={15} />
            Files
          </button>
          <button aria-pressed={mentor} onClick={() => setMentor(!mentor)}>
            <PanelRight size={15} />
            Mentor
          </button>
        </div>
      </div>
      <div
        className={`code-workspace-body ${explorer ? 'has-explorer' : ''} ${mentor ? 'has-mentor' : ''}`}
      >
        {explorer && (
          <aside className="mentor-explorer">
            <div className="mentor-panel-heading">
              EXPLORER <small>{files.length} files</small>
            </div>
            <label className="mentor-search">
              <Search size={14} />
              <input
                aria-label="Search files and components"
                placeholder="Find file or component"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="mentor-file-tree">
              {filteredFiles.map((path) => {
                const children = components.filter((c) => refs.get(c.referenceId)?.file === path);
                const active = path === file;
                return (
                  <div key={path}>
                    <button
                      className={`mentor-file ${active ? 'active' : ''}`}
                      title={path}
                      onClick={() =>
                        select((children.find((c) => c.role === 'module') || children[0]).id)
                      }
                    >
                      <FileCode2 size={14} />
                      <span>{path}</span>
                      {drafts[path] !== undefined && <i title="Local draft">●</i>}
                    </button>
                    {(active || !!search) && (
                      <div className="mentor-tree-components">
                        {children
                          .filter(
                            (c) =>
                              c.role !== 'module' &&
                              (!search ||
                                path.toLowerCase().includes(search.toLowerCase()) ||
                                c.name.toLowerCase().includes(search.toLowerCase())),
                          )
                          .map((c) => (
                            <button
                              key={c.id}
                              className={selectedId === c.id ? 'active' : ''}
                              onClick={() => select(c.id)}
                              title={`${c.role} · ${c.name}`}
                            >
                              <Code2 size={12} />
                              <span>{c.name}</span>
                              <small>{c.role.replaceAll('_', ' ')}</small>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {!filteredFiles.length && <p>No matching files or components.</p>}
            </div>
            <p className="mentor-explorer-note">
              Analyzed JavaScript / TypeScript sources. Excluded files appear in the repository
              report.
            </p>
          </aside>
        )}
        <main className="mentor-editor">
          {selected ? (
            <>
              <div className="mentor-selection">
                <div>
                  <small>
                    {selected.role.replaceAll('_', ' ')}
                    {selected.inferred ? ' · inferred' : ''}
                  </small>
                  <h1>{selected.name}</h1>
                  <p>
                    {file}{' '}
                    <span>
                      {' '}
                      L{reference?.startLine}–{reference?.endLine}
                    </span>
                  </p>
                </div>
                <span className="mentor-source-badge">
                  {dirty ? 'Local draft' : 'Analyzed source'}
                </span>
              </div>
              {view !== 'code' && (
                <section className="mentor-connections">
                  <div className="mentor-section-title">
                    <Network size={15} />
                    <strong>Connected code</strong>
                    <small>{edges.length} recorded relationships</small>
                  </div>
                  {view === 'connections' ? (
                    <ConnectionMap selectedId={selectedId} snapshot={snapshot} onSelect={select} />
                  ) : (
                    <div className="mentor-flow">
                      <div>
                        <h3>
                          Used by <span>{incoming.length}</span>
                        </h3>
                        {connectionButtons(incoming, 'source')}
                      </div>
                      <div className="mentor-flow-selected">
                        <Code2 size={20} />
                        <strong>{selected.name}</strong>
                        <small>Selected component</small>
                      </div>
                      <div>
                        <h3>
                          Uses <span>{outgoing.length}</span>
                        </h3>
                        {connectionButtons(outgoing, 'target')}
                      </div>
                    </div>
                  )}
                  <p className="mentor-evidence-note">
                    Connections come from static source analysis. Dynamic behavior may be missing.
                  </p>
                </section>
              )}
              {view !== 'connections' && (
                <section className="mentor-code-section">
                  <div className="mentor-edit-toolbar">
                    <div>
                      <FileCode2 size={14} />
                      <strong>{fullSource ? 'Complete file' : 'Saved component excerpt'}</strong>
                      {sourceLoading && <LoaderCircle size={14} className="mentor-spin" />}
                    </div>
                    <div>
                      <button
                        disabled={!fullSource}
                        aria-pressed={editing}
                        onClick={() => setEditing(!editing)}
                      >
                        {editing ? 'Read source' : 'Edit local draft'}
                      </button>
                      {draft !== undefined && (
                        <button
                          onClick={() => {
                            setDrafts((old) => {
                              const next = { ...old };
                              delete next[file];
                              return next;
                            });
                            setEditing(false);
                          }}
                        >
                          Discard draft
                        </button>
                      )}
                      <button disabled={!fullSource} onClick={downloadDraft}>
                        <Download size={13} />
                        Download{dirty ? ' draft' : ' file'}
                      </button>
                    </div>
                  </div>
                  {sourceError && (
                    <div className="mentor-source-warning" role="status">
                      Complete file could not load: {sourceError} Showing the saved excerpt.{' '}
                      <a href={reference?.url} target="_blank" rel="noreferrer">
                        Open source on GitHub
                      </a>
                    </div>
                  )}
                  {editing && fullSource ? (
                    <div className="mentor-draft-editor">
                      <label htmlFor="local-source-draft">Local draft · {file}</label>
                      <p>
                        Changes stay in this browser tab. Download the file to apply them in your
                        project. Mentor answers use the analyzed source.
                      </p>
                      <textarea
                        id="local-source-draft"
                        spellCheck={false}
                        value={draft ?? fullSource.excerpt}
                        onChange={(e) => setDrafts((old) => ({ ...old, [file]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key !== 'Tab') return;
                          e.preventDefault();
                          const target = e.currentTarget;
                          const start = target.selectionStart;
                          const end = target.selectionEnd;
                          const value = target.value;
                          setDrafts((old) => ({
                            ...old,
                            [file]: value.slice(0, start) + '  ' + value.slice(end),
                          }));
                          requestAnimationFrame(() => {
                            target.selectionStart = target.selectionEnd = start + 2;
                          });
                        }}
                      />
                    </div>
                  ) : (
                    <RepositorySource
                      source={source}
                      commit={snapshot.commit}
                      focusRange={reference}
                    />
                  )}
                </section>
              )}
            </>
          ) : (
            <p>
              No source components were resolved. See the analysis report for supported patterns.
            </p>
          )}
        </main>
        {mentor && (
          <aside className="real-mentor-panel">
            <div className="mentor-panel-heading">
              <MessageCircle size={15} />
              YOUR MENTOR <span className="mentor-live-dot" />
            </div>
            {selected && (
              <>
                <ComponentDocumentation
                  defaultOpen={false}
                  key={selectedId}
                  snapshot={snapshot}
                  componentId={selectedId}
                  onInspect={select}
                />
                <div className="mentor-conversation" aria-live="polite">
                  {turns
                    .filter((t) => t.componentId === selectedId)
                    .map((t, i) => (
                      <article className="mentor-turn" key={i}>
                        <h3>{t.question}</h3>
                        <p>{t.answer}</p>
                        <small>{t.notice}</small>
                        <div className="mentor-citations">
                          {t.citations.map((c) => (
                            <a key={c.id} href={c.url} target="_blank" rel="noreferrer">
                              {c.file.split('/').pop()}:{c.startLine}–{c.endLine}
                            </a>
                          ))}
                        </div>
                      </article>
                    ))}
                  {asking && (
                    <p role="status">
                      <LoaderCircle size={14} className="mentor-spin" />
                      Reading saved source…
                    </p>
                  )}
                  {questionError && <p role="alert">{questionError}</p>}
                </div>
                <div className="mentor-question-suggestions">
                  <small>ASK ABOUT THE SELECTED CODE</small>
                  {[
                    'What does this component do?',
                    'What calls this and what does it use?',
                    'What should I check before changing this?',
                  ].map((q) => (
                    <button key={q} disabled={asking} onClick={() => void ask(q)}>
                      {q}
                      <ArrowRight size={13} />
                    </button>
                  ))}
                </div>
                <form
                  className="mentor-question-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void ask(question);
                  }}
                >
                  <label htmlFor="mentor-code-question">Ask about {selected.name}</label>
                  <div>
                    <textarea
                      id="mentor-code-question"
                      maxLength={1500}
                      placeholder="Why does this code work this way?"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                    />
                    <button aria-label="Ask mentor" disabled={asking || !question.trim()}>
                      <Send size={16} />
                    </button>
                  </div>
                  <small>Answers use this commit’s saved source. Local drafts are separate.</small>
                </form>
              </>
            )}
          </aside>
        )}
      </div>
      <footer className="mentor-status">
        <span>
          <GitCommitHorizontal size={13} />
          {snapshot.commit.slice(0, 12)} · Analyzed snapshot
        </span>
        <span>
          {Object.keys(drafts).length} local drafts · {components.length} components
        </span>
      </footer>
    </div>
  );
}

function ConnectionMap({
  selectedId,
  snapshot,
  onSelect,
}: {
  selectedId: string;
  snapshot: RepositorySnapshot;
  onSelect: (id: string) => void;
}) {
  const all = snapshot.relationships.filter(
    (e) => e.source === selectedId || e.target === selectedId,
  );
  const neighbors = [...new Set(all.flatMap((e) => [e.source, e.target]))].filter(
    (id) => id !== selectedId,
  );
  const visible = new Set([selectedId, ...neighbors.slice(0, 24)]);
  const layout = directedLayout([...visible], all, {
    width: 260,
    height: 105,
    gapX: 160,
    gapY: 55,
    maxRows: 5,
  });
  const nodes: Node[] = snapshot.components
    .filter((c) => visible.has(c.id))
    .map((c) => ({
      id: c.id,
      data: {
        label: (
          <div className="mentor-map-component">
            <strong title={c.name}>{c.role === 'module' ? c.name.split('/').pop() : c.name}</strong>
            <small>{c.role.replaceAll('_', ' ')}</small>
          </div>
        ),
      },
      position: layout.positions.get(c.id)!,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: {
        width: 260,
        height: 105,
        borderColor: c.id === selectedId ? '#7561ee' : '#ddd9eb',
        background: c.id === selectedId ? '#f2efff' : 'white',
        borderRadius: 9,
      },
    }));
  const edges: Edge[] = all
    .filter((e) => visible.has(e.source) && visible.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.type.replaceAll('_', ' '),
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#a599c6' },
    }));
  const routed = clearConnections(edges, nodes);
  return (
    <>
      <div className="mentor-connection-map">
        <ReactFlow
          key={selectedId}
          nodes={withConnectionBounds(nodes, routed)}
          edges={routed}
          edgeTypes={clearEdgeTypes}
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          onNodeClick={(_, n) => onSelect(n.id)}
          fitView
          minZoom={0.2}
          maxZoom={1.4}
          nodesDraggable={false}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {neighbors.length > 24 && (
        <p>Showing 24 nearby components. The Split view lists all recorded connections.</p>
      )}
    </>
  );
}
