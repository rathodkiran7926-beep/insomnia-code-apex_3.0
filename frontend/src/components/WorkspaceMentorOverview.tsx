import type { RepositorySnapshot } from '../domain/analysisTypes';

export function WorkspaceMentorOverview({
  snapshot,
  componentId,
  onSelect,
}: {
  snapshot: RepositorySnapshot;
  componentId: string;
  onSelect: (id: string) => void;
}) {
  const component = snapshot.components.find((item) => item.id === componentId);
  if (!component) return null;
  const refs = new Map(snapshot.references.map((ref) => [ref.id, ref]));
  const ref = refs.get(component.referenceId);
  const explanation = snapshot.documentation.ai.explanations.find(
    (item) => item.componentId === componentId,
  );
  const recordedSummary = component.inputs?.length
    ? `Inputs: ${component.inputs.join(', ')}. ${component.validation || ''}`
    : `${component.role.replaceAll('_', ' ')} declared in ${ref?.file.split('/').pop() || 'the analyzed source'}. ${component.validation || ''}`;
  const outgoing = snapshot.relationships.filter((edge) => edge.source === componentId);
  const incoming = snapshot.relationships.filter((edge) => edge.target === componentId);
  const unresolved = snapshot.report.unresolved.filter(
    (item) => refs.get(item.referenceId)?.file === ref?.file,
  );
  const renderLinks = (edges: typeof outgoing, direction: 'source' | 'target') =>
    edges.map((edge) => {
      const other = snapshot.components.find((item) => item.id === edge[direction]);
      const evidence = refs.get(edge.referenceId);
      return (
        <li key={edge.id}>
          <button
            disabled={!other}
            onClick={() => other && onSelect(other.id)}
            title={other ? refs.get(other.referenceId)?.file : 'Component unavailable'}
          >
            <strong>{other?.name || edge[direction]}</strong>
            <span>{edge.type.replaceAll('_', ' ')}</span>
          </button>
          {evidence && (
            <a
              href={evidence.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Source evidence for ${other?.name || edge[direction]}`}
              title={`${evidence.file}:${evidence.startLine}`}
            >
              Source
            </a>
          )}
        </li>
      );
    });
  return (
    <section className="workspace-mentor-overview" aria-label="Selected component overview">
      <header>
        <h2>{component.name}</h2>
        <span className="workspace-component-kind">{component.role.replaceAll('_', ' ')}</span>
      </header>
      <p className="workspace-overview-file" title={ref?.file}>
        {ref?.file.split('/').pop() || 'Source unavailable'}
        {ref && ` : ${ref.startLine}-${ref.endLine}`}
      </p>
      <p className="workspace-overview-description">
        {explanation?.explanation || component.evidence[0] || recordedSummary}
      </p>
      {explanation && (
        <small className="workspace-evidence-caption">Saved analysis explanation</small>
      )}
      {component.inferred && (
        <small className="workspace-evidence-caption">Component classification is inferred.</small>
      )}
      <div className="workspace-relationship-counts">
        <div>
          <strong>{outgoing.length}</strong>
          <span>Outgoing</span>
        </div>
        <div>
          <strong>{incoming.length}</strong>
          <span>Incoming</span>
        </div>
        <div>
          <strong>{unresolved.length}</strong>
          <span>Unresolved in file</span>
        </div>
      </div>
      <details className="workspace-overview-links" open>
        <summary>
          Dependencies <span>{outgoing.length}</span>
        </summary>
        {outgoing.length ? (
          <ul>{renderLinks(outgoing, 'target')}</ul>
        ) : (
          <p>No outgoing relationships resolved.</p>
        )}
      </details>
      <details className="workspace-overview-links">
        <summary>
          Callers & other incoming <span>{incoming.length}</span>
        </summary>
        {incoming.length ? (
          <ul>{renderLinks(incoming, 'source')}</ul>
        ) : (
          <p>No incoming relationships resolved.</p>
        )}
      </details>
      {unresolved.length > 0 && (
        <details className="workspace-overview-links">
          <summary>
            Unresolved in this file <span>{unresolved.length}</span>
          </summary>
          <ul>
            {unresolved.map((item, i) => (
              <li className="workspace-unresolved-item" key={i}>
                <strong>{item.text}</strong>
                <span>{item.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
