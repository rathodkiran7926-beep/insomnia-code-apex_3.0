import { normalizeGithubRemote, validCommit, validSnapshotId, type RepositoryBinding, type SnapshotMetadata } from '../repository';
import { validateCitation, type Component, type SourceReference } from './mentorContracts';
import { parsePrUrl } from './prContracts';

export interface LocalCheckpointContext { branch?: string; headCommit?: string; gitStatus: 'clean' | 'modified' | 'unknown' }
export interface CheckpointInput { requestId: string; snapshotId: string; taskTitle: string; notes: { discovery: string; unresolved: string; nextStep: string }; localContext: LocalCheckpointContext; sourceReferenceIds: string[] }
export interface CheckpointSummary { id: string; schemaVersion: 1; repositoryIdentity: string; snapshotId: string; indexedCommit: string; taskTitle: string; localContext: LocalCheckpointContext; createdAt: string; updatedAt: string }
export interface Checkpoint extends CheckpointSummary { notes: CheckpointInput['notes']; sourceReferenceIds: string[] }
export interface CheckpointDetail { checkpoint: Checkpoint; snapshotAvailable: boolean; references: SourceReference[]; components: Component[]; warnings: string[] }
export interface CheckpointPage { repositoryIdentity: string; items: CheckpointSummary[]; limit: number; offset: number; hasMore: boolean }
export interface CheckpointCapability { enabled: boolean; mode: 'local-single-user'; schemaVersion: 1; notice: string }
export interface CheckpointResume { detail: CheckpointDetail; currentSnapshot: SnapshotMetadata; currentLocalContext: LocalCheckpointContext; versions: { indexed: 'same' | 'different'; localHead: 'same' | 'different' | 'unknown' }; changes: { status: 'verified' | 'unavailable'; notice: string; items: { referenceId: string; file: string; status: 'changed' | 'unchanged' | 'unknown'; scope: 'file'; notice: string; currentReference?: SourceReference }[] }; comparison?: { id: string; prUrl: string; beforeSnapshotId: string; afterSnapshotId: string } }

function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid checkpoint structure.'); return value as Record<string, unknown>; }
function text(value: unknown, max: number, blank = false): string { if (typeof value !== 'string' || value.length > max || (!blank && !value.trim()) || value.includes('\0')) throw new Error('Invalid checkpoint text.'); return value; }
function array(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) throw new Error('Invalid checkpoint list.'); return value; }
function unique<T>(values: T[]): T[] { if (new Set(values).size !== values.length) throw new Error('Duplicate checkpoint identifiers.'); return values; }
function id(value: unknown): string { if (!validSnapshotId(value)) throw new Error('Invalid checkpoint identifier.'); return value; }
function timestamp(value: unknown): string { const result = text(value, 40); if (!/^\d{4}-\d\d-\d\dT/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error('Invalid checkpoint date.'); return result; }
function notes(value: unknown): CheckpointInput['notes'] { const data = object(value); return { discovery: text(data.discovery, 2000, true), unresolved: text(data.unresolved, 2000, true), nextStep: text(data.nextStep, 2000, true) }; }
function referenceIds(value: unknown): string[] { return unique(array(value, 8).map(item => text(item, 200))); }
export function validateCheckpointBinding(binding: RepositoryBinding): void { if (!validSnapshotId(binding.snapshotId) || !validCommit(binding.indexedCommit) || normalizeGithubRemote(binding.repositoryIdentity) !== binding.repositoryIdentity) throw new Error('Invalid checkpoint repository binding.'); }
export function validateLocalCheckpointContext(value: unknown): LocalCheckpointContext {
  const data = object(value); if (!['clean', 'modified', 'unknown'].includes(String(data.gitStatus)) || (data.headCommit !== undefined && !validCommit(data.headCommit))) throw new Error('Invalid local checkpoint context.');
  if (data.branch === '') throw new Error('Invalid checkpoint branch.');
  return { ...(data.branch !== undefined ? { branch: text(data.branch, 200, true) } : {}), ...(data.headCommit !== undefined ? { headCommit: data.headCommit as string } : {}), gitStatus: data.gitStatus as LocalCheckpointContext['gitStatus'] };
}
function sameContext(a: LocalCheckpointContext, b: LocalCheckpointContext): boolean { return a.branch === b.branch && a.headCommit === b.headCommit && a.gitStatus === b.gitStatus; }
export function validateCheckpointInput(value: unknown, binding: RepositoryBinding): CheckpointInput {
  validateCheckpointBinding(binding); const data = object(value);
  if (typeof data.requestId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(data.requestId) || data.snapshotId !== binding.snapshotId) throw new Error('Invalid checkpoint request identity.');
  const result = { requestId: data.requestId, snapshotId: binding.snapshotId, taskTitle: text(data.taskTitle, 200), notes: notes(data.notes), localContext: validateLocalCheckpointContext(data.localContext), sourceReferenceIds: referenceIds(data.sourceReferenceIds) };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 24576) throw new Error('Checkpoint request exceeds its byte limit.'); return result;
}
function summary(value: unknown, binding: RepositoryBinding): CheckpointSummary {
  const data = object(value); if (data.schemaVersion !== 1 || data.repositoryIdentity !== binding.repositoryIdentity || !validCommit(data.indexedCommit)) throw new Error('Checkpoint repository or schema mismatch.');
  const result = { id: id(data.id), schemaVersion: 1 as const, repositoryIdentity: binding.repositoryIdentity, snapshotId: id(data.snapshotId), indexedCommit: data.indexedCommit, taskTitle: text(data.taskTitle, 200), localContext: validateLocalCheckpointContext(data.localContext), createdAt: timestamp(data.createdAt), updatedAt: timestamp(data.updatedAt) };
  if (Date.parse(result.updatedAt) < Date.parse(result.createdAt)) throw new Error('Inconsistent checkpoint dates.'); return result;
}
export function validateCheckpointCapability(value: unknown): CheckpointCapability { const data = object(value); if (typeof data.enabled !== 'boolean' || data.mode !== 'local-single-user' || data.schemaVersion !== 1) throw new Error('Unsupported checkpoint capability.'); return { enabled: data.enabled, mode: data.mode, schemaVersion: 1, notice: text(data.notice, 1000) }; }
export function validateCheckpointDetail(value: unknown, binding: RepositoryBinding, expectedId?: string, approvedInput?: CheckpointInput): CheckpointDetail {
  validateCheckpointBinding(binding); const data = object(value); const saved = object(data.checkpoint); const checkpoint: Checkpoint = { ...summary(saved, binding), notes: notes(saved.notes), sourceReferenceIds: referenceIds(saved.sourceReferenceIds) };
  if ((expectedId !== undefined && checkpoint.id !== expectedId) || typeof data.snapshotAvailable !== 'boolean') throw new Error('Checkpoint identity mismatch.');
  if (approvedInput && (checkpoint.snapshotId !== binding.snapshotId || checkpoint.indexedCommit.toLowerCase() !== binding.indexedCommit.toLowerCase() || checkpoint.taskTitle !== approvedInput.taskTitle || JSON.stringify(checkpoint.notes) !== JSON.stringify(approvedInput.notes) || !sameContext(checkpoint.localContext, approvedInput.localContext) || JSON.stringify(checkpoint.sourceReferenceIds) !== JSON.stringify(approvedInput.sourceReferenceIds))) throw new Error('Saved checkpoint differs from approved input.');
  const metadata = { snapshotId: checkpoint.snapshotId, repositoryIdentity: checkpoint.repositoryIdentity, indexedCommit: checkpoint.indexedCommit, limitations: [] };
  const references = array(data.references, 8).map(item => validateCitation(item, metadata)); const ids = unique(references.map(item => item.id));
  const warnings = array(data.warnings, 30).map(item => text(item, 1000));
  if (ids.some(item => !checkpoint.sourceReferenceIds.includes(item)) || (data.snapshotAvailable && !warnings.length && checkpoint.sourceReferenceIds.some(item => !ids.includes(item)))) throw new Error('Checkpoint source references do not match saved selections.');
  const components = array(data.components, 20).map(value => { const item = object(value); const result = { id: text(item.id, 200), name: text(item.name, 300), role: text(item.role, 80), referenceId: text(item.referenceId, 200) }; if (!ids.includes(result.referenceId)) throw new Error('Unknown checkpoint component source.'); return result; }); unique(components.map(item => item.id));
  if (!data.snapshotAvailable && (references.length || components.length)) throw new Error('Unavailable snapshot returned source evidence.');
  return { checkpoint, snapshotAvailable: data.snapshotAvailable, references, components, warnings };
}
export function validateCheckpointPage(value: unknown, binding: RepositoryBinding, limit: number, offset: number): CheckpointPage {
  validateCheckpointBinding(binding); const data = object(value); if (data.repositoryIdentity !== binding.repositoryIdentity || data.limit !== limit || data.offset !== offset || typeof data.hasMore !== 'boolean') throw new Error('Invalid checkpoint page identity.');
  const items = array(data.items, limit).map(value => { const item = object(value); if ('notes' in item || 'sourceReferenceIds' in item || 'references' in item) throw new Error('Checkpoint list includes private detail fields.'); return summary(item, binding); }); unique(items.map(item => item.id));
  return { repositoryIdentity: binding.repositoryIdentity, items, limit, offset, hasMore: data.hasMore };
}
export function validateCheckpointResume(value: unknown, binding: RepositoryBinding, expectedId: string, localContext: LocalCheckpointContext): CheckpointResume {
  const data = object(value); const detail = validateCheckpointDetail(data.detail, binding, expectedId); const raw = object(data.currentSnapshot);
  if (raw.snapshotId !== binding.snapshotId || raw.repositoryIdentity !== binding.repositoryIdentity || typeof raw.indexedCommit !== 'string' || raw.indexedCommit.toLowerCase() !== binding.indexedCommit.toLowerCase()) throw new Error('Resume current snapshot does not match binding.');
  const currentSnapshot: SnapshotMetadata = { snapshotId: binding.snapshotId, repositoryIdentity: binding.repositoryIdentity, indexedCommit: raw.indexedCommit, limitations: array(raw.limitations, 30).map(item => text(item, 500, true)) };
  const currentLocalContext = validateLocalCheckpointContext(data.currentLocalContext); if (!sameContext(currentLocalContext, localContext)) throw new Error('Resume local context was changed.');
  const expectedVersions = { indexed: detail.checkpoint.indexedCommit.toLowerCase() === binding.indexedCommit.toLowerCase() ? 'same' : 'different', localHead: !detail.checkpoint.localContext.headCommit || !currentLocalContext.headCommit ? 'unknown' : detail.checkpoint.localContext.headCommit.toLowerCase() === currentLocalContext.headCommit.toLowerCase() ? 'same' : 'different' } as CheckpointResume['versions'];
  const versions = object(data.versions); if (versions.indexed !== expectedVersions.indexed || versions.localHead !== expectedVersions.localHead) throw new Error('Resume version claims are inconsistent.');
  const changes = object(data.changes); if (!['verified', 'unavailable'].includes(String(changes.status))) throw new Error('Unsupported checkpoint comparison status.');
  const items = array(changes.items, 8).map(value => {
    const item = object(value); const referenceId = text(item.referenceId, 200); const saved = detail.references.find(ref => ref.id === referenceId);
    if (!detail.checkpoint.sourceReferenceIds.includes(referenceId) || item.scope !== 'file' || !['changed', 'unchanged', 'unknown'].includes(String(item.status)) || (saved ? item.file !== saved.file : item.file !== '(unavailable)' || item.status !== 'unknown' || item.currentReference !== undefined)) throw new Error('Unsupported checkpoint file change.');
    const currentReference = item.currentReference === undefined ? undefined : validateCitation(item.currentReference, currentSnapshot);
    if (item.status !== 'unknown' && !currentReference) throw new Error('Verified checkpoint file change requires current source evidence.');
    if (currentReference && currentReference.file !== saved?.file) throw new Error('Resume source path mismatch.');
    return { referenceId, file: saved?.file ?? '(unavailable)', status: item.status as 'changed' | 'unchanged' | 'unknown', scope: 'file' as const, notice: text(item.notice, 1000), ...(currentReference ? { currentReference } : {}) };
  }); unique(items.map(item => item.referenceId));
  if ((changes.status === 'unavailable' && items.length > 0 && !items.some(item => item.status === 'unknown')) || (changes.status === 'verified' && (!items.length || items.some(item => item.status === 'unknown') || items.length !== detail.checkpoint.sourceReferenceIds.length))) throw new Error('Incomplete or unverified checkpoint file changes.');
  let comparison: CheckpointResume['comparison']; if (data.comparison !== undefined) { const rawComparison = object(data.comparison); const beforeSnapshotId = id(rawComparison.beforeSnapshotId); const afterSnapshotId = id(rawComparison.afterSnapshotId); if (beforeSnapshotId !== detail.checkpoint.snapshotId || afterSnapshotId !== binding.snapshotId) throw new Error('Checkpoint PR comparison snapshots mismatch.'); comparison = { id: id(rawComparison.id), prUrl: parsePrUrl(text(rawComparison.prUrl, 3000), binding.repositoryIdentity).url, beforeSnapshotId, afterSnapshotId }; }
  return { detail, currentSnapshot, currentLocalContext, versions: expectedVersions, changes: { status: changes.status as 'verified' | 'unavailable', notice: text(changes.notice, 1000), items }, ...(comparison ? { comparison } : {}) };
}
export function validateCheckpointDeletion(value: unknown, expectedId: string): { id: string; deleted: true } { const data = object(value); if (data.id !== expectedId || data.deleted !== true) throw new Error('Checkpoint deletion identity mismatch.'); return { id: expectedId, deleted: true }; }
