import { validateEvidence, type Component, type SnapshotEvidence } from './mentorContracts';

export interface RepositoryEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  referenceId: string;
  certainty?: string;
  inferred?: boolean;
}
export interface RepositoryGraph extends SnapshotEvidence {
  relationships: RepositoryEdge[];
  limitations: string[];
}

/** Validate the *whole* existing snapshot graph, not a one-hop selection.
 * No inference, graph traversal or source parsing is performed by the extension.
 */
export function validateRepositoryGraph(value: unknown, expectedSnapshot: string): RepositoryGraph {
  const evidence = validateEvidence(value, expectedSnapshot);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid repository architecture response.');
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.relationships) || data.relationships.length > 50000) throw new Error('Repository architecture is too large for this view.');
  const components = new Set(evidence.components.map(c => c.id));
  const refs = new Set(evidence.references.map(r => r.id));
  const seen = new Set<string>();
  const id = (v: unknown, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f]/.test(v);
  const relationships = data.relationships.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid repository relationship.');
    const e = raw as Record<string, unknown>;
    if (!id(e.id) || !id(e.source) || !id(e.target) || !id(e.type, 80) || !id(e.referenceId) ||
      !components.has(e.source as string) || !components.has(e.target as string) || !refs.has(e.referenceId as string) || seen.has(e.id as string)) {
      throw new Error('Repository graph contains a missing or cross-snapshot relationship reference.');
    }
    if (e.certainty !== undefined && !id(e.certainty, 80) || e.inferred !== undefined && typeof e.inferred !== 'boolean') {
      throw new Error('Invalid repository relationship provenance.');
    }
    seen.add(e.id as string);
    return {
      id: e.id as string, source: e.source as string, target: e.target as string,
      type: e.type as string, referenceId: e.referenceId as string,
      ...(e.certainty !== undefined ? { certainty: e.certainty as string } : {}),
      ...(e.inferred !== undefined ? { inferred: e.inferred as boolean } : {}),
    };
  });
  const rawComponents = Array.isArray(data.components) ? data.components : [];
  const augmented: Component[] = evidence.components.map((c, i) => {
    const raw = rawComponents[i] as Record<string, unknown>;
    if (raw.inferred !== undefined && typeof raw.inferred !== 'boolean') throw new Error('Invalid component provenance.');
    return c;
  });
  return { ...evidence, components: augmented, relationships, limitations: evidence.limitations };
}
