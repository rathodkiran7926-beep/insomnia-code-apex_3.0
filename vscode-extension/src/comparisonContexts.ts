import { validCommit, validSnapshotId, normalizeGithubRemote, type RepositoryBinding, type SnapshotMetadata } from './repository';
const key = (b: RepositoryBinding | undefined) => b && JSON.stringify([b.backendUrl, b.workspaceUri, b.snapshotId, b.repositoryIdentity, b.indexedCommit, b.connectedAt]);

/** Two temporary side bindings, anchored to an unchanged saved workspace binding. Never persisted. */
export class ComparisonContexts {
  private session?: { parent: RepositoryBinding; comparisonId: string };
  private bindings = new Map<string, RepositoryBinding>();
  private serial = 0;
  constructor(private readonly persistent: (uri: string) => RepositoryBinding | undefined, private readonly namespace = 'comparison') {}
  setSession(parent?: RepositoryBinding, comparisonId?: string): void {
    if (parent && comparisonId && key(parent) === key(this.session?.parent) && comparisonId === this.session?.comparisonId) return;
    this.bindings.clear(); this.serial++; this.session = parent && comparisonId ? { parent, comparisonId } : undefined;
  }
  bindingFor(uri: string, expected?: RepositoryBinding): RepositoryBinding | undefined {
    const parent = this.persistent(uri);
    const temporary = expected?.connectedAt && this.bindings.get(expected.connectedAt);
    return temporary && key(temporary) === key(expected) && key(parent) === key(this.session?.parent) ? temporary : parent;
  }
  create(parent: RepositoryBinding, comparisonId: string, snapshot: SnapshotMetadata, side: 'before' | 'after'): RepositoryBinding {
    if (!this.session || comparisonId !== this.session.comparisonId || key(parent) !== key(this.session.parent) || key(this.persistent(parent.workspaceUri)) !== key(parent) || !validSnapshotId(snapshot.snapshotId) || !validCommit(snapshot.indexedCommit) || normalizeGithubRemote(snapshot.repositoryIdentity) !== snapshot.repositoryIdentity) throw new Error('This PR exploration belongs to an obsolete or invalid comparison.');
    const connectedAt = `${this.namespace}:${this.serial}:${side}`;
    const existing = this.bindings.get(connectedAt);
    if (existing && (existing.snapshotId !== snapshot.snapshotId || existing.indexedCommit !== snapshot.indexedCommit || existing.repositoryIdentity !== snapshot.repositoryIdentity)) throw new Error('Comparison-side snapshot identity changed. Refresh the comparison explicitly.');
    const binding: RepositoryBinding = { ...parent, snapshotId: snapshot.snapshotId, indexedCommit: snapshot.indexedCommit, repositoryIdentity: snapshot.repositoryIdentity, connectedAt };
    this.bindings.set(connectedAt, binding); return binding;
  }
  dispose(): void { this.setSession(); }
}
