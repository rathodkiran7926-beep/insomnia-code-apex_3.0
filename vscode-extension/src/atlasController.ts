import { ApiError, type MentorApi } from './api-client/client';
import type { Neighborhood } from './api-client/atlasContracts';
import type { ResolvedComponentContext } from './mentorController';
import type { RepositoryBinding } from './repository';
import type { EditorContext } from './vscode-adapters/editorContext';

export interface AtlasResult { id: string; target: ResolvedComponentContext; neighborhood: Neighborhood }
export interface AtlasState { status: 'idle' | 'loading' | 'ready' | 'empty' | 'error'; message: string; result?: AtlasResult; canBack: boolean }
interface Environment {
  trusted(): boolean;
  binding(uri: string, expected?: RepositoryBinding): RepositoryBinding | undefined;
  workspace(): string | undefined;
  editor(): EditorContext | undefined;
  resolve(context: EditorContext | undefined, signal: AbortSignal): Promise<ResolvedComponentContext | undefined>;
}
const bindingKey = (b: RepositoryBinding | undefined) => b && JSON.stringify([b.backendUrl, b.workspaceUri, b.snapshotId, b.repositoryIdentity, b.indexedCommit, b.connectedAt]);
const targetKey = (t: ResolvedComponentContext) => `${bindingKey(t.binding)}:${t.component.id}`;
interface Pending { controller: AbortController; key: string; target?: ResolvedComponentContext }

/** One current projection and five target descriptors. Backend owns every graph relationship. */
export class AtlasController {
  private listeners = new Set<() => void>();
  private history: ResolvedComponentContext[] = [];
  private editorTarget?: ResolvedComponentContext;
  private retryTarget?: ResolvedComponentContext;
  private pending?: Pending;
  private disposed = false;
  private serial = 0;
  private value: AtlasState = { status: 'idle', message: 'Select code and choose Show Related Code.', canBack: false };
  constructor(private readonly api: Pick<MentorApi, 'backendIdentity' | 'neighborhood'>, private readonly env: Environment) {}
  get state(): AtlasState { return { ...this.value, canBack: this.history.length > 0 }; }
  onChange(listener: () => void) { this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } }; }
  private publish(status: AtlasState['status'], message: string, result = this.value.result): void {
    if (this.disposed) return;
    this.value = { status, message, result, canBack: this.history.length > 0 };
    for (const listener of this.listeners) listener();
  }
  private guard(target: ResolvedComponentContext): void {
    const workspace = this.env.workspace();
    if (this.disposed || !this.env.trusted() || this.api.backendIdentity !== target.binding.backendUrl || bindingKey(this.env.binding(target.binding.workspaceUri, target.binding)) !== bindingKey(target.binding) || workspace && workspace !== target.binding.workspaceUri) throw new Error('Connect a repository snapshot to explore architecture. The previous Map context is no longer active.');
  }
  private ensure(p: Pending, target?: ResolvedComponentContext): void {
    if (this.disposed || p !== this.pending || p.controller.signal.aborted) throw new ApiError('cancelled', 'Map request cancelled.');
    if (target) this.guard(target);
  }
  private begin(key: string, target?: ResolvedComponentContext): Pending {
    this.pending?.controller.abort();
    const p = { controller: new AbortController(), key, target }; this.pending = p;
    this.publish('loading', 'Reading the indexed architecture neighborhood…'); return p;
  }
  private failure(error: unknown, p: Pending): void {
    if (this.pending !== p || this.disposed) return;
    if (error instanceof ApiError && error.kind === 'cancelled') this.publish('idle', 'Context changed. Run Show Related Code again.');
    else this.publish('error', error instanceof ApiError && error.status === 429 ? 'Backend rate limit (429). Retry when ready.' : error instanceof ApiError && error.status === 404 ? 'Snapshot or component is no longer available. Reconnect or select supported code.' : error instanceof Error ? error.message : 'Map unavailable. Retry when ready.');
  }
  private async fetch(target: ResolvedComponentContext, p: Pending, mode: 'push' | 'back' | 'refresh'): Promise<void> {
    this.guard(target); p.target = target; this.retryTarget = target;
    const neighborhood = await this.api.neighborhood(target.binding.snapshotId, target.component.id, 25, p.controller.signal);
    this.ensure(p, target);
    if (neighborhood.snapshotId !== target.binding.snapshotId || neighborhood.repositoryIdentity !== target.binding.repositoryIdentity || neighborhood.indexedCommit !== target.binding.indexedCommit || neighborhood.component.id !== target.component.id || neighborhood.component.referenceId !== target.component.referenceId) throw new Error('Atlas response identity changed. Reconnect explicitly.');
    if (mode === 'push' && this.value.result && targetKey(this.value.result.target) !== targetKey(target)) {
      this.history.push(this.value.result.target); if (this.history.length > 5) this.history.shift();
    }
    if (mode === 'back') this.history.pop();
    this.publish('ready', 'Indexed static relationships; not observed execution.', { id: `atlas-${++this.serial}`, target: { ...target, component: neighborhood.component }, neighborhood });
  }
  async showRelated(context = this.env.editor()): Promise<void> {
    const key = `resolve:${JSON.stringify(context)}`;
    if (this.disposed || this.pending?.key === key) return;
    const p = this.begin(key);
    try {
      if (!this.env.trusted() || !context?.binding) throw new Error('Connect a repository snapshot to explore architecture.');
      const target = await this.env.resolve(context, p.controller.signal); this.ensure(p);
      if (!target) { this.publish('empty', 'No analyzed component matches this selection.'); return; }
      this.guard(target); this.editorTarget = target; await this.fetch(target, p, 'push');
    } catch (error) { this.failure(error, p); }
    finally { if (this.pending === p) this.pending = undefined; }
  }
  async open(target: ResolvedComponentContext, mode: 'push' | 'back' | 'refresh' = 'push'): Promise<void> {
    if (this.disposed || this.pending?.key === targetKey(target)) return;
    const p = this.begin(targetKey(target), target);
    try { await this.fetch(target, p, mode); } catch (error) { this.failure(error, p); }
    finally { if (this.pending === p) this.pending = undefined; }
  }
  current(viewId: string): AtlasResult {
    const result = this.value.result;
    if (!result || viewId !== result.id) throw new Error('This Map item is no longer current. Refresh the Map.');
    this.guard(result.target); return result;
  }
  targetFor(componentId: string, viewId: string): ResolvedComponentContext {
    const result = this.current(viewId); const component = result.neighborhood.components.find(c => c.id === componentId);
    if (!component) throw new Error('This component is not in the current neighborhood.');
    return { ...result.target, component, scopeNotice: 'Explicit Map exploration target; indexed snapshot.' };
  }
  async explore(componentId: string, viewId: string): Promise<void> { await this.open(this.targetFor(componentId, viewId)); }
  async back(): Promise<void> { const target = this.history.at(-1); if (target) await this.open(target, 'back'); }
  async backToEditor(): Promise<void> { if (this.editorTarget) await this.open(this.editorTarget); else await this.showRelated(); }
  async refresh(): Promise<void> { const target = this.retryTarget ?? this.value.result?.target; if (target) await this.open(target, 'refresh'); else await this.showRelated(); }
  contextChanged(): void {
    const target = this.pending?.target ?? this.value.result?.target ?? this.retryTarget;
    if (!target) return;
    try { this.guard(target); } catch {
      this.pending?.controller.abort(); this.pending = undefined; this.history = []; this.editorTarget = undefined; this.retryTarget = undefined;
      this.value.result = undefined; this.publish('idle', 'Connect a repository snapshot to explore architecture.');
    }
  }
  dispose(): void { this.disposed = true; this.pending?.controller.abort(); this.pending = undefined; this.listeners.clear(); this.history = []; this.editorTarget = undefined; this.retryTarget = undefined; this.value.result = undefined; }
}
