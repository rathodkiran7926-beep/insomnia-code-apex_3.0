import { validateSnapshot, validCommit, normalizeGithubRemote, type SnapshotMetadata } from '../repository';

export interface SourceReference { id: string; snapshotId: string; file: string; startLine: number; endLine: number; url: string }
export interface Component { id: string; name: string; role: string; referenceId: string }
export interface SnapshotEvidence extends SnapshotMetadata { components: Component[]; references: SourceReference[] }
export interface Candidate { componentId: string; name: string; role: string; referenceId: string }
export interface Resolution { snapshotId: string; candidates: Candidate[]; scope: 'declaration' | 'module' | 'none'; notice: string }
export interface MentorAnswer { snapshotId: string; componentId: string; answer: string; mode: 'facts' | 'ai'; notice: string; referenceIds: string[]; citations: SourceReference[] }
export interface PinnedSource { snapshotId: string; file: string; excerpt: string; startLine: number; endLine: number; complete: true; url: string }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a structured backend response.');
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error('Invalid backend text field.');
  return value;
}
function array(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error('Invalid or oversized backend list.');
  return value;
}
export function safeSourcePath(value: string): boolean {
  return value.length > 0 && value.length <= 1000 && !/^[\/]|[\\:\x00-\x1f\x7f]|%[0-9a-f]{2}/i.test(value)
    && value.split('/').every(part => part && !['.', '..', '.git'].includes(part.toLowerCase()));
}
export function sourcePermalink(snapshot: SnapshotMetadata, reference: Pick<SourceReference, 'file' | 'startLine' | 'endLine'>): string {
  if (!validCommit(snapshot.indexedCommit) || normalizeGithubRemote(snapshot.repositoryIdentity) !== snapshot.repositoryIdentity || !safeSourcePath(reference.file)) throw new Error('Source location does not identify a canonical repository and immutable commit.');
  return `${snapshot.repositoryIdentity}/blob/${snapshot.indexedCommit}/${reference.file.split('/').map(encodeURIComponent).join('/')}#L${reference.startLine}-L${reference.endLine}`;
}
function pinnedUrl(value: unknown, expected: string): string {
  const url = new URL(text(value, 3000)); const target = new URL(expected);
  const path = url.pathname.split('/').map((part, index) => index === 1 || index === 2 ? part.toLowerCase() : part).join('/');
  if (url.origin !== 'https://github.com' || url.username || url.password || url.search || path !== target.pathname || url.hash !== target.hash) throw new Error('Source URL is not the expected immutable GitHub location.');
  return target.href;
}
function reference(value: unknown, snapshot: SnapshotMetadata): SourceReference {
  const item = object(value); const file = text(item.file, 1000);
  if (item.snapshotId !== snapshot.snapshotId || !safeSourcePath(file) || !Number.isSafeInteger(item.startLine) || !Number.isSafeInteger(item.endLine)) throw new Error('Invalid source reference identity or coordinates.');
  const startLine = item.startLine as number; const endLine = item.endLine as number;
  if (startLine < 1 || endLine < startLine || endLine > 1000000) throw new Error('Invalid source line range.');
  const result = { id: text(item.id, 200), snapshotId: snapshot.snapshotId, file, startLine, endLine, url: '' };
  result.url = pinnedUrl(item.url, sourcePermalink(snapshot, result));
  return result;
}
export function validateCitation(value: unknown, snapshot: SnapshotMetadata): SourceReference { return reference(value, snapshot); }
export function validateEvidence(value: unknown, snapshotId: string): SnapshotEvidence {
  const metadata = validateSnapshot(value, snapshotId); const data = object(value);
  const references = array(data.references, 20000).map(item => reference(item, metadata));
  const ids = new Set(references.map(item => item.id));
  if (ids.size !== references.length) throw new Error('Duplicate source reference IDs.');
  const components = array(data.components, 10000).map(value => {
    const item = object(value);
    const result = { id: text(item.id, 200), name: text(item.name), role: text(item.role, 80), referenceId: text(item.referenceId, 200) };
    if (!ids.has(result.referenceId)) throw new Error('Component source reference is missing.');
    return result;
  });
  if (new Set(components.map(item => item.id)).size !== components.length) throw new Error('Duplicate component IDs.');
  return { ...metadata, references, components };
}
export function validateResolution(value: unknown, evidence: SnapshotEvidence): Resolution {
  const data = object(value);
  if (data.snapshotId !== evidence.snapshotId || !['declaration', 'module', 'none'].includes(String(data.scope))) throw new Error('Selection resolver returned another snapshot or unsupported scope.');
  const candidates = array(data.candidates, 20).map(value => {
    const item = object(value);
    const stored = evidence.components.find(component => component.id === item.componentId);
    if (!stored || stored.name !== item.name || stored.role !== item.role || stored.referenceId !== item.referenceId) throw new Error('Selection resolver returned an unknown component or source reference.');
    return { componentId: stored.id, name: stored.name, role: stored.role, referenceId: stored.referenceId };
  });
  if (new Set(candidates.map(item => item.componentId)).size !== candidates.length || (data.scope === 'none') !== (candidates.length === 0)) throw new Error('Inconsistent selection resolver candidates.');
  return { snapshotId: evidence.snapshotId, candidates, scope: data.scope as Resolution['scope'], notice: text(data.notice, 1000) };
}
export function validateMentorAnswer(value: unknown, evidence: SnapshotEvidence, componentId: string): MentorAnswer {
  const data = object(value);
  if (data.snapshotId !== evidence.snapshotId || data.componentId !== componentId || !['facts', 'ai'].includes(String(data.mode))) throw new Error('Mentor response has an invalid component, snapshot or provenance.');
  const referenceIds = array(data.referenceIds, 8).map(item => text(item, 200));
  const citations = array(data.citations, 8).map(item => reference(item, evidence));
  const known = new Map(evidence.references.map(item => [item.id, item]));
  if (!referenceIds.length || !citations.length || referenceIds.some(id => !known.has(id)) || citations.some(item => {
    const stored = known.get(item.id);
    return !referenceIds.includes(item.id) || !stored || stored.file !== item.file || stored.startLine !== item.startLine || stored.endLine !== item.endLine || stored.url !== item.url;
  }) || referenceIds.some(id => !citations.some(citation => citation.url === known.get(id)?.url))) throw new Error('Mentor citations are missing or do not match indexed source references.');
  return { snapshotId: evidence.snapshotId, componentId, answer: text(data.answer, 16000), mode: data.mode as MentorAnswer['mode'], notice: text(data.notice, 1000), referenceIds, citations };
}
export function validateSource(value: unknown, snapshot: SnapshotMetadata, ref: SourceReference): PinnedSource {
  sourcePermalink(snapshot, ref);
  const data = object(value);
  if (data.snapshotId !== snapshot.snapshotId || ref.snapshotId !== snapshot.snapshotId || data.file !== ref.file || data.complete !== true || data.startLine !== 1 || typeof data.excerpt !== 'string' || data.excerpt.length > 300000 || data.excerpt.includes('\0')) throw new Error('Backend source does not match the complete indexed file.');
  const endLine = data.excerpt.split('\n').length;
  if (data.endLine !== endLine || ref.endLine > endLine) throw new Error('Citation coordinates exceed the indexed source.');
  const url = pinnedUrl(data.url, `${snapshot.repositoryIdentity}/blob/${snapshot.indexedCommit}/${ref.file.split('/').map(encodeURIComponent).join('/')}#L1`);
  return { snapshotId: snapshot.snapshotId, file: ref.file, excerpt: data.excerpt, startLine: 1, endLine, complete: true, url };
}
