import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Code2,
  Columns2,
  Download,
  FileCode2,
  Folder,
  Braces,
  LoaderCircle,
  MessageCircle,
  Mic,
  Network,
  PanelLeft,
  PanelRight,
  Search,
  Send,
} from 'lucide-react';
import { useRepositoryAnalysis } from '../state/RepositoryAnalysisContext';
import { analysisApi } from '../services/analysisApi';
import type { RepositorySnapshot } from '../domain/analysisTypes';
import { RepositorySource } from './RepositorySource';
import { ComponentDocumentation } from './ComponentDocumentation';
import { ComponentDiscussion } from './ComponentDiscussion';
import { WorkspaceConnectionMap as ConnectionMap } from './WorkspaceConnectionMap';
import { WorkspaceMentorOverview } from './WorkspaceMentorOverview';
import { WorkspaceOptions } from './WorkspaceOptions';
import { WorkspaceSplitter } from './WorkspaceSplitter';
import { ChangeImpactExplorer } from './ChangeImpactExplorer';
import { Modal } from './UI';
import { CreateHandoffModal } from './CreateHandoffModal';
import { RelatedTeamKnowledge } from './RelatedTeamKnowledge';
import {
  automaticWorkspaceMode,
  componentForCitation,
  automaticGraphShare,
  workspaceFileTree,
  type WorkspaceFolder,
  type WorkspaceMode,
} from '../domain/workspaceLayout';
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
  const [searchParams] = useSearchParams();
  const refs = useMemo(() => new Map(snapshot.references.map((r) => [r.id, r])), [snapshot]);
  const components = useMemo(
    () => snapshot.components.filter((c) => refs.has(c.referenceId)),
    [snapshot, refs],
  );
  const [selectedId, setSelectedId] = useState(
    components.find((c) => c.id === searchParams.get('component'))?.id ||
      components.find((c) => c.role !== 'module')?.id ||
      components[0]?.id ||
      '',
  );
  const selected = components.find((c) => c.id === selectedId);
  const [citation, setCitation] = useState<Reference | null>(null);
  const reference = citation || (selected ? refs.get(selected.referenceId) : undefined);
  const [manualMode, setManualMode] = useState<WorkspaceMode | null>(null);
  const [explorerWidth, setExplorerWidth] = useState(240);
  const [mentorWidth, setMentorWidth] = useState(320);
  const [manualGraphShare, setManualGraphShare] = useState<number | null>(null);
  const [selectionDetailsOpen, setSelectionDetailsOpen] = useState(false);
  const [impactOpen, setImpactOpen] = useState(false);
  const [sourceCollapsed, setSourceCollapsed] = useState(false);
  const [explorer, setExplorer] = useState(true);
  const [mentor, setMentor] = useState(
    () => searchParams.get('discuss') === '1' || window.innerWidth >= 1280,
  );
  const [discussing, setDiscussing] = useState(searchParams.get('discuss') === '1');
  const [centeredConversation, setCenteredConversation] = useState(false);
  const [search, setSearch] = useState('');
  const [fullSource, setFullSource] = useState<Source | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffRange, setHandoffRange] = useState<{ startLine: number; endLine: number } | null>(
    null,
  );
  useEffect(() => {
    setHandoffRange(null);
  }, [reference?.id, selectedId]);
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
  const view = manualMode || automaticWorkspaceMode(edges.length);
  const graphShare =
    manualGraphShare ?? (view === 'connections' ? 55 : automaticGraphShare(edges.length));
  const changeView = (mode: WorkspaceMode) => {
    setManualMode(mode);
    setSourceCollapsed(false);
    setManualGraphShare(null);
  };
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
    setCitation(null);
    setEditing(false);
  }
  useEffect(() => {
    if (searchParams.get('discuss') === '1') {
      setMentor(true);
      setDiscussing(true);
    }
    const id = searchParams.get('component');
    if (id && components.some((component) => component.id === id)) {
      setSelectedId(id);
      setCitation(null);
    }
  }, [searchParams, components]);
  function inspectCitation(next: Reference) {
    const componentId = componentForCitation(components, snapshot.references, next, selectedId);
    if (componentId) setSelectedId(componentId);
    if (view === 'connections') changeView('split');
    setCitation(next);
    setSourceCollapsed(false);
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
  return (
    <div
      className="code-workspace"
      data-snapshot-id={snapshot.snapshotId}
      data-mode={view}
      style={
        {
          '--explorer-width': `${explorerWidth}px`,
          '--mentor-width': `${mentorWidth}px`,
          '--graph-share': `${graphShare}%`,
        } as CSSProperties
      }
    >
      <div className="code-workspace-toolbar">
        <div className="workspace-toolbar-left mentor-layout-buttons">
          <button
            aria-controls="workspace-files"
            aria-pressed={explorer}
            onClick={() => setExplorer(!explorer)}
          >
            <PanelLeft size={15} />
            Files
          </button>
          <WorkspaceOptions
            automatic={manualMode === null && manualGraphShare === null}
            onAuto={() => {
              setManualMode(null);
              setManualGraphShare(null);
              setSourceCollapsed(false);
            }}
            onReset={() => {
              setExplorerWidth(240);
              setMentorWidth(320);
              setManualGraphShare(null);
            }}
          />
        </div>
        <div className="mentor-view-tabs" aria-label="Workspace view">
          {(
            [
              { id: 'code', label: 'Code Focus', icon: Code2 },
              { id: 'split', label: 'Split Focus', icon: Columns2 },
              { id: 'connections', label: 'Architecture Focus', icon: Network },
            ] as const
          ).map((v) => (
            <button key={v.id} aria-pressed={view === v.id} onClick={() => changeView(v.id)}>
              <v.icon size={14} />
              {v.label}
            </button>
          ))}
        </div>
        <div className="mentor-layout-buttons">
          <Link
            className="button button-ghost"
            to="/learn"
            title="Explore paths from this repository's analyzed source"
          >
            CodeJourney
          </Link>
          <button
            className="mentor-voice-launch"
            aria-label="Discuss this component"
            title="Open voice and text discussion about the selected component"
            disabled={!selected}
            aria-pressed={discussing && mentor}
            onClick={() => {
              setMentor(true);
              setDiscussing(true);
              setCenteredConversation(false);
            }}
          >
            <Mic size={17} />
            Voice & text
          </button>
          <button
            aria-controls="workspace-mentor"
            aria-pressed={mentor && !discussing}
            title={discussing ? 'Return to text mentor' : 'Show or hide text mentor'}
            onClick={() => {
              setCenteredConversation(false);
              setDiscussing(false);
              setMentor(discussing || !mentor);
            }}
          >
            <PanelRight size={15} />
            Mentor
          </button>
        </div>
      </div>
      <div
        className={`code-workspace-body ${explorer ? 'has-explorer' : ''} ${mentor && !centeredConversation ? 'has-mentor' : ''} ${discussing ? 'has-discussion' : ''}`}
      >
        {explorer && (
          <aside id="workspace-files" className="mentor-explorer" aria-label="File explorer">
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
              <WorkspaceFolders
                tree={workspaceFileTree(filteredFiles)}
                selectedFile={file}
                searching={!!search}
                renderFiles={(paths) => (
                  <>
                    {paths.map((path) => {
                      const children = components.filter(
                        (c) => refs.get(c.referenceId)?.file === path,
                      );
                      const active = path === file;
                      return (
                        <div key={path}>
                          <button
                            className={`mentor-file ${active ? 'active' : ''}`}
                            aria-current={active ? 'true' : undefined}
                            title={path}
                            onClick={() =>
                              select((children.find((c) => c.role === 'module') || children[0]).id)
                            }
                          >
                            <FileCode2 size={14} />
                            <span>{path.split('/').pop()}</span>
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
                                    aria-current={selectedId === c.id ? 'true' : undefined}
                                    onClick={() => select(c.id)}
                                    title={`${c.role} · ${c.name}`}
                                  >
                                    <Braces size={12} />
                                    <span>{c.name}</span>
                                    <small>{c.role.replaceAll('_', ' ')}</small>
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              />
              {!filteredFiles.length && <p>No matching files or components.</p>}
            </div>
            <p className="mentor-explorer-note">
              Analyzed JavaScript / TypeScript sources. Excluded files appear in the repository
              report.
            </p>
          </aside>
        )}
        {explorer && (
          <WorkspaceSplitter
            label="File explorer width"
            controls="workspace-files"
            value={explorerWidth}
            min={160}
            max={360}
            onChange={setExplorerWidth}
            onCollapse={() => {
              setExplorer(false);
              document
                .querySelector<HTMLButtonElement>('[aria-controls="workspace-files"]')
                ?.focus();
            }}
          />
        )}
        <section className="mentor-editor" aria-label="Selected component workspace">
          {selected ? (
            <>
              <div className="mentor-selection compact-selection">
                <div className="workspace-component-command-row">
                  <div className="mentor-selection-summary">
                    <Code2 size={14} aria-hidden="true" />
                    <h1 title={selected.name}>{selected.name}</h1>
                    <span className="selection-filename" title={file}>
                      {file.split('/').pop()}
                    </span>
                    {dirty && (
                      <span className="selection-draft-status" role="status">
                        Local draft
                      </span>
                    )}
                    <button
                      className="selection-details-toggle"
                      aria-expanded={selectionDetailsOpen}
                      aria-controls="workspace-selection-details"
                      onClick={() => setSelectionDetailsOpen(!selectionDetailsOpen)}
                    >
                      {selectionDetailsOpen ? 'Less details' : 'Details'}
                    </button>
                    <button
                      className="selection-details-toggle"
                      onClick={() => setImpactOpen(true)}
                    >
                      Change impact
                    </button>
                  </div>
                  {view !== 'connections' && (!sourceCollapsed || view === 'code') && (
                    <div className="mentor-edit-toolbar combined-source-toolbar">
                      {view === 'code' && (
                        <div className="workspace-connections-summary">
                          <Network size={14} />
                          <span>
                            {incoming.length} callers / {outgoing.length} dependencies
                          </span>
                          <button onClick={() => changeView('split')}>Explore connections</button>
                        </div>
                      )}
                      {sourceLoading && (
                        <div
                          className="workspace-source-status"
                          role="status"
                          aria-label="Loading source"
                        >
                          <LoaderCircle size={14} className="mentor-spin" />
                        </div>
                      )}
                      <div className="workspace-source-actions">
                        <button
                          disabled={!fullSource || !reference || editing}
                          onClick={() => setHandoffOpen(true)}
                          title="Share a pinned code question with a teammate"
                        >
                          <MessageCircle size={14} /> Create Handoff Snapshot
                        </button>
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
                  )}
                </div>
                {selectionDetailsOpen && (
                  <div id="workspace-selection-details" className="mentor-selection-details">
                    <span>
                      {selected.role.replaceAll('_', ' ')}
                      {selected.inferred ? ' / inferred' : ''}
                    </span>
                    <p>
                      {file}{' '}
                      <span>
                        L{reference?.startLine}-{reference?.endLine}
                      </span>
                    </p>
                    <span>
                      {dirty ? 'Local draft' : 'Analyzed source'} / Commit{' '}
                      {snapshot.commit.slice(0, 12)}
                    </span>
                  </div>
                )}
              </div>
              <div
                className={`mentor-workbench ${sourceCollapsed || view === 'connections' ? 'source-collapsed' : ''}`}
              >
                {view !== 'code' && (
                  <section
                    id="workspace-graph"
                    className="mentor-connections"
                    aria-label="Architecture connections"
                  >
                    <div className="mentor-section-title">
                      <Network size={15} />
                      <strong>Component connections</strong>
                      <small>
                        {edges.length} source-linked /{' '}
                        {
                          snapshot.report.unresolved.filter(
                            (item) => refs.get(item.referenceId)?.file === file,
                          ).length
                        }{' '}
                        unresolved in file
                      </small>
                    </div>
                    <div className="workspace-graph-legend" aria-label="Graph layout">
                      <span>Callers</span>
                      <span>Selected component</span>
                      <span>Dependencies</span>
                    </div>
                    <ConnectionMap
                      key={view}
                      selectedId={selectedId}
                      snapshot={snapshot}
                      onSelect={select}
                    />
                  </section>
                )}
                {view === 'split' && !sourceCollapsed && (
                  <WorkspaceSplitter
                    label="Graph height"
                    controls="workspace-graph"
                    value={graphShare}
                    min={20}
                    max={75}
                    horizontal
                    onChange={(share) => {
                      setManualGraphShare(share);
                      setManualMode(view);
                    }}
                    onCollapse={() => {
                      changeView('code');
                      document
                        .querySelector<HTMLButtonElement>('.mentor-view-tabs button')
                        ?.focus();
                    }}
                  />
                )}
                {view !== 'connections' && (!sourceCollapsed || view === 'code') && (
                  <section
                    id="workspace-source"
                    className="mentor-code-section"
                    aria-label="Source code"
                  >
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
                        />
                      </div>
                    ) : (
                      <RepositorySource
                        source={source}
                        commit={snapshot.commit}
                        focusRange={handoffRange || reference}
                        onLineSelect={(line, extend) =>
                          setHandoffRange((old) =>
                            extend && old
                              ? {
                                  startLine: Math.min(old.startLine, line),
                                  endLine: Math.max(old.startLine, line),
                                }
                              : { startLine: line, endLine: line },
                          )
                        }
                      />
                    )}
                  </section>
                )}
              </div>
            </>
          ) : (
            <p>
              No source components were resolved. See the analysis report for supported patterns.
            </p>
          )}
        </section>
        {mentor && !centeredConversation && (
          <WorkspaceSplitter
            label="Mentor width"
            controls="workspace-mentor"
            value={mentorWidth}
            min={260}
            max={520}
            reverse
            onChange={setMentorWidth}
            onCollapse={() => {
              setMentor(false);
              document
                .querySelector<HTMLButtonElement>('[aria-controls="workspace-mentor"]')
                ?.focus();
            }}
          />
        )}
        {mentor && (
          <aside
            id="workspace-mentor"
            aria-label="Mentor"
            className={`real-mentor-panel ${centeredConversation ? 'conversation-centered' : ''}`}
          >
            {discussing ? (
              <ComponentDiscussion
                snapshot={snapshot}
                componentId={selectedId}
                centered={centeredConversation}
                onCenteredChange={setCenteredConversation}
              />
            ) : (
              <>
                <div className="mentor-panel-heading">
                  <MessageCircle size={15} />
                  YOUR MENTOR <span className="mentor-live-dot" />
                </div>
                {selected && (
                  <>
                    <div className="workspace-mentor-content">
                      <RelatedTeamKnowledge
                        snapshotId={snapshot.snapshotId}
                        referenceId={selected.referenceId}
                        repository={snapshot.repository}
                      />
                      <WorkspaceMentorOverview
                        snapshot={snapshot}
                        componentId={selectedId}
                        onSelect={select}
                      />
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
                                  <button
                                    key={c.id}
                                    title={c.file}
                                    onClick={() => inspectCitation(c)}
                                  >
                                    {c.file.split('/').pop()}:{c.startLine}-{c.endLine}
                                  </button>
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
                        {['Explain Code', 'Explore Dependencies', 'What Could Break?'].map((q) => (
                          <button
                            key={q}
                            disabled={asking}
                            onClick={() =>
                              void ask(
                                {
                                  'Explain Code':
                                    'Explain this component using its source references.',
                                  'Explore Dependencies':
                                    'What calls this component and which dependencies does it use?',
                                  'What Could Break?':
                                    'What could break if I change this component, and what should I verify?',
                                }[q] || q,
                              )
                            }
                          >
                            {q}
                            <ArrowRight size={13} />
                          </button>
                        ))}
                      </div>
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
                      <small>
                        Answers use this commit’s saved source. Local drafts are separate.
                      </small>
                    </form>
                  </>
                )}
              </>
            )}
          </aside>
        )}
      </div>
      {fullSource && reference && (
        <CreateHandoffModal
          open={handoffOpen}
          onOpenChange={setHandoffOpen}
          snapshot={snapshot}
          source={fullSource}
          referenceId={reference.id}
          selection={
            handoffRange || {
              startLine: reference.startLine,
              endLine: Math.min(reference.endLine, reference.startLine + 299),
            }
          }
        />
      )}
      <Modal
        open={impactOpen}
        onOpenChange={setImpactOpen}
        title="Explore change impact"
        description="Find callers and HTTP routes connected to the code you plan to change."
        className="impact-dialog"
      >
        {impactOpen && (
          <ChangeImpactExplorer
            snapshot={snapshot}
            initialComponentId={selectedId}
            onInspect={(id) => {
              select(id);
              setImpactOpen(false);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function WorkspaceFolders({
  tree,
  selectedFile,
  searching,
  renderFiles,
}: {
  tree: WorkspaceFolder;
  selectedFile: string;
  searching: boolean;
  renderFiles: (paths: string[]) => ReactNode;
}) {
  return (
    <>
      {tree.folders.map((folder) => (
        <details
          className="workspace-folder"
          key={`${folder.path}-${searching}-${selectedFile.startsWith(folder.path + '/')}`}
          open={searching || selectedFile.startsWith(folder.path + '/') || undefined}
        >
          <summary title={folder.path}>
            <Folder size={13} aria-hidden="true" /> {folder.name}
          </summary>
          <WorkspaceFolders
            tree={folder}
            selectedFile={selectedFile}
            searching={searching}
            renderFiles={renderFiles}
          />
        </details>
      ))}
      {renderFiles(tree.files)}
    </>
  );
}
