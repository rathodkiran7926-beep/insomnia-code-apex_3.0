import { ApiError, type MentorApi } from './api-client/client';
import { parsePrUrl, type PullRequest, type PullRequestPage, type PrJob, type PrComparison } from './api-client/prContracts';
import type { RepositoryBinding } from './repository';

export interface PrState {
  status: 'idle' | 'listing' | 'selected' | 'starting' | 'running' | 'ready' | 'error' | 'cancelled';
  message: string; viewId: string; binding?: RepositoryBinding; page?: PullRequestPage;
  selected?: PullRequest; manual?: boolean; job?: PrJob; comparison?: PrComparison;
}
interface Environment { trusted(): boolean; binding(): RepositoryBinding | undefined; wait?(ms: number, signal: AbortSignal): Promise<void>; now?(): number }
const key = (b: RepositoryBinding | undefined) => b && JSON.stringify([b.backendUrl, b.workspaceUri, b.snapshotId, b.repositoryIdentity, b.indexedCommit, b.connectedAt]);
interface Pending { controller: AbortController; binding: RepositoryBinding; url?: string }
const delay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new ApiError('cancelled', 'Local waiting stopped.')); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
});

/** UI/session state only; discovery, comparison, graph impact and persistence are server-owned. */
export class PrController {
  private listeners = new Set<() => void>();
  private pending?: Pending;
  private disposed = false;
  private serial = 0;
  private value: PrState = { status: 'idle', message: 'Connect a repository, then discover pull requests.', viewId: 'pr-0' };
  constructor(private readonly api: Pick<MentorApi, 'backendIdentity' | 'listPullRequests' | 'startPrAnalysis' | 'prJob' | 'prComparison'>, private readonly env: Environment) {}
  get state(): PrState { return { ...this.value }; }
  onChange(listener: () => void) { this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } }; }
  private publish(status: PrState['status'], message: string): void {
    if (this.disposed) return; this.value.status = status; this.value.message = message;
    for (const listener of this.listeners) listener();
  }
  private binding(): RepositoryBinding {
    const binding = this.env.binding();
    if (this.disposed || !this.env.trusted() || !binding || binding.backendUrl !== this.api.backendIdentity) throw new Error('Connect a repository snapshot before opening PR Changes.');
    return binding;
  }
  private ensure(p: Pending): void {
    if (this.pending !== p || p.controller.signal.aborted || key(this.binding()) !== key(p.binding) || p.url && this.value.selected?.url !== p.url) throw new ApiError('cancelled', 'PR context changed.');
  }
  private begin(binding: RepositoryBinding, url?: string): Pending {
    this.pending?.controller.abort(); const p = { controller: new AbortController(), binding, url }; this.pending = p; return p;
  }
  private failure(error: unknown, p?: Pending): void {
    if (this.disposed || p && this.pending !== p) return;
    this.publish(error instanceof ApiError && error.kind === 'cancelled' ? 'cancelled' : 'error', error instanceof ApiError && error.status === 429 ? 'Rate limit or worker capacity (429). Retry explicitly after waiting; no new job was retried automatically.' : error instanceof Error ? error.message : 'PR request failed. Refresh or resume when ready.');
  }
  async open(): Promise<void> { if (this.disposed) return; this.contextChanged(); if (!this.value.page && !this.pending) await this.refreshList(); }
  async refreshList(state: 'open' | 'closed' | 'all' = this.value.page?.state ?? 'all', page = 1): Promise<void> {
    if (this.disposed) return; let p: Pending | undefined;
    try {
      const binding = this.binding(); this.contextChanged(); this.value.binding = binding;
      p = this.begin(binding); this.publish('listing', 'Loading remote pull requests from the shared backend…');
      const data = await this.api.listPullRequests(binding, state, page, p.controller.signal); this.ensure(p);
      this.value.page = data; this.publish(this.value.comparison ? 'ready' : this.value.selected ? 'selected' : 'idle', data.pullRequests.length ? 'Remote PRs are not automatically associated with the local branch or uncommitted changes.' : 'No pull requests found for this filter. Enter a PR URL or change the filter.');
    } catch (error) { this.failure(error, p); } finally { if (this.pending === p) this.pending = undefined; }
  }
  async nextPage(): Promise<void> { const page = this.value.page; if (page?.hasMore && page.page < 100) await this.refreshList(page.state, page.page + 1); }
  async previousPage(): Promise<void> { const page = this.value.page; if (page && page.page > 1) await this.refreshList(page.state, page.page - 1); }
  select(input: PullRequest | string): void {
    this.contextChanged();
    const binding = this.binding(); const parsed = parsePrUrl(typeof input === 'string' ? input : input.url, binding.repositoryIdentity);
    if (this.value.selected?.url === parsed.url && key(this.value.binding) === key(binding)) return;
    this.pending?.controller.abort(); this.pending = undefined;
    this.value = { ...this.value, binding, selected: typeof input === 'string' ? { number: parsed.number, url: parsed.url, title: `PR #${parsed.number} · metadata loads during analysis`, state: 'open', draft: false, merged: false, head: '', base: '', updatedAt: '' } : input,
      manual: typeof input === 'string', job: undefined, comparison: undefined, viewId: `pr-${++this.serial}`, status: 'selected', message: '' };
    this.publish('selected', 'Remote PR selected manually. Start analysis explicitly; local branch association is unverified.');
  }
  async start(): Promise<void> {
    if (this.disposed || this.pending || this.value.comparison) return;
    if (this.value.job?.status === 'running') { await this.resume(); return; }
    let p: Pending | undefined;
    try {
      const binding = this.binding(); const selected = this.value.selected;
      if (!selected || key(binding) !== key(this.value.binding)) throw new Error('Select a pull request in the current repository first.');
      p = this.begin(binding, selected.url); this.publish('starting', 'Starting backend comparison once…');
      const { id } = await this.api.startPrAnalysis(selected.url, binding.repositoryIdentity, p.controller.signal); this.ensure(p);
      this.value.job = { id, status: 'running', progress: 0, message: 'Job created; waiting for backend status.', comparison_id: null, url: selected.url };
      await this.poll(p, id);
    } catch (error) { this.failure(error, p); } finally { if (this.pending === p) this.pending = undefined; }
  }
  async reanalyze(): Promise<void> {
    if (this.disposed || this.pending || !this.value.selected) return;
    this.value.comparison = undefined; this.value.job = undefined; this.value.viewId = `pr-${++this.serial}`;
    this.publish('selected', 'Starting a new comparison by explicit request.'); await this.start();
  }
  async reviewStored(expected: { id: string; prUrl: string; beforeSnapshotId: string; afterSnapshotId: string }): Promise<void> {
    if (this.disposed) return;
    if (this.pending) this.cancel();
    this.select(expected.prUrl); this.value.job = undefined; let p: Pending | undefined;
    try {
      const binding = this.binding(); p = this.begin(binding, this.value.selected!.url);
      const result = await this.api.prComparison(expected.id, binding.repositoryIdentity, this.value.selected!.url, p.controller.signal); this.ensure(p);
      if (result.beforeSnapshotId !== expected.beforeSnapshotId || result.afterSnapshotId !== expected.afterSnapshotId) throw new Error('Stored comparison versions do not match the saved task context.');
      this.value.comparison = result; this.value.viewId = `pr-${++this.serial}`; this.publish('ready', 'Existing stored comparison for the saved/current snapshots. No new analysis was started.');
    } catch (error) { this.failure(error, p); } finally { if (this.pending === p) this.pending = undefined; }
  }
  private async poll(p: Pending, id: string): Promise<void> {
    const now = this.env.now ?? (() => performance.now()); const deadline = now() + 360000;
    const expired = () => { if (now() >= deadline) throw new Error('Stopped local waiting after six minutes. The backend job may continue; resume its existing job ID.'); };
    for (let count = 0; count < 240; count++) {
      expired(); const job = await this.api.prJob(id, p.controller.signal); this.ensure(p); expired();
      if (job.id !== id || job.url && parsePrUrl(job.url, p.binding.repositoryIdentity).url !== p.url) throw new Error('Backend job does not belong to the selected PR.');
      this.value.job = job; this.publish('running', job.message);
      if (job.status === 'failed') throw new Error(job.message || 'Backend comparison failed. Start a new analysis explicitly.');
      if (job.status === 'complete') {
        if (!job.comparison_id) throw new Error('Completed job has no comparison_id. Refresh or resume this job.');
        await this.loadComparison(p, job.comparison_id); return;
      }
      await (this.env.wait ?? delay)(1500, p.controller.signal); this.ensure(p);
    }
    throw new Error('Stopped local waiting after six minutes. The backend job may continue; resume its existing job ID.');
  }
  private async loadComparison(p: Pending, id: string): Promise<void> {
    const comparison = await this.api.prComparison(id, p.binding.repositoryIdentity, p.url!, p.controller.signal); this.ensure(p);
    this.value.comparison = comparison; this.value.viewId = `pr-${++this.serial}`;
    this.publish('ready', 'Stored remote comparison · Potential Impact — Static Analysis. Setup has not been executed.');
  }
  async resume(): Promise<void> {
    if (this.disposed || this.pending || !this.value.job) return; let p: Pending | undefined;
    try { const binding = this.binding(); if (key(binding) !== key(this.value.binding) || !this.value.selected) throw new Error('This job belongs to a changed repository context.'); p = this.begin(binding, this.value.selected.url); await this.poll(p, this.value.job.id); }
    catch (error) { this.failure(error, p); } finally { if (this.pending === p) this.pending = undefined; }
  }
  async refreshComparison(): Promise<void> {
    if (this.disposed || this.pending) return;
    if (!this.value.comparison) { await this.resume(); return; }
    let p: Pending | undefined;
    try { const binding = this.binding(); if (key(binding) !== key(this.value.binding)) throw new Error('Reconnect this comparison repository.'); p = this.begin(binding, this.value.selected?.url); await this.loadComparison(p, this.value.comparison.id); }
    catch (error) { this.failure(error, p); } finally { if (this.pending === p) this.pending = undefined; }
  }
  current(viewId: string): PrState & { binding: RepositoryBinding; comparison: PrComparison } {
    if (!this.value.comparison || !this.value.binding || viewId !== this.value.viewId || key(this.binding()) !== key(this.value.binding)) throw new Error('This Changes item is stale. Refresh the selected comparison.');
    return this.value as PrState & { binding: RepositoryBinding; comparison: PrComparison };
  }
  cancel(): void { this.pending?.controller.abort(); this.pending = undefined; this.publish('cancelled', 'Stopped local waiting only. The backend job may continue; Resume uses its existing job ID when available.'); }
  setVisible(visible: boolean): void { if (!visible && this.pending) this.cancel(); }
  contextChanged(): void {
    if (!this.value.binding) return;
    try { if (key(this.binding()) === key(this.value.binding)) return; } catch { /* Clear obsolete repository state. */ }
    this.pending?.controller.abort(); this.pending = undefined;
    this.value = { status: 'idle', message: '', viewId: `pr-${++this.serial}` }; this.publish('idle', 'Repository context changed. Discover PRs for the connected snapshot.');
  }
  dispose(): void { this.disposed = true; this.pending?.controller.abort(); this.pending = undefined; this.listeners.clear(); this.value = { status: 'idle', message: 'Disposed', viewId: '' }; }
}
