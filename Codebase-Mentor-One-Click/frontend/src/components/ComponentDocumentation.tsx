import { BookOpen, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useGeneratedGuide } from '../services/generatedGuides';
import { GeneratedGuide } from './GeneratedGuide';
import type { RepositorySnapshot } from '../domain/analysisTypes';
import '../styles/component-documentation.css';

export function ComponentDocumentation({
  snapshot,
  componentId,
  onInspect,
  defaultOpen = true,
}: {
  snapshot: RepositorySnapshot;
  componentId: string;
  onInspect: (id: string) => void;
  defaultOpen?: boolean;
}) {
  const component = snapshot.components.find((c) => c.id === componentId);
  const [opened, setOpened] = useState(defaultOpen);
  const generated = useGeneratedGuide(
    { snapshotId: snapshot.snapshotId, componentId },
    opened && !!component,
  );
  if (!component) return null;
  const reference = snapshot.references.find(
    (r) => r.id === component.referenceId && r.snapshotId === snapshot.snapshotId,
  );
  const explanation = snapshot.documentation.ai.explanations.find(
    (e) => e.componentId === componentId,
  );
  const connections = snapshot.relationships.filter(
    (e) => e.source === componentId || e.target === componentId,
  );
  const incoming = connections.filter((e) => e.target === componentId);
  const outgoing = connections.filter((e) => e.source === componentId);
  const relationNames: Record<string, string> = {
    imports: 'Imports',
    calls: 'Calls',
    registers_route: 'Registers route',
    handles_route: 'Handles via',
    mounts_router: 'Mounts router',
    uses_middleware: 'Uses middleware',
    queries_database: 'Queries',
  };
  function relationshipList(items: typeof connections, direction: 'source' | 'target') {
    if (!items.length)
      return <p>No {direction === 'source' ? 'incoming' : 'outgoing'} connections resolved.</p>;
    return (
      <ul>
        {items.map((edge) => {
          const other = snapshot.components.find((c) => c.id === edge[direction]);
          const evidence = snapshot.references.find(
            (r) => r.id === edge.referenceId && r.snapshotId === snapshot.snapshotId,
          );
          return (
            <li key={edge.id}>
              <span>
                {direction === 'source'
                  ? `${edge.type.replaceAll('_', ' ')} from`
                  : relationNames[edge.type] || edge.type.replaceAll('_', ' ')}
              </span>
              <button onClick={() => other && onInspect(other.id)} disabled={!other}>
                {other?.name || 'Unresolved component'}
              </button>
              {evidence && (
                <a
                  href={evidence.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Source for ${edge.type} relationship`}
                  title={`${evidence.file}:${evidence.startLine}–${evidence.endLine}`}
                >
                  <ExternalLink size={11} />
                </a>
              )}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <details
      className="component-documentation"
      open={opened}
      onToggle={(e) => setOpened(e.currentTarget.open)}
      key={componentId}
      data-component-id={componentId}
      data-snapshot-id={snapshot.snapshotId}
    >
      <summary>
        <BookOpen size={15} />
        <span>Component documentation</span>
        <small>{component.role.replaceAll('_', ' ')}</small>
      </summary>
      <div className="component-documentation-body">
        <GeneratedGuide {...generated} />
        <details className="component-recorded-facts" open={!generated.guide}>
          <summary>Recorded source facts</summary>
          <section>
            <h3>What this component does</h3>
            <p>
              {explanation?.explanation ||
                (component.evidence.length
                  ? component.evidence.join('. ')
                  : `The analyzer identified ${component.name} as a ${component.role.replaceAll('_', ' ')}. Its business purpose has not been determined.`)}
            </p>
            {explanation && (
              <small className="component-doc-inference">
                AI explanation · check against the source
              </small>
            )}
          </section>
          {reference && (
            <a
              className="component-doc-source"
              href={reference.url}
              target="_blank"
              rel="noreferrer"
            >
              <span>
                {reference.file}:{reference.startLine}–{reference.endLine}
              </span>
              <ExternalLink size={12} />
            </a>
          )}
          <section>
            <h3>Inputs & output</h3>
            <dl>
              <div>
                <dt>Parameters</dt>
                <dd>
                  {component.inputs === undefined
                    ? 'Not determined from source'
                    : component.inputs.length
                      ? component.inputs.join(', ')
                      : 'No declared parameters'}
                </dd>
              </div>
              <div>
                <dt>Returns</dt>
                <dd>{component.output || 'Not determined from source'}</dd>
              </div>
            </dl>
          </section>
          {component.fullPaths?.length ? (
            <section>
              <h3>Mounted route paths</h3>
              <ul className="component-doc-paths">
                {component.fullPaths.map((path) => (
                  <li key={path}>
                    <code>{path}</code>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <h3>Validation & error handling</h3>
            <p>{component.validation || 'Not determined from the available source evidence.'}</p>
          </section>
          <details className="component-doc-connections">
            <summary>
              Used by <span>{incoming.length}</span>
            </summary>
            {relationshipList(incoming, 'source')}
          </details>
          <details className="component-doc-connections">
            <summary>
              Uses <span>{outgoing.length}</span>
            </summary>
            {relationshipList(outgoing, 'target')}
          </details>
          <section className="component-doc-change">
            <h3>Before changing this code</h3>
            <p>
              Review{' '}
              {incoming.length
                ? `the ${incoming.length} recorded incoming connections`
                : 'potential callers, including any unresolved dynamic references'}
              , preserve the input/output contract, and check validation and error behavior. Run
              relevant project tests after applying a change.
            </p>
          </section>
          <footer>
            Based on commit {snapshot.commit.slice(0, 12)}. Static analysis does not verify runtime
            behavior.
          </footer>
        </details>
      </div>
    </details>
  );
}
