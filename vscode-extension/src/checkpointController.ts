import { ApiError, type MentorApi } from './api-client/client';
import { validateCheckpointInput, type CheckpointCapability, type CheckpointDetail, type CheckpointInput, type CheckpointPage, type CheckpointResume, type LocalCheckpointContext } from './api-client/checkpointContracts';
import type { RepositoryBinding } from './repository';

export interface CheckpointState {
  status: 'idle' | 'loading' | 'saving' | 'ready' | 'error' | 'disabled' | 'cancelled';
  message: string; viewId: string; binding?: RepositoryBinding; capability?: CheckpointCapability;
  page?: CheckpointPage; detail?: CheckpointDetail; resume?: CheckpointResume;
}
interface Environment { binding(): RepositoryBinding | undefined; recoverableBinding?(): RepositoryBinding | undefined; trusted(): boolean; local(): LocalCheckpointContext }
interface Pending { binding: RepositoryBinding; controller: AbortController }
type Api = Pick<MentorApi, 'backendIdentity' | 'checkpointCapability' | 'listCheckpoints' | 'createCheckpoint' | 'checkpoint' | 'resumeCheckpoint' | 'deleteCheckpoint'>;
const key = (b: RepositoryBinding | undefined) => b && JSON.stringify([b.backendUrl, b.workspaceUri, b.snapshotId, b.repositoryIdentity, b.indexedCommit, b.connectedAt]);

/** Backend-owned notes/persistence. Local state is bounded, transient and never logged. */
export class CheckpointController {
  private listeners = new Set<() => void>(); private pending?: Pending; private writing?: Promise<void>;
  private disposed = false; private serial = 0;
  private recovery?: Pick<CheckpointState, 'status' | 'message'>;
  private value: CheckpointState = { status: 'idle', message: 'Saved Tasks are stored by the shared backend in explicit local-only mode.', viewId: 'checkpoint-0' };
  constructor(private readonly api: Api, private readonly env: Environment) {}
  get state(): CheckpointState { return { ...this.value }; }
  onChange(listener: () => void) { this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } }; }
  private publish(status: CheckpointState['status'], message: string): void { if (this.disposed) return; this.value.status = status; this.value.message = message; for (const listener of this.listeners) listener(); }
  private guard(expected?: RepositoryBinding): RepositoryBinding {
    const binding = this.env.binding();
    if (this.disposed || !this.env.trusted() || !binding || binding.backendUrl !== this.api.backendIdentity || expected && key(binding) !== key(expected)) throw new Error('Checkpoint context is unavailable. Trust and connect the intended repository.');
    return binding;
  }
  private begin(binding: RepositoryBinding): Pending { this.pending?.controller.abort(); const p = { binding, controller: new AbortController() }; this.pending = p; this.value.binding = binding; return p; }
  private ensure(p: Pending): void { if (this.pending !== p || p.controller.signal.aborted || this.disposed) throw new ApiError('cancelled', 'Checkpoint context changed.'); this.guard(p.binding); }
  private async enabled(p: Pending): Promise<boolean> {
    const capability = await this.api.checkpointCapability(p.controller.signal); this.ensure(p); this.value.capability = capability;
    if (!capability.enabled) { this.value.page = undefined; this.value.detail = undefined; this.value.resume = undefined; this.publish('disabled', 'Saved Tasks are disabled. Deliberately enable CODEBASE_MENTOR_LOCAL_CHECKPOINTS=1 on the loopback backend for single-user local development.'); }
    return capability.enabled;
  }
  private fail(error: unknown, p?: Pending, mutation?: 'save' | 'delete'): void {
    if (this.disposed || p && this.pending !== p) return;
    if (error instanceof ApiError && error.status === 403) { this.value.capability = undefined; this.value.page = undefined; this.value.detail = undefined; this.value.resume = undefined; this.publish('disabled', 'Checkpoint access is disabled or outside the direct local-only boundary. Check the server configuration.'); return; }
    const uncertain = mutation && (!(error instanceof ApiError) || ['network', 'timeout', 'cancelled', 'response'].includes(error.kind));
    this.publish(error instanceof ApiError && error.kind === 'cancelled' ? 'cancelled' : 'error', uncertain ? `${mutation === 'save' ? 'Save' : 'Delete'} was not confirmed. The backend may have completed it. Refresh before deliberate retry; Save retries use the same approved request ID.` : error instanceof ApiError && error.status === 404 ? 'Checkpoint or snapshot is no longer available. Refresh Saved Tasks.' : error instanceof ApiError && error.status ? `Checkpoint request rejected (HTTP ${error.status}). Refresh or review the approved input.` : 'Checkpoint request failed. Check the trusted repository and backend, then retry deliberately.');
  }
  async prepare(): Promise<RepositoryBinding | undefined> {
    if (this.disposed || this.writing) return; let p: Pending | undefined;
    try { this.contextChanged(); const binding = this.guard(); p = this.begin(binding); this.publish('loading', 'Checking local checkpoint availability…'); if (!await this.enabled(p)) return; this.publish('ready', 'Review user-authored notes and references before saving.'); return binding; }
    catch (error) { this.fail(error, p); } finally { if (this.pending === p) this.pending = undefined; }
  }
  async refresh(offset = 0): Promise<void> {
    if (this.disposed) return;
    if (this.writing) { const before = key(this.env.binding()); await this.writing; if (this.disposed || before !== key(this.env.binding())) return; if (this.value.status === 'ready' && this.value.page) return; }
    let p: Pending | undefined;
    try { this.contextChanged(); p = this.begin(this.guard()); this.publish('loading', 'Loading saved tasks from backend persistence…'); if (!await this.enabled(p)) return;
      const page = await this.api.listCheckpoints(p.binding, 10, offset, p.controller.signal); this.ensure(p); this.value.page = page; this.publish('ready', page.items.length ? 'Saved tasks from this repository. Notes are user-authored.' : 'No saved task checkpoints yet.');
    } catch (error) { this.fail(error, p); } finally { if (this.pending === p) this.pending = undefined; }
  }
  async save(binding: RepositoryBinding, raw: CheckpointInput): Promise<void> {
    if (this.disposed) return; if (this.writing) { await this.writing; return; }
    this.writing = this.writeSave(binding, raw); try { await this.writing; } finally { this.writing = undefined; }
  }
  private async writeSave(binding: RepositoryBinding, raw: CheckpointInput): Promise<void> {
    let p: Pending | undefined;
    try { this.guard(binding); const input = validateCheckpointInput(raw, binding); p = this.begin(binding); this.publish('saving', 'Saving only the approved notes, Git metadata and reference IDs…'); if (!await this.enabled(p)) return;
      const detail = await this.api.createCheckpoint(binding, input, p.controller.signal); this.ensure(p); this.value.detail = detail; this.value.resume = undefined; this.value.viewId = `checkpoint-${++this.serial}`;
      this.publish('ready', 'Checkpoint saved. Backend persistence confirmed.');
      try { const page = await this.api.listCheckpoints(binding, 10, 0, p.controller.signal); this.ensure(p); this.value.page = page; this.publish('ready', 'Checkpoint saved. Backend persistence confirmed.'); } catch { this.ensure(p); this.publish('ready', 'Checkpoint saved; refresh Saved Tasks when the backend is available.'); }
    } catch (error) { this.fail(error, p, 'save'); } finally { if (this.pending === p) this.pending = undefined; }
  }
  private async read(id: string, resume: boolean): Promise<void> {
    if (this.disposed) return; if (this.writing) await this.writing; let p: Pending | undefined;
    try { this.contextChanged(); p = this.begin(this.guard()); if (this.value.detail?.checkpoint.id !== id) this.value.detail = undefined; this.value.resume = undefined; this.value.viewId = `checkpoint-${++this.serial}`; this.publish('loading', resume ? 'Reconstructing saved context from backend evidence…' : 'Loading original checkpoint details…'); if (!await this.enabled(p)) return;
      if (resume) { const result = await this.api.resumeCheckpoint(p.binding, id, this.env.local(), p.controller.signal); this.ensure(p); this.value.resume = result; this.value.detail = result.detail; }
      else { const detail = await this.api.checkpoint(p.binding, id, p.controller.signal); this.ensure(p); this.value.detail = detail; }
      this.value.viewId = `checkpoint-${++this.serial}`; this.publish('ready', 'Original user notes restored. No files, branches or saved workspace bindings were changed.');
    } catch (error) { this.fail(error, p); } finally { if (this.pending === p) this.pending = undefined; }
  }
  async view(id: string): Promise<void> { await this.read(id, false); }
  async resume(id: string): Promise<void> { await this.read(id, true); }
  async delete(id: string, viewId: string): Promise<void> {
    if (this.disposed || this.writing) return;
    if (viewId !== this.value.viewId) throw new Error('This saved-task action is stale. Refresh Saved Tasks.');
    const binding = this.guard(this.value.binding);
    this.writing = (async () => {
      const p = this.begin(binding); this.publish('saving', 'Deleting only the confirmed checkpoint…');
      try { if (!await this.enabled(p)) return; await this.api.deleteCheckpoint(binding, id, p.controller.signal); this.ensure(p);
        if (this.value.detail?.checkpoint.id === id) { this.value.detail = undefined; this.value.resume = undefined; }
        this.value.viewId = `checkpoint-${++this.serial}`;
        const page = await this.api.listCheckpoints(binding, 10, 0, p.controller.signal); this.ensure(p); this.value.page = page; this.publish('ready', 'Checkpoint deleted. Repository snapshots and other saved tasks remain.');
      } catch (error) { this.fail(error, p, 'delete'); } finally { if (this.pending === p) this.pending = undefined; }
    })(); try { await this.writing; } finally { this.writing = undefined; }
  }
  current(viewId: string): CheckpointState & { binding: RepositoryBinding; detail: CheckpointDetail } {
    if (!this.value.detail || !this.value.binding || viewId !== this.value.viewId) throw new Error('This checkpoint action is stale. Resume the intended task.'); this.guard(this.value.binding); return this.value as CheckpointState & { binding: RepositoryBinding; detail: CheckpointDetail };
  }
  resetIdentity(): void {
    this.pending?.controller.abort(); this.pending = undefined; this.recovery = undefined;
    this.value = { status: 'idle', message: 'Account changed. Refresh Saved Tasks.', viewId: `checkpoint-${++this.serial}` };
    for (const listener of this.listeners) listener();
  }
  contextChanged(): void {
    if (!this.value.binding) return; try {
      this.guard(this.value.binding);
      const recovery = this.recovery; this.recovery = undefined;
      if (recovery) this.publish(recovery.status, recovery.message);
      return;
    } catch { /* Invalidate all private context on a connection switch. */ }
    this.pending?.controller.abort(); this.pending = undefined;
    let recoverable = false;
    try { recoverable = !this.disposed && this.env.trusted() && this.value.binding.backendUrl === this.api.backendIdentity && key(this.env.recoverableBinding?.()) === key(this.value.binding); } catch { /* Invalid configuration is a real context change. */ }
    if (recoverable) {
      this.recovery ??= ['loading', 'saving'].includes(this.value.status) ? { status: 'cancelled', message: 'Connection revalidated. The interrupted request may need an explicit Refresh or retry; in-flight writes may have completed.' } : { status: this.value.status, message: this.value.message };
      this.publish('error', 'Repository connection is being revalidated or is offline. Your draft is retained; check the connection before retrying.'); return;
    }
    this.recovery = undefined;
    this.value = { status: 'idle', message: '', viewId: `checkpoint-${++this.serial}` }; this.publish('idle', 'Repository context changed. Refresh saved tasks for this connection.');
  }
  cancel(): void { this.recovery = undefined; this.pending?.controller.abort(); this.pending = undefined; this.publish('cancelled', 'Request cancelled. If Save or Delete was in flight, its outcome is uncertain; Refresh before deliberate retry.'); }
  dispose(): void { this.disposed = true; this.recovery = undefined; this.pending?.controller.abort(); this.pending = undefined; this.listeners.clear(); this.value = { status: 'idle', message: '', viewId: '' }; }
}
