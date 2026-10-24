import { normalizeGithubRemote, validCommit, validSnapshotId, type SnapshotMetadata } from '../repository';
import { safeSourcePath, validateCitation, type SourceReference } from './mentorContracts';

export type PrState = 'open' | 'closed' | 'all';
export interface PullRequest { number: number; title: string; url: string; state: 'open' | 'closed'; draft: boolean; merged: boolean; head: string; base: string; updatedAt: string; author?: string }
export interface PullRequestPage { repository: string; state: PrState; page: number; hasMore: boolean; pullRequests: PullRequest[] }
export interface PrJob { id: string; status: 'running' | 'complete' | 'failed'; progress: number; message: string; comparison_id: string | null; url?: string | null }
export interface PrComponent { id: string; name: string; role: string; reference: SourceReference }
export interface PrEdge { id: string; source: string; target: string; type: string; certainty?: string; reference: SourceReference }
export interface PrFile { path: string; previousPath: string | null; status: string; additions: number; deletions: number; hidden: boolean; patchLimited: boolean }
export interface PrSetupChange { path: string; section?: string; name: string; before: 'present' | null; after: 'present' | null }
/** Presence labels only: executable strings and dependency/engine values never cross this boundary. */
export interface PrSetupGuide { path: string; packageManager: boolean; engines: boolean; scripts: boolean }
export interface PrComparison {
  id: string; createdAt: string; beforeSnapshotId: string; afterSnapshotId: string;
  pr: { url: string; number: number; title: string; state: 'open' | 'closed'; baseRepository: string; headRepository: string; baseCommit: string; headCommit: string; targetCommit: string; baseBranch: string; headBranch: string; files: PrFile[]; limited: boolean; changedFiles: number };
  components: { status: 'added' | 'removed' | 'modified'; before: PrComponent | null; after: PrComponent | null; ambiguous: boolean }[];
  edges: { added: PrEdge[]; removed: PrEdge[] };
  impact: { before: (PrComponent & { depth: number; via: string })[]; after: (PrComponent & { depth: number; via: string })[] };
  setup: { environment: { name: string; change: 'added' | 'removed'; path: string }[]; dependencies: PrSetupChange[]; scripts: PrSetupChange[]; migrations: { path: string; status: string }[]; guides: { before: PrSetupGuide[]; after: PrSetupGuide[] } };
  warnings: string[];
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid PR object.');
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 300, empty = false): string => {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new Error('Invalid PR text.');
  return value;
};
const list = (value: unknown, max: number): unknown[] => { if (!Array.isArray(value) || value.length > max) throw new Error('Invalid or oversized PR list.'); return value; };
const flag = (value: unknown): boolean => { if (typeof value !== 'boolean') throw new Error('Invalid PR flag.'); return value; };
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number => { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error('Invalid PR number.'); return value as number; };
const choice = <T extends string>(value: unknown, allowed: readonly T[]): T => { if (!allowed.includes(value as T)) throw new Error('Invalid PR status.'); return value as T; };
const id = (value: unknown): string => { if (!validSnapshotId(value)) throw new Error('Invalid PR identifier.'); return value; };
const path = (value: unknown): string => { const result = text(value, 1000); if (!safeSourcePath(result)) throw new Error('Invalid PR source path.'); return result; };
const date = (value: unknown): string => { const result = text(value, 50); if (!Number.isFinite(Date.parse(result))) throw new Error('Invalid PR timestamp.'); return result; };
const repository = (value: unknown): string => { const result = text(value, 400); const normalized = normalizeGithubRemote(result); if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(result) || !normalized) throw new Error('Invalid public GitHub PR repository.'); return normalized; };
const commit = (value: unknown): string => { if (!validCommit(value)) throw new Error('Invalid PR immutable commit.'); return value; };
const state = (value: unknown) => choice(value, ['open', 'closed'] as const);
const fileStatus = (value: unknown) => choice(value, ['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'] as const);

export function parsePrUrl(value: string, repositoryIdentity?: string): { url: string; repositoryIdentity: string; number: number } {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)\/?$/.exec(text(value, 400));
  if (!match || [match[1], match[2]].some(part => !part || part === '.' || part === '..' || /\.git$/i.test(part))) throw new Error('Enter a public GitHub pull request URL.');
  const identity = normalizeGithubRemote(`https://github.com/${match[1]}/${match[2]}`);
  if (!identity || (repositoryIdentity !== undefined && identity !== repository(repositoryIdentity))) throw new Error('PR belongs to another repository.');
  const number = integer(Number(match[3]), 1);
  return { url: `${identity}/pull/${number}`, repositoryIdentity: identity, number };
}

export function validatePullRequestPage(value: unknown, repositoryIdentity: string, expectedState: PrState, page: number): PullRequestPage {
  const data = object(value); repository(repositoryIdentity);
  choice(expectedState, ['open', 'closed', 'all']); integer(page, 1, 100);
  if (repository(data.repository) !== repositoryIdentity || data.state !== expectedState || data.page !== page) throw new Error('PR list repository or pagination mismatch.');
  const pullRequests = list(data.pullRequests, 30).map(value => {
    const item = object(value); const parsed = parsePrUrl(text(item.url, 400), repositoryIdentity);
    if (item.number !== parsed.number) throw new Error('PR list number mismatch.');
    const result: PullRequest = { number: parsed.number, url: parsed.url, title: text(item.title, 500), state: state(item.state), draft: flag(item.draft), merged: flag(item.merged), head: text(item.head, 300, true), base: text(item.base, 300, true), updatedAt: date(item.updatedAt) };
    if (expectedState !== 'all' && result.state !== expectedState) throw new Error('PR list state mismatch.');
    if ('author' in item) result.author = text(item.author, 100, true);
    return result;
  });
  if (new Set(pullRequests.map(item => item.number)).size !== pullRequests.length) throw new Error('Duplicate PR list entries.');
  return { repository: repositoryIdentity, state: expectedState, page, hasMore: flag(data.hasMore), pullRequests };
}

export function validatePrJob(value: unknown, expectedId: string): PrJob {
  const data = object(value); id(expectedId);
  if (data.id !== expectedId) throw new Error('PR analysis job identity mismatch.');
  const status = choice(data.status, ['running', 'complete', 'failed'] as const);
  const comparison_id = data.comparison_id === null ? null : id(data.comparison_id);
  const progress = integer(data.progress, 0, 100);
  if ((status === 'complete') !== (comparison_id !== null) || (status === 'complete' && progress !== 100)) throw new Error('Inconsistent PR job completion.');
  const result: PrJob = { id: expectedId, status, progress, message: text(data.message, 2000, true), comparison_id };
  if ('url' in data) result.url = data.url === null ? null : parsePrUrl(text(data.url, 400)).url;
  return result;
}

export function validatePrComparison(value: unknown, expectedId: string, repositoryIdentity: string, prUrl: string): PrComparison {
  const data = object(value); const raw = object(data.pr); const requested = parsePrUrl(prUrl, repositoryIdentity);
  if (data.id !== id(expectedId) || repository(raw.baseRepository) !== repository(repositoryIdentity) || raw.number !== requested.number || parsePrUrl(text(raw.url, 400), repositoryIdentity).url !== requested.url) throw new Error('PR comparison identity mismatch.');
  const beforeSnapshotId = id(data.beforeSnapshotId), afterSnapshotId = id(data.afterSnapshotId);
  const pr: PrComparison['pr'] = { url: requested.url, number: requested.number, title: text(raw.title, 500), state: state(raw.state), baseRepository: repository(repositoryIdentity), headRepository: repository(raw.headRepository), baseCommit: commit(raw.baseCommit), headCommit: commit(raw.headCommit), targetCommit: commit(raw.targetCommit), baseBranch: text(raw.baseBranch, 300), headBranch: text(raw.headBranch, 300), changedFiles: integer(raw.changedFiles), limited: flag(raw.limited), files: list(raw.files, 300).map(value => {
    const item = object(value); return { path: path(item.path), previousPath: item.previousPath === null ? null : path(item.previousPath), status: fileStatus(item.status), additions: integer(item.additions), deletions: integer(item.deletions), hidden: flag(item.hidden), patchLimited: flag(item.patchLimited) };
  }) };
  if (beforeSnapshotId === afterSnapshotId && (pr.baseRepository !== pr.headRepository || pr.baseCommit.toLowerCase() !== pr.headCommit.toLowerCase())) throw new Error('Shared PR snapshot ID identifies inconsistent repository or commit sides.');
  if (new Set(pr.files.map(item => item.path)).size !== pr.files.length || pr.files.length > pr.changedFiles) throw new Error('Inconsistent PR changed files.');
  const before: SnapshotMetadata = { snapshotId: beforeSnapshotId, repositoryIdentity: pr.baseRepository, indexedCommit: pr.baseCommit, limitations: [] };
  const after: SnapshotMetadata = { snapshotId: afterSnapshotId, repositoryIdentity: pr.headRepository, indexedCommit: pr.headCommit, limitations: [] };
  const component = (value: unknown, snapshot: SnapshotMetadata): PrComponent => { const item = object(value); return { id: text(item.id, 200), name: text(item.name, 500), role: text(item.role, 80), reference: validateCitation(item.reference, snapshot) }; };
  const components = list(data.components, 20000).map(value => {
    const item = object(value); const status = choice(item.status, ['added', 'removed', 'modified'] as const);
    const left = item.before === null ? null : component(item.before, before), right = item.after === null ? null : component(item.after, after);
    if ((status !== 'added') !== (left !== null) || (status !== 'removed') !== (right !== null)) throw new Error('PR component change has inconsistent sides.');
    return { status, before: left, after: right, ambiguous: flag(item.ambiguous) };
  });
  const edgesData = object(data.edges), impactData = object(data.impact);
  const edges = (value: unknown, snapshot: SnapshotMetadata): PrEdge[] => list(value, 40000).map(value => {
    const item = object(value); const result: PrEdge = { id: text(item.id, 200), source: text(item.source, 200), target: text(item.target, 200), type: text(item.type, 80), reference: validateCitation(item.reference, snapshot) };
    if ('certainty' in item) result.certainty = text(item.certainty, 80);
    return result;
  });
  const impact = (value: unknown, snapshot: SnapshotMetadata) => list(value, 150).map(value => { const item = object(value); return { ...component(item, snapshot), depth: integer(item.depth, 1, 3), via: text(item.via, 80) }; });
  const setup = object(data.setup), guides = object(setup.guides);
  const changes = (value: unknown): PrSetupChange[] => list(value, 10000).map(value => {
    const item = object(value); const presence = (value: unknown): 'present' | null => { if (value === null) return null; text(value, 100000, true); return 'present'; };
    const result: PrSetupChange = { path: path(item.path), name: text(item.name, 300), before: presence(item.before), after: presence(item.after) };
    if ('section' in item) result.section = choice(item.section, ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'scripts']);
    return result;
  });
  const guide = (value: unknown): PrSetupGuide[] => list(value, 1000).map(value => {
    const item = object(value);
    const values = (value: unknown): boolean => { const entries = Object.entries(object(value)); if (entries.length > 10000) throw new Error('Oversized PR guide.'); for (const [name, content] of entries) { text(name, 300); text(content, 100000, true); } return entries.length > 0; };
    return { path: path(item.path), packageManager: item.packageManager === null ? false : Boolean(text(item.packageManager, 1000, true)), engines: values(item.engines), scripts: values(item.scripts) };
  });
  // Exclusions are emitted once per file and side; large valid repositories can exceed the display cap.
  const rawWarnings = list(data.warnings, 20000);
  const warnings = rawWarnings.slice(0, 200).map(value => text(value, 2000));
  if (rawWarnings.length > warnings.length) warnings.push(`${rawWarnings.length - warnings.length} additional comparison warnings omitted from this bounded view.`);
  return { id: expectedId, createdAt: date(data.createdAt), beforeSnapshotId, afterSnapshotId, pr, components, edges: { added: edges(edgesData.added, after), removed: edges(edgesData.removed, before) }, impact: { before: impact(impactData.before, before), after: impact(impactData.after, after) }, setup: {
    environment: list(setup.environment, 10000).map(value => { const item = object(value); const name = text(item.name, 300); if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid environment variable name.'); return { name, change: choice(item.change, ['added', 'removed'] as const), path: path(item.path) }; }),
    dependencies: changes(setup.dependencies), scripts: changes(setup.scripts), migrations: list(setup.migrations, 300).map(value => { const item = object(value); return { path: path(item.path), status: fileStatus(item.status) }; }), guides: { before: guide(guides.before), after: guide(guides.after) },
  }, warnings };
}
