import { validateEvidence, type Component, type SnapshotEvidence } from './mentorContracts';

export interface AtlasComponent extends Component { inferred?: boolean }
export interface Relationship { id: string; source: string; target: string; type: string; referenceId: string; certainty?: string; inferred?: boolean; mountPath?: string; evidence?: string[] }
export interface AtlasDocumentation { componentId: string; explanation: string; inferred: true; referenceIds: string[] }
export interface Neighborhood extends SnapshotEvidence { component: AtlasComponent; components: AtlasComponent[]; incoming: Relationship[]; outgoing: Relationship[]; documentation: AtlasDocumentation[]; truncated: boolean; limit: number }
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Atlas object.');
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 200): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid Atlas text.'); return value;
};
const list = (value: unknown, max: number): unknown[] => {
  if (!Array.isArray(value) || value.length > max) throw new Error('Oversized or malformed Atlas list.'); return value;
};
export const validComponentId = (id: string): boolean => /^[\w-]{1,200}$/.test(id);
export function validateNeighborhood(value: unknown, snapshotId: string, componentId: string, limit: number): Neighborhood {
  const data = object(value);
  if (data.limit !== limit || typeof data.truncated !== 'boolean') throw new Error('Invalid Atlas bounds.');
  list(data.components, limit * 2 + 1); list(data.references, limit * 3 + 9);
  // Reuse the established metadata/reference validator with this endpoint's envelope.
  const evidence = validateEvidence({ ...data, relationships: [...list(data.incoming, limit), ...list(data.outgoing, limit)], documentation: { snapshotId }, report: { limitations: list(data.limitations, 32) } }, snapshotId);
  const components = evidence.components.map((component, index) => {
    const raw = object((data.components as unknown[])[index]);
    if ('inferred' in raw && typeof raw.inferred !== 'boolean') throw new Error('Invalid component inference metadata.');
    return { ...component, ...(typeof raw.inferred === 'boolean' ? { inferred: raw.inferred } : {}) };
  });
  const selected = object(data.component); const component = components.find(c => c.id === componentId);
  if (!component || ['id', 'name', 'role', 'referenceId'].some(key => selected[key] !== component[key as keyof Component])) throw new Error('Atlas selected component mismatch.');
  const ids = new Set(components.map(c => c.id)); const refs = new Set(evidence.references.map(r => r.id));
  const parseEdges = (input: unknown, direction: 'incoming' | 'outgoing') => list(input, limit).map(raw => {
    const item = object(raw);
    const edge: Relationship = { id: text(item.id), source: text(item.source), target: text(item.target), type: text(item.type, 80), referenceId: text(item.referenceId) };
    if (!ids.has(edge.source) || !ids.has(edge.target) || !refs.has(edge.referenceId) || edge[direction === 'incoming' ? 'target' : 'source'] !== componentId) throw new Error('Atlas relationship identity or direction mismatch.');
    if ('certainty' in item) edge.certainty = text(item.certainty, 80);
    if ('inferred' in item) { if (typeof item.inferred !== 'boolean') throw new Error('Invalid relationship inference.'); edge.inferred = item.inferred; }
    if ('mountPath' in item) edge.mountPath = text(item.mountPath, 1000);
    if ('evidence' in item) edge.evidence = list(item.evidence, 8).map(v => text(v, 1000));
    return edge;
  });
  const incoming = parseEdges(data.incoming, 'incoming'); const outgoing = parseEdges(data.outgoing, 'outgoing');
  const edges = [...incoming, ...outgoing];
  if (new Set(incoming.map(e => e.id)).size !== incoming.length || new Set(outgoing.map(e => e.id)).size !== outgoing.length || new Set(edges.map(e => e.id)).size > limit) throw new Error('Invalid Atlas edge count.');
  for (const edge of incoming) { const other = outgoing.find(e => e.id === edge.id); if (other && (edge.source !== componentId || edge.target !== componentId || JSON.stringify(edge) !== JSON.stringify(other))) throw new Error('Inconsistent Atlas self-edge.'); }
  const documentation = list(data.documentation, 1).map(raw => {
    const doc = object(raw); const referenceIds = list(doc.referenceIds, 8).map(v => text(v));
    if (doc.componentId !== componentId || doc.inferred !== true || !referenceIds.length || referenceIds.some(id => !refs.has(id))) throw new Error('Invalid Atlas documentation evidence.');
    return { componentId, explanation: text(doc.explanation, 1200), inferred: true as const, referenceIds };
  });
  return { ...evidence, components, component, incoming, outgoing, documentation, truncated: data.truncated, limit };
}
