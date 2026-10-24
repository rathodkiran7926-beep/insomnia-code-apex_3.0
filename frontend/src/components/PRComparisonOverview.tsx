import { ArrowRight, ArrowUpRight, Code2, FileCode2, GitBranch, Info } from 'lucide-react';
import type { Result, Component, Changed } from './PullRequestChanges';
import type { RepositorySnapshot } from '../domain/analysisTypes';
import '../styles/pr-overview.css';
type Side = 'before' | 'after';
type Props = {
  result: Result;
  snapshots: Record<Side, RepositorySnapshot>;
  version: Side;
  onVersion: (side: Side) => void;
  onInspect: (side: Side, id: string) => void;
  onFileDiff: (path: string) => void;
  onImpact: () => void;
};
const fileName = (path: string) => path.split('/').at(-1) || path;
const fileRoles = new Set(['module', 'router', 'application']);
export function PRComparisonOverview({
  result,
  snapshots,
  version,
  onVersion,
  onInspect,
  onFileDiff,
  onImpact,
}: Props) {
  const symbols = result.components.filter(
    (change) => (change.after || change.before)?.role !== 'module',
  );
  const groups = new Map<string, Changed[]>();
  for (const file of result.pr.files) if (!file.hidden) groups.set(file.path, []);
  for (const change of symbols.slice(0, 100)) {
    const file = (change.after || change.before)?.reference.file;
    if (!file) continue;
    if (!groups.has(file)) groups.set(file, []);
    groups.get(file)!.push(change);
  }
  const dependents = result.impact[version].filter((item) => !fileRoles.has(item.role));
  const supporting = result.impact[version].filter((item) => fileRoles.has(item.role));
  function name(item: Component, side: Side) {
    const stored =
      snapshots[side].components.find((component) => component.id === item.id)?.name || item.name;
    return item.role === 'module' ? fileName(item.reference.file) : stored;
  }
  function dependent(item: (typeof result.impact.after)[number]) {
    return (
      <button
        className="pr-review-dependent"
        key={item.id}
        onClick={() => onInspect(version, item.id)}
        title={item.reference.file + ':' + item.reference.startLine}
      >
        <span className="pr-review-symbol-icon">
          <Code2 size={15} />
        </span>
        <span className="pr-review-dependent-copy">
          <strong>{name(item, version)}</strong>
          <span>
            {fileName(item.reference.file)}:{item.reference.startLine}
          </span>
          <small>
            {item.depth} {item.depth === 1 ? 'connection' : 'connections'} away &middot;{' '}
            {item.via.replaceAll('_', ' ')}
          </small>
        </span>
        <ArrowUpRight size={15} />
      </button>
    );
  }
  return (
    <div className="pr-review-overview">
      <div className="pr-stats pr-review-stats">
        <div>
          <span>Files changed</span>
          <strong>{result.pr.files.length}</strong>
          <small>Captured in this comparison</small>
        </div>
        <div>
          <span>Symbols changed</span>
          <strong>{symbols.length}</strong>
          <small>Functions, routes and other code symbols</small>
        </div>
        <div>
          <span>Connection changes</span>
          <strong>{result.edges.added.length + result.edges.removed.length}</strong>
          <small>
            <span className="pr-review-additions">+{result.edges.added.length} added</span>
            <span>&minus;{result.edges.removed.length} removed</span>
          </small>
        </div>
      </div>
      <div className="pr-review-columns">
        <section className="pr-card pr-review-source">
          <header className="pr-review-section-heading">
            <div>
              <h2>
                <FileCode2 size={17} />
                Source changes
              </h2>
              <p>Choose a version to inspect its code with the mentor.</p>
            </div>
            <button onClick={() => onFileDiff(result.pr.files[0]?.path || '')}>
              View diff <ArrowRight size={13} />
            </button>
          </header>
          <div className="pr-review-file-list">
            {[...groups].map(([path, changes]) => {
              const file = result.pr.files.find((item) => item.path === path);
              const directory = path.split('/').slice(0, -1).join('/');
              return (
                <section className="pr-review-file" key={path}>
                  <header>
                    <FileCode2 size={17} />
                    <div>
                      <h3 title={path}>{fileName(path)}</h3>
                      <p title={directory}>{directory || 'Repository root'}</p>
                    </div>
                    <span className={'pr-status ' + (file?.status || 'modified')}>
                      {file?.status || 'modified'}
                    </span>
                  </header>
                  <div className="pr-review-symbols">
                    {changes.map((change, index) => {
                      const item = change.after || change.before!;
                      return (
                        <div className="pr-review-symbol" key={item.id + ':' + index}>
                          <span className="pr-review-symbol-icon">
                            <Code2 size={15} />
                          </span>
                          <div className="pr-review-symbol-copy">
                            <strong>{name(item, change.after ? 'after' : 'before')}</strong>
                            <small>
                              {item.role.replaceAll('_', ' ')}
                              <span> &middot; </span>
                              <span className={'pr-review-change ' + change.status}>
                                {change.status}
                              </span>
                              {change.ambiguous && (
                                <span title="The source analyzer could not establish a unique identity across versions">
                                  {' '}
                                  Match needs review
                                </span>
                              )}
                            </small>
                          </div>
                          <div className="pr-review-version-actions">
                            {(['before', 'after'] as const).map((side) => {
                              const component = change[side];
                              return component ? (
                                <button
                                  key={side}
                                  onClick={() => onInspect(side, component.id)}
                                  title={
                                    'Inspect ' +
                                    side +
                                    ' version at line ' +
                                    component.reference.startLine
                                  }
                                >
                                  {side === 'before' ? 'Before' : 'After'}
                                  <ArrowUpRight size={12} />
                                </button>
                              ) : (
                                <span key={side} className="pr-review-no-version">
                                  &mdash;
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {!changes.length && (
                      <p className="pr-review-file-note">
                        File-level change. Open the diff to review the edited lines.
                      </p>
                    )}
                  </div>
                  <footer>
                    <span className="pr-review-file-counts">
                      {file && (
                        <>
                          <span className="pr-review-additions">+{file.additions}</span>
                          <span>&minus;{file.deletions}</span>
                        </>
                      )}
                    </span>
                    <button onClick={() => onFileDiff(path)}>
                      View file diff <ArrowRight size={12} />
                    </button>
                  </footer>
                </section>
              );
            })}
            {!groups.size && (
              <p>No source files were available. Review the comparison's coverage details.</p>
            )}
            {symbols.length > 100 && (
              <p className="pr-review-file-note">
                Showing the first 100 symbol changes. Export evidence for the full list.
              </p>
            )}
          </div>
        </section>
        <aside className="pr-card pr-review-impact">
          <header className="pr-review-section-heading">
            <div>
              <h2>
                <GitBranch size={17} />
                Potential impact
              </h2>
              <p>Connected code to review before merging.</p>
            </div>
          </header>
          <div className="pr-version-tabs" aria-label="Overview impact source version">
            {(['before', 'after'] as const).map((side) => (
              <button key={side} aria-pressed={version === side} onClick={() => onVersion(side)}>
                {side === 'before' ? 'Before PR' : 'After PR'}
              </button>
            ))}
          </div>
          <div className="pr-review-impact-heading">
            <strong>
              {dependents.length} {dependents.length === 1 ? 'dependent' : 'dependents'} to review
            </strong>
            <button onClick={onImpact}>
              Explore impact <ArrowUpRight size={13} />
            </button>
          </div>
          <div className="pr-review-dependents">{dependents.slice(0, 8).map(dependent)}</div>
          {!dependents.length && (
            <p className="pr-review-empty">
              No additional callable dependents were resolved for this version. Dynamic callers may
              be missing.
            </p>
          )}
          {dependents.length > 8 && (
            <button className="pr-review-more" onClick={onImpact}>
              View all {dependents.length} dependents <ArrowRight size={13} />
            </button>
          )}
          {supporting.length > 0 && (
            <details className="pr-review-supporting">
              <summary>
                Supporting file & routing links <span>{supporting.length}</span>
              </summary>
              {supporting.slice(0, 50).map(dependent)}
              {supporting.length > 50 && <button onClick={onImpact}>View remaining links</button>}
            </details>
          )}
          <p className="pr-review-notice">
            <Info size={15} />
            <span>
              Static source relationships suggest places to review. They do not prove a runtime
              failure.
            </span>
          </p>
        </aside>
      </div>
    </div>
  );
}
