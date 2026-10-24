import { type MentorApi } from './api-client/client';
import type { HandoffCapability, HandoffInput, HandoffPage, HandoffPreview, HandoffSelection, SavedHandoff } from './api-client/handoffContracts';
import type { RepositoryBinding } from './repository';
export interface HandoffState {
    status: 'idle' | 'loading' | 'ready' | 'saving' | 'disabled' | 'error' | 'cancelled';
    message: string;
    viewId: string;
    binding?: RepositoryBinding;
    contextBinding?: RepositoryBinding;
    capability?: HandoffCapability;
    preview?: HandoffPreview;
    detail?: SavedHandoff;
    page?: HandoffPage;
}
interface Environment {
    binding(): RepositoryBinding | undefined;
    recoverableBinding?(): RepositoryBinding | undefined;
    trusted(): boolean;
}
type Api = Pick<MentorApi, 'backendIdentity' | 'handoffCapability' | 'previewHandoff' | 'createHandoff' | 'listHandoffs' | 'handoff' | 'exportHandoff' | 'deleteHandoff'>;
const key = (b: RepositoryBinding | undefined) => b && JSON.stringify([b.backendUrl, b.workspaceUri, b.snapshotId, b.repositoryIdentity, b.indexedCommit, b.connectedAt]);
/** Transient UI coordination only. Evidence, Markdown, validation and persistence belong to backend. */
export class HandoffController {
    private value: HandoffState = { status: 'idle', message: 'Local handoff preparation requires explicit backend enablement.', viewId: 'handoff-0' };
    private serial = 0;
    private listeners = new Set<() => void>();
    private pending?: AbortController;
    private writing?: Promise<void>;
    private disposed = false;
    private recovery?: Pick<HandoffState, 'status' | 'message'>;
    constructor(private readonly api: Api, private readonly env: Environment) { }
    get state(): HandoffState { return { ...this.value }; }
    onChange(listener: () => void) { this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } }; }
    private publish(status: HandoffState['status'], message: string) { if (this.disposed)
        return; this.value.status = status; this.value.message = message; for (const l of this.listeners)
        l(); }
    private guard() { const b = this.env.binding(); if (this.disposed || !this.env.trusted() || !b || b.backendUrl !== this.api.backendIdentity || this.value.binding && key(b) !== key(this.value.binding))
        throw new Error('Context unavailable'); return b; }
    private begin() { this.pending?.abort(); const c = new AbortController(); this.pending = c; return c; }
    private ensure(c: AbortController) { if (this.pending !== c || c.signal.aborted)
        throw new Error('Obsolete request'); this.guard(); }
    private async enabled(c: AbortController) { const capability = await this.api.handoffCapability(c.signal); this.ensure(c); this.value.capability = capability; if (!capability.enabled) {
        this.value.preview = undefined;
        this.value.detail = undefined;
        this.value.page = undefined;
        this.publish('disabled', 'Handoffs are disabled. Deliberately enable CODEBASE_MENTOR_LOCAL_HANDOFFS=1 on the direct loopback backend. No authenticated sharing is provided.');
    } return capability.enabled; }
    private fail(c: AbortController | undefined, mutation = false) { if (this.disposed || c && c !== this.pending)
        return; this.publish('error', mutation ? 'Save/Delete was not confirmed; the backend may have completed it. Refresh before deliberate retry. Identical Save retries retain the approved request ID.' : 'Handoff request failed. Check the trusted repository, backend capability and current context, then retry deliberately.'); }
    async prepare(target: RepositoryBinding): Promise<boolean> { if (this.writing || this.disposed)
        return false; this.contextChanged(); let c: AbortController | undefined; try {
        const anchor = this.env.binding();
        if (!anchor || target.backendUrl !== anchor.backendUrl || target.workspaceUri !== anchor.workspaceUri)
            throw new Error();
        this.value.binding = anchor;
        this.guard();
        c = this.begin();
        this.publish('loading', 'Checking local handoff capability…');
        if (!await this.enabled(c))
            return false;
        this.value.contextBinding = target;
        this.value.preview = undefined;
        this.value.detail = undefined;
        this.value.viewId = `handoff-${++this.serial}`;
        this.publish('ready', 'Compose locally. Build Preview explicitly sends the displayed fields to the shown backend.');
        return true;
    }
    catch {
        this.fail(c);
        return false;
    } }
    async preview(target: RepositoryBinding, input: HandoffInput, selection?: HandoffSelection): Promise<void> { if (this.writing || this.disposed)
        return; let c: AbortController | undefined; try {
        this.guard();
        if (key(target) !== key(this.value.contextBinding))
            throw new Error();
        c = this.begin();
        this.value.preview = undefined;
        this.publish('loading', 'Building bounded context from existing backend evidence…');
        if (!await this.enabled(c))
            return;
        const result = await this.api.previewHandoff(target, input, selection, c.signal);
        this.ensure(c);
        this.value.preview = result;
        this.value.detail = undefined;
        this.value.viewId = `handoff-${++this.serial}`;
        this.publish('ready', 'Review the exact Markdown and evidence. Save only after confirming this content.');
    }
    catch {
        this.fail(c);
    } }
    async save(requestId: string): Promise<void> { if (this.disposed)
        return; if (this.writing) {
        await this.writing;
        return;
    } this.writing = this.writeSave(requestId); try {
        await this.writing;
    }
    finally {
        this.writing = undefined;
    } }
    private async writeSave(requestId: string) { let c: AbortController | undefined; try {
        this.guard();
        const preview = this.value.preview, binding = this.value.contextBinding;
        if (this.value.status !== 'ready' || !preview || !binding)
            throw new Error();
        c = this.begin();
        this.publish('saving', 'Saving the reviewed package to the shared backend…');
        if (!await this.enabled(c))
            return;
        const saved = await this.api.createHandoff(binding, { requestId, input: preview.input, selection: preview.selection, digest: preview.digest }, c.signal);
        this.ensure(c);
        if (saved.markdown !== preview.markdown || saved.digest !== preview.digest || JSON.stringify(saved.context) !== JSON.stringify(preview.context))
            throw new Error('Approval mismatch');
        this.value.detail = saved;
        this.value.preview = undefined;
        this.value.viewId = `handoff-${++this.serial}`;
        this.publish('ready', 'Handoff saved locally. Nothing was delivered or shared.');
        try {
            const page = await this.api.listHandoffs(this.value.binding!, 10, 0, c.signal);
            this.ensure(c);
            this.value.page = page;
            this.publish('ready', 'Handoff saved locally. Nothing was delivered or shared.');
        }
        catch {
            this.ensure(c);
        }
    }
    catch {
        this.fail(c, true);
    } }
    async refresh(offset = 0): Promise<void> { if (this.disposed)
        return; if (this.writing) {
        await this.writing;
        return;
    } this.contextChanged(); let c: AbortController | undefined; try {
        const b = this.guard();
        this.value.binding = b;
        c = this.begin();
        this.publish('loading', 'Loading saved handoffs…');
        if (!await this.enabled(c))
            return;
        const page = await this.api.listHandoffs(b, 10, offset, c.signal);
        this.ensure(c);
        this.value.page = page;
        this.publish('ready', page.items.length ? 'Saved local handoffs. Export does not establish delivery.' : 'No saved handoffs yet.');
    }
    catch {
        this.fail(c);
    } }
    async open(id: string): Promise<void> { if (this.disposed || this.writing)
        return; this.contextChanged(); let c: AbortController | undefined; try {
        const b = this.guard();
        this.value.binding = b;
        c = this.begin();
        this.publish('loading', 'Opening original approved handoff…');
        if (!await this.enabled(c))
            return;
        const detail = await this.api.handoff(b, id, c.signal);
        this.ensure(c);
        this.value.contextBinding = { ...b, snapshotId: detail.context.snapshotId, repositoryIdentity: detail.context.repositoryIdentity, indexedCommit: detail.context.indexedCommit };
        this.value.detail = detail;
        this.value.preview = undefined;
        this.value.viewId = `handoff-${++this.serial}`;
        this.publish('ready', 'Original reviewed handoff. Ready for explicit local copy/export.');
    }
    catch {
        this.fail(c);
    } }
    current(viewId: string) { this.guard(); if (viewId !== this.value.viewId || !this.value.detail || !this.value.contextBinding || !this.value.binding)
        throw new Error('Stale handoff'); return this.value as HandoffState & {
        detail: SavedHandoff;
        contextBinding: RepositoryBinding;
        binding: RepositoryBinding;
    }; }
    async export(viewId: string): Promise<string> { const state = this.current(viewId); const c = this.begin(); const result = await this.api.exportHandoff(state.detail.context.repositoryIdentity === state.binding.repositoryIdentity ? state.binding : state.contextBinding, state.detail.id, c.signal); this.ensure(c); this.current(viewId); if (result.markdown !== state.detail.markdown || result.digest !== state.detail.digest)
        throw new Error('Export differs from approved content'); return result.markdown; }
    async delete(id: string, viewId: string): Promise<void> { if (this.disposed || this.writing)
        return; if (viewId !== this.value.viewId)
        throw new Error('Stale handoff'); const b = this.guard(); this.writing = (async () => { let c: AbortController | undefined; try {
        c = this.begin();
        this.publish('saving', 'Deleting only the confirmed handoff…');
        if (!await this.enabled(c))
            return;
        await this.api.deleteHandoff(this.value.detail?.id === id && this.value.detail.context.repositoryIdentity !== b.repositoryIdentity ? this.value.contextBinding! : b, id, c.signal);
        this.ensure(c);
        if (this.value.detail?.id === id) {
            this.value.detail = undefined;
            this.value.preview = undefined;
        }
        this.value.viewId = `handoff-${++this.serial}`;
        this.value.page = await this.api.listHandoffs(b, 10, 0, c.signal);
        this.ensure(c);
        this.publish('ready', 'Handoff deleted. Checkpoints and repository snapshots remain.');
    }
    catch {
        this.fail(c, true);
    } })(); try {
        await this.writing;
    }
    finally {
        this.writing = undefined;
    } }
    notifyExport(kind: 'copy' | 'file') { this.publish('ready', kind === 'copy' ? 'Reviewed Markdown copied locally. Delivery is your choice.' : 'Reviewed Markdown exported locally. Delivery is your choice.'); }
    contextChanged() { if (!this.value.binding)
        return; try {
        this.guard();
        const recovery = this.recovery; this.recovery = undefined;
        if (recovery) this.publish(recovery.status, recovery.message);
        return;
    }
    catch { } this.pending?.abort(); this.pending = undefined;
    let recoverable = false;
    try { recoverable = !this.disposed && this.env.trusted() && this.value.binding.backendUrl === this.api.backendIdentity && key(this.env.recoverableBinding?.()) === key(this.value.binding); } catch { /* Invalid configuration is a real context change. */ }
    if (recoverable) {
        this.recovery ??= ['loading', 'saving'].includes(this.value.status) ? { status: 'cancelled', message: 'Connection revalidated. The interrupted request may need an explicit Refresh or retry; in-flight writes may have completed.' } : { status: this.value.status, message: this.value.message };
        this.publish('error', 'Repository connection is being revalidated or is offline. Your draft is retained; check the connection before retrying.'); return;
    }
    this.recovery = undefined;
    this.value = { status: 'idle', message: 'Repository context changed. Refresh handoffs for this connection.', viewId: `handoff-${++this.serial}` }; this.publish('idle', this.value.message); }
    cancel() { this.recovery = undefined; this.pending?.abort(); this.pending = undefined; this.publish('cancelled', 'Request cancelled. In-flight saves may have completed; refresh before retry.'); }
    dispose() { this.disposed = true; this.recovery = undefined; this.pending?.abort(); this.pending = undefined; this.listeners.clear(); this.value = { status: 'idle', message: '', viewId: '' }; }
}
