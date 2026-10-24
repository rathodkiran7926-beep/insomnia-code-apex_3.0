import { useMemo, useState } from 'react';
import { Download, GitBranch, ArrowRight, ExternalLink } from 'lucide-react';
import type { RepositorySnapshot } from '../domain/analysisTypes';
import { changeImpact } from '../domain/changeImpact';
import '../styles/change-impact.css';

export function ChangeImpactExplorer({
  snapshot,
  initialComponentId,
  changedIds,
  onInspect,
}: {
  snapshot: RepositorySnapshot;
  initialComponentId?: string;
  changedIds?: string[];
  onInspect: (id: string) => void;
}) {
  const refs = useMemo(
    () =>
      new Map(
        snapshot.references
          .filter((r) => r.snapshotId === snapshot.snapshotId)
          .map((r) => [r.id, r]),
      ),
    [snapshot],
  );
  const components = useMemo(
    () => snapshot.components.filter((c) => refs.has(c.referenceId)),
    [snapshot, refs],
  );
  const [scope, setScope] = useState(changedIds ? 'changes' : 'component');
  const [selected, setSelected] = useState(initialComponentId || components[0]?.id || '');
  const [file, setFile] = useState(
    refs.get(components.find((c) => c.id === selected)?.referenceId || '')?.file || '',
  );
  const [depth, setDepth] = useState(6);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const seedIds = useMemo(
    () =>
      scope === 'changes'
        ? changedIds || []
        : scope === 'file'
          ? components.filter((c) => refs.get(c.referenceId)?.file === file).map((c) => c.id)
          : [selected],
    [scope, changedIds, components, refs, file, selected],
  );
  const impact = useMemo(() => changeImpact(snapshot, seedIds, depth), [snapshot, seedIds, depth]);
  const names = new Map(components.map((c) => [c.id, c.name]));
  const routes = impact.entries.filter((i) => i.component.role === 'route');
  const direct = impact.entries.filter((i) => i.depth === 1);
  const changedRoutes = components.filter((c) => impact.seeds.includes(c.id) && c.role === 'route');
  const shown = impact.entries.filter((item) => {
    if (filter === 'routes' && item.component.role !== 'route') return false;
    if (filter === 'direct' && item.depth !== 1) return false;
    if (filter === 'transitive' && item.depth < 2) return false;
    return `${item.component.name} ${refs.get(item.component.referenceId)?.file || ''} ${item.component.fullPaths?.join(' ') || ''}`
      .toLowerCase()
      .includes(query.toLowerCase());
  });
  function exportReport() {
    const report = {
      repository: snapshot.repository,
      commit: snapshot.commit,
      snapshotId: snapshot.snapshotId,
      maxDepth: depth,
      truncated: impact.truncated,
      seeds: impact.seeds.map((id) => ({ id, name: names.get(id) })),
      impacts: impact.entries.map((item) => ({
        ...item,
        reference: refs.get(item.component.referenceId),
        path: item.path.map((step) => ({
          ...step,
          fromName: names.get(step.from),
          toName: names.get(step.to),
          evidence: refs.get(step.edge.referenceId),
        })),
      })),
      limitations: [
        'Static potential impact, not runtime verification.',
        ...snapshot.report.limitations,
      ],
    };
    const href = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = href;
    a.download = `change-impact-${snapshot.commit.slice(0, 12)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  return (
    <section className="change-impact" aria-label="Change impact explorer">
      <header className="impact-heading">
        <div>
          <h2>
            <GitBranch size={20} /> Change impact explorer
          </h2>
          <p>Trace the callers and routes to review when this code changes.</p>
        </div>
        <button onClick={exportReport}>
          <Download size={14} /> Export impact
        </button>
      </header>
      <p className="impact-version">
        {snapshot.repository} · commit {snapshot.commit.slice(0, 12)}
      </p>
      <div className="impact-controls">
        <label>
          Change scope
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            {changedIds && <option value="changes">All changed PR components</option>}
            <option value="component">One component</option>
            <option value="file">Entire file</option>
          </select>
        </label>
        {scope === 'component' && (
          <label>
            Changed component
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {refs.get(c.referenceId)?.file}:{refs.get(c.referenceId)?.startLine}
                </option>
              ))}
            </select>
          </label>
        )}
        {scope === 'file' && (
          <label>
            Changed file
            <select value={file} onChange={(e) => setFile(e.target.value)}>
              {[...new Set(components.map((c) => refs.get(c.referenceId)!.file))]
                .sort()
                .map((path) => (
                  <option key={path}>{path}</option>
                ))}
            </select>
          </label>
        )}
        <label>
          Trace depth
          <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
            {[1, 3, 6, 10, 20].map((n) => (
              <option value={n} key={n}>
                {n} hop{n > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="impact-stats" aria-live="polite">
        {[
          [impact.seeds.length, 'changed components'],
          [direct.length, 'direct connections'],
          [impact.entries.length - direct.length, 'transitive connections'],
          [routes.length + changedRoutes.length, 'affected routes'],
        ].map(([value, label]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="impact-note">
        Potential impact from recorded static relationships. Middleware registrations include
        potentially affected routes; execution order and path matching are unverified. Dynamic calls
        and excluded source may be missing. Local draft text is not reanalyzed.
      </p>
      {impact.truncated && (
        <p role="status" className="impact-warning">
          More connections exist beyond {depth} hops. Increase trace depth to explore further.
        </p>
      )}
      {changedRoutes.length > 0 && (
        <details className="impact-note" open>
          <summary>
            {changedRoutes.length} directly changed route{changedRoutes.length > 1 ? 's' : ''}
          </summary>
          <ul>
            {changedRoutes.map((c) => (
              <li key={c.id}>
                <button onClick={() => onInspect(c.id)}>
                  {c.name} {c.fullPaths?.join(' · ')}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="impact-controls">
        <label>
          Show
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All affected components</option>
            <option value="routes">Routes only</option>
            <option value="direct">Direct connections</option>
            <option value="transitive">Transitive connections</option>
          </select>
        </label>
        <label>
          Search results
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, route, or file"
          />
        </label>
      </div>
      <p role="status">
        {shown.length} of {impact.entries.length} affected components shown
      </p>
      <div className="impact-results">
        {shown.map((item) => {
          const c = item.component,
            ref = refs.get(c.referenceId)!;
          return (
            <article className="impact-result" key={c.id}>
              <div className="impact-result-title">
                <button onClick={() => onInspect(c.id)}>{c.name}</button>
                <span>
                  {c.role.replaceAll('_', ' ')} · {item.depth} hop{item.depth > 1 ? 's' : ''}
                </span>
              </div>
              {c.role === 'route' && c.fullPaths?.length ? (
                <p className="impact-route-path">{c.fullPaths.join(' · ')}</p>
              ) : null}
              <a href={ref.url} target="_blank" rel="noreferrer">
                {ref.file}:{ref.startLine} <ExternalLink size={12} />
              </a>
              <details>
                <summary>
                  Why is this affected? One shortest path from {names.get(item.seed)}
                </summary>
                <ol className="impact-path">
                  {item.path.map((step, i) => {
                    const evidence = refs.get(step.edge.referenceId)!;
                    return (
                      <li key={i}>
                        <div>
                          <button onClick={() => onInspect(step.from)}>
                            {names.get(step.from)}
                          </button>
                          <ArrowRight size={13} />
                          <button onClick={() => onInspect(step.to)}>{names.get(step.to)}</button>
                        </div>
                        <a href={evidence.url} target="_blank" rel="noreferrer">
                          {names.get(step.edge.source)} → {names.get(step.edge.target)}:{' '}
                          {step.edge.type.replaceAll('_', ' ')} · {evidence.file}:
                          {evidence.startLine}
                        </a>
                      </li>
                    );
                  })}
                </ol>
              </details>
            </article>
          );
        })}
      </div>
      {!shown.length && (
        <p className="impact-empty">
          {!impact.seeds.length
            ? 'No analyzed changed components in this version. Select a component or file to explore.'
            : impact.entries.length
              ? 'No results match these filters.'
              : 'No affected callers or routes resolved at this depth. Review unresolved calls and analysis limits before concluding the change is isolated.'}
        </p>
      )}
      {snapshot.report.unresolved.length > 0 && (
        <details className="impact-note">
          <summary>
            {snapshot.report.unresolved.length} unresolved source relationships may limit coverage
          </summary>
          <p>See the repository report for the complete unresolved list and excluded files.</p>
        </details>
      )}
    </section>
  );
}
