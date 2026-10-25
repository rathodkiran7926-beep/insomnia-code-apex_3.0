import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRepositoryAnalysis } from '../state/RepositoryAnalysisContext';
import { analysisApi } from '../services/analysisApi';
import { directedLayout } from '../domain/graphLayout';
import {
  clearConnections,
  clearEdgeTypes,
  withConnectionBounds,
} from '../components/GraphConnections';
import { Background, Controls, Position, ReactFlow, MarkerType } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import { Badge } from '../components/UI';
import { RepositoryDocumentation } from '../components/RepositoryDocumentation';
import { RepositoryFileSource } from '../components/RepositoryFileSource';
import { ComponentDocumentation } from '../components/ComponentDocumentation';
import { ResizableAnalysisLayout } from '../components/ResizableAnalysisLayout';
import { BackendArchitecture } from '../components/BackendArchitecture';
import { AnalysisProgress } from '../components/AnalysisProgress';
import {
  ArrowRight,
  CheckCircle2,
  Code2,
  FileCode2,
  FolderOpen,
  GitBranch,
  ChevronDown,
  LoaderCircle,
  Network,
  Search,
  X,
} from 'lucide-react';
import '../styles/repository-analysis.css';
import '../styles/repository-source.css';
import '../styles/live-workspace.css';

type Component = {
  id: string;
  name: string;
  role: string;
  inferred: boolean;
  evidence: string[];
  referenceId: string;
  inputs?: string[];
  output?: string;
  validation: string;
  fullPaths?: string[];
};
const colors: Record<string, string> = {
  route: '#dff5e9',
  handler: '#e5edff',
  service: '#efe6ff',
  middleware: '#fff0cf',
  router: '#dff4f5',
  application: '#dff4f5',
  database_client: '#ffe8db',
  database_operation: '#ffe8db',
};
const roleLabels: Record<string, string> = {
  all: 'All components',
  application: 'Application',
  router: 'Router',
  route: 'HTTP route',
  handler: 'Request handler',
  service: 'Service (inferred)',
  middleware: 'Middleware',
  function: 'Function',
  class: 'Class',
  database_client: 'Database client',
  database_operation: 'Database operation',
  unresolved: 'Unresolved calls',
};
const relationshipLabels: Record<string, string> = {
  imports: 'imports',
  registers_route: 'registers route',
  handles_route: 'handled by',
  calls: 'calls',
  mounts_router: 'mounts router',
  uses_middleware: 'uses middleware',
  queries_database: 'queries database',
};
function FolderGroup({ data }: { data: { label?: string } }) {
  return (
    <div className="analysis-folder-label">
      <FolderOpen size={15} />
      {data.label}
    </div>
  );
}
const analysisNodeTypes = { folderGroup: FolderGroup };
export default function Repository() {
  const [routeParams] = useSearchParams();
  const {
    snapshot,
    job,
    loading,
    error: analysisError,
    setActiveJob,
    repositoryUrl: url,
    setRepositoryUrl: setUrl,
  } = useRepositoryAnalysis();
  const [revision, setRevision] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  const [folder, setFolder] = useState('all');
  const [showUnresolved, setShowUnresolved] = useState(false);
  const [view, setView] = useState('system');
  const [tab, setTab] = useState(routeParams.get('tab') === 'documentation' ? 'documentation' : 'architecture');
  useEffect(() => { setTab(routeParams.get('tab') === 'documentation' ? 'documentation' : 'architecture'); }, [routeParams]);
  const [selected, setSelected] = useState('');
  const busy = starting || loading || job?.status === 'running';
  useEffect(() => {
    if (snapshot) {
      setView('system');
    }
  }, [snapshot]);
  async function start() {
    setStarting(true);
    setError('');
    try {
      const result = await analysisApi<{ id: string }>('/api/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          ...(revision.trim() ? { revision: revision.trim() } : {}),
        }),
      });
      setSelected('');
      setFolder('all');
      setQuery('');
      setRole('all');
      setTab('architecture');
      setActiveJob(result.id, revision);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  const source = (id: string) => snapshot?.references.find((r) => r.id === id);
  const sourceLink = (id: string) => {
    const r = source(id);
    return (
      r && (
        <a href={r.url} target="_blank" rel="noreferrer">
          {r.file}:{r.startLine}–{r.endLine} ↗
        </a>
      )
    );
  };
  const graph = useMemo(() => {
    if (!snapshot) return { nodes: [], edges: [] };
    const refs = new Map(snapshot.references.map((r) => [r.id, r]));
    const folderOf = (c: Component) =>
      refs.get(c.referenceId)?.file.split('/').slice(0, -1).join('/') || '(root)';
    if (view === 'overview') {
      const folders = [...new Set(snapshot.components.map(folderOf))];
      const nodes: Node[] = folders
        .map((folder, i) => ({
          id: `folder:${folder}`,
          data: {
            label: (
              <div className="analysis-folder-node">
                <FolderOpen size={21} />
                <strong>{folder}</strong>
                <span>
                  {snapshot.components.filter((c) => folderOf(c) === folder).length} components{' '}
                  <ArrowRight size={13} />
                </span>
              </div>
            ),
            searchText: folder,
          },
          position: { x: (i % 4) * 280, y: Math.floor(i / 4) * 150 },
          style: { background: '#efedfc', width: 240, whiteSpace: 'pre-wrap' },
        }))
        .filter((n) => String(n.data.searchText).toLowerCase().includes(query.toLowerCase()));
      const ids = new Set(nodes.map((n) => n.id));
      const edgeMap = new Map<string, Edge>();
      for (const e of snapshot.relationships) {
        const from = snapshot.components.find((c) => c.id === e.source)!;
        const to = snapshot.components.find((c) => c.id === e.target)!;
        if (!from || !to) continue;
        const s = `folder:${folderOf(from)}`,
          t = `folder:${folderOf(to)}`;
        if (s !== t && ids.has(s) && ids.has(t))
          edgeMap.set(`${s}|${t}|${e.type}`, {
            id: `${s}|${t}|${e.type}`,
            source: s,
            target: t,
            label: relationshipLabels[e.type] || e.type,
            type: 'smoothstep',
          });
      }
      const edges = [...edgeMap.values()];
      const layout = directedLayout(
        nodes.map((n) => n.id),
        edges,
        { width: 240, height: 110, gapX: 155, gapY: 60, maxRows: 5 },
      );
      const arranged = nodes.map((n) => ({
        ...n,
        position: layout.positions.get(n.id)!,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: { ...n.style, height: 110 },
      }));
      const routed = clearConnections(
        edges.map((e) => ({ ...e, markerEnd: { type: MarkerType.ArrowClosed, color: '#a293b7' } })),
        arranged,
      );
      return { nodes: withConnectionBounds(arranged, routed), edges: routed };
    }
    const visible = snapshot.components.filter(
      (c) =>
        c.role !== 'module' &&
        (folder === 'all' || folderOf(c) === folder) &&
        (role === 'all' || c.role === role) &&
        `${c.name} ${refs.get(c.referenceId)?.file}`.toLowerCase().includes(query.toLowerCase()),
    );
    const folders = [...new Set(visible.map(folderOf))];
    const nodes: Node[] = [];
    let offset = 0;
    for (const folder of folders) {
      const members = visible.filter((c) => folderOf(c) === folder),
        groupId = `group:${folder}`;
      const layout = directedLayout(
        members.map((c) => c.id),
        snapshot.relationships,
        { width: 250, height: 122, gapX: 140, gapY: 58, maxRows: 6 },
      );
      nodes.push({
        id: groupId,
        type: 'folderGroup',
        data: { label: folder },
        position: { x: 0, y: offset },
        style: {
          width: layout.width + 40,
          height: layout.height + 90,
          background: '#f8f9fc',
        },
        selectable: false,
      });
      members.forEach((c) =>
        nodes.push({
          id: c.id,
          parentId: groupId,
          extent: 'parent',
          position: {
            x: layout.positions.get(c.id)!.x + 20,
            y: layout.positions.get(c.id)!.y + 54,
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: {
            label: (
              <div className="analysis-component-node">
                <span className="analysis-node-role">{roleLabels[c.role] || c.role}</span>
                <strong title={c.name}>{c.name}</strong>
                <span className="analysis-node-file" title={refs.get(c.referenceId)?.file}>
                  <FileCode2 size={12} />
                  {refs.get(c.referenceId)?.file.split('/').pop()}:
                  {refs.get(c.referenceId)?.startLine}
                </span>
              </div>
            ),
          },
          style: {
            width: 250,
            height: 122,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            background: colors[c.role] || 'white',
            border: `${c.inferred ? '2px dashed' : '1px solid'} ${c.id === selected ? '#5855d9' : '#bcc7d9'}`,
          },
        }),
      );
      offset += layout.height + 150;
    }
    const ids = new Set(nodes.map((n) => n.id));
    const edges: Edge[] = snapshot.relationships
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: `${relationshipLabels[e.type] || e.type}${e.mountPath ? ` ${e.mountPath}` : ''}`,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#a293b7' },
        style: {
          stroke: '#a293b7',
          opacity: selected && e.source !== selected && e.target !== selected ? 0.22 : 1,
        },
      }));
    if ((role === 'all' && showUnresolved) || role === 'unresolved')
      snapshot.report.unresolved
        .filter((u) => u.kind === 'call')
        .slice(0, 30)
        .forEach((u, i) => {
          const r = refs.get(u.referenceId);
          const caller = snapshot.components
            .filter((c) => c.role !== 'module' && ids.has(c.id))
            .filter((c) => {
              const cr = refs.get(c.referenceId);
              return (
                cr?.file === r?.file && cr!.startLine <= r!.startLine && cr!.endLine >= r!.endLine
              );
            })
            .sort(
              (a, b) =>
                refs.get(a.referenceId)!.endLine -
                refs.get(a.referenceId)!.startLine -
                (refs.get(b.referenceId)!.endLine - refs.get(b.referenceId)!.startLine),
            )[0];
          if (!caller && role !== 'unresolved') return;
          const id = `unresolved:${i}`;
          nodes.push({
            id,
            data: { label: `${u.text}\nunresolved target` },
            position: { x: 950 + (i % 2) * 240, y: Math.floor(i / 2) * 100 },
            style: { width: 220, background: '#fff1e8', border: '1px dashed #c97e39' },
          });
          if (caller)
            edges.push({
              id: `unknown:${i}`,
              source: caller.id,
              target: id,
              label: 'unresolved call',
              style: { stroke: '#c97e39', strokeDasharray: '5 5' },
            });
        });
    const routed = clearConnections(edges, nodes).map((e) => ({
      ...e,
      label: selected
        ? e.source === selected || e.target === selected
          ? e.label
          : undefined
        : edges.length > 12
          ? undefined
          : e.label,
    }));
    return { nodes: withConnectionBounds(nodes, routed), edges: routed };
  }, [snapshot, view, role, query, selected, showUnresolved, folder]);
  const component = snapshot?.components.find((c) => c.id === selected);
  function inspectComponent(id: string) {
    const c = snapshot?.components.find((c) => c.id === id);
    const ref = snapshot?.references.find((r) => r.id === c?.referenceId);
    setTab('architecture');
    setView('detail');
    setRole('all');
    setQuery('');
    setFolder(ref?.file.split('/').slice(0, -1).join('/') || '(root)');
    setSelected(id);
  }
  return (
    <>
      {
        <section className="panel analysis-connect">
          <div className="analysis-connect-heading">
            <span className="analysis-section-icon">
              <GitBranch size={20} />
            </span>
            <div>
              <h2>Connect your codebase</h2>
              <p>
                Analyze a public repository, then open its architecture and source in your mentor
                workspace.
              </p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <label>
              Public GitHub repository
              <span className="repository-url-field">
                <GitBranch size={16} />
                <input
                  aria-label="Public GitHub repository"
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/owner/repository"
                  disabled={busy}
                />
              </span>
            </label>
            <details className="repository-revision">
              <summary>
                <span>
                  <small>VERSION</small>
                  {revision || 'Default branch'}
                </span>
                <ChevronDown size={14} />
              </summary>
              <label>
                Choose a branch, tag or commit
                <input
                  aria-label="Revision"
                  value={revision}
                  onChange={(e) => setRevision(e.target.value)}
                  placeholder="Branch, tag, or commit"
                  disabled={busy}
                />
              </label>
            </details>
            <button className="analysis-primary" disabled={busy} type="submit">
              {busy ? (
                <LoaderCircle size={16} className="analysis-button-spinner" />
              ) : (
                <Network size={16} />
              )}
              {busy ? 'Analyzing…' : 'Analyze repository'}
            </button>
          </form>
          <div className="repository-form-footer">
            <span>
              <CheckCircle2 size={13} />
              Public GitHub repositories
            </span>
            <span>JavaScript + TypeScript</span>
            <details>
              <summary>Support & limits</summary>
              <p>
                Node.js + Express analysis. Up to 200 eligible files / 5 MB. Dependencies, generated
                output and sensitive paths are excluded. Repository code is never executed.
              </p>
            </details>
          </div>
          {(error || analysisError) && (
            <div className="error-callout" role="alert">
              {error || analysisError}
            </div>
          )}
        </section>
      }
      {busy && (
        <AnalysisProgress
          progress={starting ? 0 : job?.progress || 0}
          message={job?.message || 'Starting analysis'}
        />
      )}
      {!snapshot && !busy && (
        <div className="panel analysis-empty">
          <div className="analysis-empty-icon">
            <Network size={30} />
          </div>
          <h2>Your repository map starts here</h2>
          <p>
            Enter a public repository to discover supported routes, handlers, imports and calls.
            Unsupported patterns will appear in the analysis report.
          </p>
        </div>
      )}
      {snapshot && (
        <>
          <div className="analysis-snapshot" data-snapshot-id={snapshot.snapshotId}>
            <span className="analysis-ready">
              <CheckCircle2 size={15} /> Analysis ready
            </span>
            <strong>{snapshot.repository.replace('https://github.com/', '')}</strong>
            <span title="Use this snapshot ID to connect the Codebase Mentor VS Code extension">
              Snapshot ID: <code>{snapshot.snapshotId}</code>{' '}
              <button
                type="button"
                title="Copy snapshot ID for VS Code"
                aria-label="Copy snapshot ID for VS Code"
                onClick={() => {
                  if (!navigator.clipboard?.writeText) {
                    setError('Clipboard access is unavailable; select and copy the displayed snapshot ID.');
                    return;
                  }
                  void navigator.clipboard.writeText(snapshot.snapshotId).catch(() => {
                    setError('Clipboard access is unavailable; select and copy the displayed snapshot ID.');
                  });
                }}
              >
                Copy ID
              </button>
            </span>
            <a
              href={`${snapshot.repository}/tree/${snapshot.commit}`}
              target="_blank"
              rel="noreferrer"
            >
              Commit {snapshot.commit.slice(0, 12)} ↗
            </a>
            <span>{snapshot.report.languages.join(' / ')}</span>
            {
              <Link className="analysis-open-workspace" to="/workspace">
                Open mentor workspace <ArrowRight size={15} />
              </Link>
            }
          </div>
          <div className="analysis-summary-grid">
            {[
              {
                label: 'HTTP routes',
                value: snapshot.components.filter((c) => c.role === 'route').length,
                detail: 'Supported request entry points',
              },
              {
                label: 'Components',
                value: snapshot.components.filter((c) => c.role !== 'module').length,
                detail: 'Functions, handlers and other declarations',
              },
              {
                label: 'Connections',
                value: snapshot.relationships.length,
                detail: 'Relationships backed by source',
              },
              {
                label: 'Needs inspection',
                value: snapshot.report.unresolved.length,
                detail: 'Calls and patterns not fully resolved',
              },
            ].map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value.toLocaleString()}</strong>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>
          {!snapshot.report.supported && (
            <div className="error-callout" role="status">
              No supported Express construction was confirmed in source. General symbols remain
              available; Express route coverage is unavailable.
            </div>
          )}
          <div className="analysis-tabs" role="tablist" aria-label="Analysis views">
            {['architecture', 'documentation', 'report'].map((t) => (
              <button
                key={t}
                role="tab"
                data-view={t}
                aria-selected={tab === t}
                onClick={() => setTab(t)}
              >
                {t === 'architecture' ? (
                  <Network size={15} />
                ) : t === 'documentation' ? (
                  <FileCode2 size={15} />
                ) : (
                  <Search size={15} />
                )}
                {t === 'report' ? 'Coverage & limitations' : t}
              </button>
            ))}
          </div>
          {tab === 'architecture' && (
            <>
              <div
                className="system-view-switcher"
                role="group"
                aria-label="Architecture diagram type"
              >
                {[
                  { id: 'system', label: 'Backend system' },
                  { id: 'request', label: 'Request diagram' },
                  { id: 'services', label: 'Services & data' },
                  { id: 'overview', label: 'Source folders' },
                ].map((item) => (
                  <button
                    key={item.id}
                    data-diagram={item.id}
                    aria-pressed={view === item.id || (item.id === 'overview' && view === 'detail')}
                    onClick={() => {
                      setView(item.id);
                      setSelected('');
                      setQuery('');
                      setRole('all');
                      setFolder('all');
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {view === 'system' || view === 'request' || view === 'services' ? (
                <BackendArchitecture
                  key={snapshot.snapshotId}
                  snapshot={snapshot}
                  mode={view}
                  onInspect={inspectComponent}
                  onModeChange={setView}
                />
              ) : (
                <>
                  <div className="analysis-map-heading">
                    <div>
                      <h2>
                        {view === 'overview'
                          ? 'Start with the big picture'
                          : 'Explore the code connections'}
                      </h2>
                      <p>
                        {view === 'overview'
                          ? 'Each folder is a module. Select one to see its components and source.'
                          : 'Select a component to understand its role, source and connections. Scroll to zoom; drag the canvas to move.'}
                      </p>
                    </div>
                    {(query || role !== 'all' || folder !== 'all') && (
                      <button
                        className="analysis-reset"
                        onClick={() => {
                          setQuery('');
                          setRole('all');
                          setFolder('all');
                          setSelected('');
                        }}
                      >
                        <X size={14} /> Clear filters
                      </button>
                    )}
                  </div>
                  <div className="analysis-toolbar">
                    <label>
                      Search
                      <span className="analysis-filter-search">
                        <Search size={14} />
                        <input
                          aria-label="Search components"
                          placeholder="Component or source file"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </span>
                    </label>
                    <label>
                      View
                      <select value={view} onChange={(e) => setView(e.target.value)}>
                        <option value="detail">Component details</option>
                        <option value="overview">Folder overview</option>
                      </select>
                    </label>
                    <label>
                      Component role
                      <select
                        aria-label="Component role"
                        value={role}
                        disabled={view === 'overview'}
                        onChange={(e) => setRole(e.target.value)}
                      >
                        {[
                          'all',
                          ...new Set(
                            snapshot.components.map((c) => c.role).filter((r) => r !== 'module'),
                          ),
                          'unresolved',
                        ].map((r) => (
                          <option key={r} value={r}>
                            {roleLabels[r] || r}
                          </option>
                        ))}
                      </select>
                    </label>
                    {view === 'detail' && (
                      <label>
                        Folder
                        <select
                          aria-label="Filter by folder"
                          value={folder}
                          onChange={(e) => {
                            setFolder(e.target.value);
                            setSelected('');
                          }}
                        >
                          <option value="all">All folders</option>
                          {[
                            ...new Set(
                              snapshot.references.map(
                                (r) => r.file.split('/').slice(0, -1).join('/') || '(root)',
                              ),
                            ),
                          ]
                            .sort()
                            .map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <details className="analysis-diagram-options">
                    <summary>
                      Diagram details{showUnresolved ? ' · unresolved calls visible' : ''}
                    </summary>
                    <div className="analysis-map-legend">
                      <span>
                        <i />
                        Source-backed connection
                      </span>
                      <span>
                        <i className="inferred" />
                        Inferred role
                      </span>
                      <span>
                        <i className="unresolved" />
                        Unresolved call
                      </span>
                      <small>Static code map · not a runtime trace</small>
                    </div>
                    {view === 'detail' && (
                      <label className="analysis-unresolved-toggle">
                        <input
                          type="checkbox"
                          checked={showUnresolved}
                          onChange={(e) => setShowUnresolved(e.target.checked)}
                        />{' '}
                        Show unresolved call targets (
                        {snapshot.report.unresolved.filter((u) => u.kind === 'call').length})
                      </label>
                    )}
                  </details>
                  <ResizableAnalysisLayout enabled={Boolean(component)}>
                    <div className="analysis-canvas">
                      {graph.nodes.length ? (
                        <ReactFlow
                          key={`${snapshot.snapshotId}:${view}:${showUnresolved}:${role}:${folder}:${query}`}
                          nodeTypes={analysisNodeTypes}
                          edgeTypes={clearEdgeTypes}
                          fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
                          nodes={graph.nodes}
                          edges={graph.edges}
                          fitView
                          minZoom={0.05}
                          maxZoom={2}
                          onNodeClick={(_e, node) => {
                            if (node.id.startsWith('folder:')) {
                              setFolder(node.id.slice(7));
                              setQuery('');
                              setRole('all');
                              setSelected('');
                              setView('detail');
                            } else if (node.id.startsWith('unresolved:')) setTab('report');
                            else setSelected(node.id);
                          }}
                          nodesDraggable={false}
                        >
                          <Background />
                          <Controls showInteractive={false} />
                        </ReactFlow>
                      ) : (
                        <div className="analysis-empty">No components match these filters.</div>
                      )}
                    </div>
                    <aside className="panel analysis-details" key={selected || 'empty'}>
                      {component ? (
                        <>
                          <div className="analysis-detail-heading">
                            <span className="analysis-kicker">COMPONENT DETAILS</span>
                            <button
                              aria-label="Close component details"
                              onClick={() => setSelected('')}
                            >
                              <X size={17} />
                            </button>
                          </div>
                          <h2>{component.name}</h2>
                          <Badge>
                            {roleLabels[component.role] || component.role}
                            {component.inferred ? ' · inferred' : ''}
                          </Badge>
                          <Link
                            className="component-discuss-link"
                            to={`/workspace?component=${encodeURIComponent(component.id)}&discuss=1`}
                          >
                            Discuss this component <ArrowRight size={13} />
                          </Link>
                          <p className="analysis-component-description">
                            {component.evidence.join('. ') ||
                              `A ${component.role} declaration found in the source. Open the code below to inspect its implementation.`}
                          </p>
                          <RepositoryFileSource
                            repository={snapshot.repository}
                            key={component.referenceId}
                            source={source(component.referenceId)}
                            commit={snapshot.commit}
                            snapshotId={snapshot.snapshotId}
                          />
                          <ComponentDocumentation
                            snapshot={snapshot}
                            componentId={component.id}
                            onInspect={inspectComponent}
                          />
                        </>
                      ) : (
                        <>
                          <div className="analysis-empty-icon">
                            <Code2 size={27} />
                          </div>
                          <h2>Get to know a component</h2>
                          <p>
                            Choose a component to inspect its source, role, connections and
                            generated documentation.
                          </p>
                          <ol className="analysis-inspect-steps">
                            <li>Open a folder or choose a role.</li>
                            <li>Select a component in the diagram.</li>
                            <li>Read its purpose and follow the source links.</li>
                          </ol>
                        </>
                      )}
                    </aside>
                  </ResizableAnalysisLayout>
                </>
              )}
            </>
          )}
          {tab === 'documentation' && (
            <RepositoryDocumentation
              key={snapshot.snapshotId}
              snapshot={snapshot}
              onInspect={inspectComponent}
            />
          )}
          {tab === 'report' && (
            <section className="panel analysis-report">
              <h2>Analysis coverage</h2>
              <p>{snapshot.report.frameworks.join(', ') || 'No supported framework confirmed'}</p>
              <h3>Supported patterns</h3>
              <ul>
                {snapshot.report.patterns.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <h3>Limitations</h3>
              <ul>
                {snapshot.report.limitations.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <h3>Excluded files ({snapshot.report.exclusions.length})</h3>
              {snapshot.report.exclusions.map((e, i) => (
                <p key={i}>
                  <code>{e.path}</code> — {e.reason}
                </p>
              ))}
              <h3>Unresolved items ({snapshot.report.unresolved.length})</h3>
              {snapshot.report.unresolved.map((u, i) => (
                <div className="analysis-relationship" key={i}>
                  <strong>
                    {u.kind}: {u.text}
                  </strong>
                  <p>{u.reason}</p>
                  {sourceLink(u.referenceId)}
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}
