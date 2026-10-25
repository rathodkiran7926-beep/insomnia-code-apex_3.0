import { useEffect, useMemo, useState } from 'react';
import {
  Code2,
  Columns2,
  FileCode2,
  Folder,
  Network,
  PanelLeft,
  Search,
  Target,
} from 'lucide-react';
import {
  handoffApi,
  type HandoffDetail,
  type SharedRepository,
  type SharedRepositorySource,
} from '../services/handoffApi';
import { workspaceFileTree, type WorkspaceFolder } from '../domain/workspaceLayout';
import { RepositorySource } from './RepositorySource';
import { WorkspaceConnectionMap } from './WorkspaceConnectionMap';
import { BackendArchitecture } from './BackendArchitecture';
import { Button } from './UI';

type Range = { startLine: number; endLine: number };
export function HandoffRepositoryBrowser({
  data,
  annotationLines,
  annotationRange,
  onAnnotate,
}: {
  data: HandoffDetail;
  annotationLines: number[];
  annotationRange: Range | null;
  onAnnotate: (start: number, end: number) => void;
}) {
  const p = data.snapshot;
  const [repo, setRepo] = useState<SharedRepository | null>(null),
    [error, setError] = useState('');
  const [file, setFile] = useState(p.file_path),
    [componentId, setComponentId] = useState(p.component_id || '');
  const [focus, setFocus] = useState<Range>({ startLine: p.start_line, endLine: p.end_line });
  const [source, setSource] = useState<SharedRepositorySource | null>(null),
    [loading, setLoading] = useState(true),
    [sourceError, setSourceError] = useState('');
  const [query, setQuery] = useState(''),
    [explorer, setExplorer] = useState(true);
  const [mode, setMode] = useState<'code' | 'split' | 'architecture'>('code');
  const [diagram, setDiagram] = useState<'component' | 'system' | 'request' | 'services'>(
    'component',
  );
  useEffect(() => {
    let cancelled = false;
    handoffApi<SharedRepository>(`/api/handoffs/${data.session.id}/repository`)
      .then((r) => {
        if (r.graph.commit !== p.commit_sha || r.graph.snapshotId !== p.analysis_snapshot_id)
          throw new Error('Shared repository version mismatch.');
        if (!cancelled) {
          setRepo(r);
          setError('');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [data.session.id, p.commit_sha, p.analysis_snapshot_id]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSource(null);
    setSourceError('');
    handoffApi<SharedRepositorySource>(
      `/api/handoffs/${data.session.id}/repository/source?path=${encodeURIComponent(file)}`,
    )
      .then((r) => {
        if (r.commit !== p.commit_sha || r.file !== file)
          throw new Error('Shared file version mismatch.');
        if (!cancelled) setSource(r);
      })
      .catch((e) => {
        if (!cancelled) setSourceError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data.session.id, p.commit_sha, file]);
  const refs = useMemo(() => new Map(repo?.graph.references.map((r) => [r.id, r]) || []), [repo]);
  const components = repo?.graph.components || [];
  const paths = (repo?.files.map((f) => f.path) || [p.file_path]).filter(
    (path) =>
      path.toLowerCase().includes(query.toLowerCase()) ||
      components.some(
        (c) =>
          refs.get(c.referenceId)?.file === path &&
          c.name.toLowerCase().includes(query.toLowerCase()),
      ),
  );
  const tree = workspaceFileTree(paths);
  function selectComponent(id: string) {
    const component = components.find((c) => c.id === id),
      ref = component && refs.get(component.referenceId);
    if (!ref) return;
    setComponentId(id);
    setFile(ref.file);
    setFocus({ startLine: ref.startLine, endLine: ref.endLine });
    if (mode === 'architecture') setMode('split');
  }
  function selectFile(path: string) {
    setFile(path);
    const component =
      components.find((c) => refs.get(c.referenceId)?.file === path && c.role === 'module') ||
      components.find((c) => refs.get(c.referenceId)?.file === path);
    setComponentId(component?.id || '');
    const ref = component && refs.get(component.referenceId);
    setFocus(
      path === p.file_path
        ? { startLine: p.start_line, endLine: p.end_line }
        : { startLine: ref?.startLine || 1, endLine: ref?.endLine || 1 },
    );
  }
  const fallback =
    file === p.file_path
      ? {
          file,
          excerpt: p.source_code,
          startLine: p.start_line,
          endLine: p.end_line,
          url: p.source_url,
          complete: false,
        }
      : undefined;
  return (
    <section className="handoff-panel handoff-repository" aria-label="Shared repository workspace">
      <div className="handoff-repository-toolbar">
        <div className="handoff-actions">
          <button
            aria-label="Toggle shared file explorer"
            aria-pressed={explorer}
            onClick={() => setExplorer(!explorer)}
          >
            <PanelLeft size={15} />
            Files
          </button>
          <h2>Shared code workspace</h2>
        </div>
        <div className="handoff-workspace-tabs" aria-label="Shared workspace view">
          {(
            [
              { id: 'code', label: 'Code', icon: Code2 },
              { id: 'split', label: 'Split', icon: Columns2 },
              { id: 'architecture', label: 'Architecture', icon: Network },
            ] as const
          ).map((v) => (
            <button key={v.id} aria-pressed={mode === v.id} onClick={() => setMode(v.id)}>
              <v.icon size={14} />
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div className="handoff-repository-meta">
        <span>
          {repo?.files.length ?? '…'} saved files · Commit {p.commit_sha.slice(0, 12)}
        </span>
        <Button
          icon={Target}
          variant="ghost"
          onClick={() => {
            selectFile(p.file_path);
            setComponentId(p.component_id || '');
            setMode('code');
          }}
        >
          Original shared selection · L{p.start_line}–{p.end_line}
        </Button>
      </div>
      {error && (
        <p role="alert" className="handoff-error">
          {error}
        </p>
      )}
      <div className={`handoff-repository-body ${explorer ? 'with-explorer' : ''}`}>
        {explorer && (
          <aside className="handoff-file-explorer" aria-label="Shared repository explorer">
            <div className="handoff-explorer-title">
              EXPLORER <small>{repo?.files.length ?? 0} files</small>
            </div>
            <label className="handoff-explorer-search">
              <Search size={14} />
              <input
                aria-label="Find shared file or component"
                placeholder="Find file or component"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="handoff-file-tree">
              <Folders
                tree={tree}
                selectedFile={file}
                searching={!!query}
                renderFiles={(paths) =>
                  paths.map((path) => (
                    <div key={path}>
                      <button
                        className={`handoff-tree-file ${path === file ? 'active' : ''}`}
                        title={path}
                        onClick={() => selectFile(path)}
                      >
                        <FileCode2 size={14} />
                        <span>{path.split('/').pop()}</span>
                        {path === p.file_path && (
                          <small title="File containing the shared selection">●</small>
                        )}
                      </button>
                      {(file === path || !!query) && (
                        <div className="handoff-tree-components">
                          {components
                            .filter(
                              (c) =>
                                c.role !== 'module' &&
                                refs.get(c.referenceId)?.file === path &&
                                (!query ||
                                  path.toLowerCase().includes(query.toLowerCase()) ||
                                  c.name.toLowerCase().includes(query.toLowerCase())),
                            )
                            .map((c) => (
                              <button
                                key={c.id}
                                className={c.id === componentId ? 'active' : ''}
                                onClick={() => selectComponent(c.id)}
                                title={c.name}
                              >
                                <Code2 size={12} />
                                <span>{c.name}</span>
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  ))
                }
              />
              {!paths.length && <p>No matching files or components.</p>}
            </div>
          </aside>
        )}
        <div className="handoff-repository-main">
          {mode !== 'code' && (
            <section className="handoff-shared-diagram" aria-label="Shared architecture diagram">
              <div className="handoff-diagram-toolbar">
                <strong>Architecture · same saved commit</strong>
                <label>
                  Diagram
                  <select
                    aria-label="Shared architecture diagram type"
                    value={diagram}
                    onChange={(e) => setDiagram(e.target.value as typeof diagram)}
                  >
                    <option value="component">Component connections</option>
                    <option value="system">Backend architecture</option>
                    <option value="request">Request flow</option>
                    <option value="services">Services & logic</option>
                  </select>
                </label>
              </div>
              {repo ? (
                diagram === 'component' ? (
                  <WorkspaceConnectionMap
                    selectedId={componentId}
                    snapshot={repo.graph}
                    onSelect={selectComponent}
                  />
                ) : (
                  <BackendArchitecture
                    snapshot={repo.graph}
                    mode={diagram}
                    onInspect={selectComponent}
                    onModeChange={(next) => {
                      if (['system', 'request', 'services'].includes(next))
                        setDiagram(next as typeof diagram);
                      else {
                        setExplorer(true);
                        setMode('code');
                      }
                    }}
                  />
                )
              ) : (
                <p role="status">Loading saved architecture…</p>
              )}
              <small>
                Arrows show analyzed code relationships. Dynamic calls and runtime order may be
                missing.
              </small>
            </section>
          )}
          {mode !== 'architecture' && (
            <div className="handoff-shared-source">
              {loading && (
                <p role="status" className="handoff-note">
                  Loading the complete saved file…
                </p>
              )}
              {sourceError && (
                <p role="status" className="handoff-note">
                  {sourceError}
                </p>
              )}
              {source?.file === file && source.redacted && (
                <p className="handoff-note">
                  Potential credential values were omitted; original line numbers are preserved.
                </p>
              )}
              <div className="handoff-selection-legend">
                <span className="handoff-shared-marker" />
                {file === p.file_path
                  ? 'Purple lines are the developer’s original shared selection.'
                  : 'Highlighted lines show the component you are inspecting.'}
                {file !== p.file_path && (
                  <span> Original question: {p.file_path.split('/').pop()}</span>
                )}
              </div>
              <RepositorySource
                ideTarget={repo?.graph}
                source={source?.file === file ? source : fallback}
                commit={p.commit_sha}
                focusRange={
                  file === p.file_path ? { startLine: p.start_line, endLine: p.end_line } : focus
                }
                annotationLines={file === p.file_path ? annotationLines : []}
                secondaryRange={file === p.file_path ? annotationRange || focus : undefined}
                navigationRange={focus}
                onLineSelect={(line, extend) => {
                  setFocus((old) => ({
                    startLine: extend ? Math.min(old.startLine, line) : line,
                    endLine: extend ? Math.max(old.startLine, line) : line,
                  }));
                  if (file === p.file_path && line >= p.start_line && line <= p.end_line) {
                    const start =
                      extend && annotationRange ? Math.min(annotationRange.startLine, line) : line;
                    const end =
                      extend && annotationRange ? Math.max(annotationRange.startLine, line) : line;
                    onAnnotate(start, end);
                  }
                }}
              />
              {file !== p.file_path && (
                <small className="handoff-note">
                  You can explore this file freely. Line annotations stay attached to the original
                  shared selection; discuss other code in a normal reply.
                </small>
              )}
            </div>
          )}
        </div>
      </div>
      {repo && (
        <details className="handoff-repository-coverage">
          <summary>
            Shared source coverage · {repo.coverage.capturedFiles}/{repo.coverage.analyzedFiles}{' '}
            analyzed files
          </summary>
          <p>{repo.coverage.note}</p>
          {repo.coverage.unavailable.length > 0 && (
            <p>Full files unavailable: {repo.coverage.unavailable.join(', ')}</p>
          )}
        </details>
      )}
    </section>
  );
}
function Folders({
  tree,
  selectedFile,
  searching,
  renderFiles,
}: {
  tree: WorkspaceFolder;
  selectedFile: string;
  searching: boolean;
  renderFiles: (paths: string[]) => React.ReactNode;
}) {
  return (
    <>
      {tree.folders.map((folder) => (
        <details
          key={`${folder.path}:${selectedFile.startsWith(folder.path + '/')}:${searching}`}
          open={searching || selectedFile.startsWith(folder.path + '/') || undefined}
          className="handoff-tree-folder"
        >
          <summary>
            <Folder size={13} />
            {folder.name}
          </summary>
          <Folders
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
