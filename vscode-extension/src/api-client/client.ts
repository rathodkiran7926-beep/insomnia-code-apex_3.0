import { isDeepStrictEqual } from 'node:util';
import { validateHandoffInput, validateHandoffSelection, validateHandoffPreview, validateSavedHandoff, validateHandoffCapability, validateHandoffPage, validateHandoffExport, validateHandoffDeletion, validateHandoffRecordId, validateHandoffDigest, type HandoffInput, type HandoffSelection, type HandoffPreview, type SavedHandoff, type HandoffCapability, type HandoffPage } from './handoffContracts';
import { validateSnapshot, validSnapshotId, normalizeGithubRemote, type SnapshotMetadata, type RepositoryBinding } from '../repository';
import { parsePrUrl, validatePullRequestPage, validatePrJob, validatePrComparison, type PrState, type PullRequestPage, type PrJob, type PrComparison } from './prContracts';
import { validateNeighborhood, validComponentId, type Neighborhood } from './atlasContracts';
import { validateRepositoryGraph, type RepositoryGraph } from './repositoryGraph';
import { validateEvidence, validateResolution, validateMentorAnswer, validateSource, safeSourcePath, type SnapshotEvidence, type Resolution, type MentorAnswer, type PinnedSource, type SourceReference } from './mentorContracts';
import { validateCheckpointBinding, validateCheckpointCapability, validateCheckpointInput, validateCheckpointDetail, validateCheckpointPage, validateCheckpointResume, validateCheckpointDeletion, validateLocalCheckpointContext, type CheckpointCapability, type CheckpointInput, type CheckpointDetail, type CheckpointPage, type CheckpointResume, type LocalCheckpointContext } from './checkpointContracts';

export type ApiErrorKind = 'configuration' | 'http' | 'response' | 'network' | 'timeout' | 'cancelled';

export class ApiError extends Error {
  constructor(readonly kind: ApiErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface HealthResponse { ok: true }

interface ClientOptions {
  timeoutMs?: number;
  // Authentication cookies are supplied by the host from SecretStorage.
  authenticated?: () => boolean;
  headers?: () => HeadersInit;
}

function backendUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new ApiError('configuration', 'Enter a valid backend URL in Codebase Mentor settings.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
      url.username || url.password || url.search || url.hash) {
    throw new ApiError('configuration', 'Use loopback HTTP or HTTPS without credentials, a query, or a fragment.');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function destination(base: URL, path: string): URL {
  // API paths are caller-owned, never arbitrary links supplied by backend content.
  if (!path.startsWith('/api/') || /[\\#\s]/.test(path) ||
      /(?:^|\/)(?:\.|%2e){1,2}(?:\/|\?|$)/i.test(path) || /%2f|%5c/i.test(path)) {
    throw new ApiError('configuration', 'Expected a safe /api/ endpoint path.');
  }
  const url = new URL(path.slice(1), base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new ApiError('configuration', 'Unexpected API destination.');
  }
  return url;
}

export class MentorApi {
  constructor(private readonly baseUrl: () => string, private readonly options: ClientOptions = {}) {}

  get backendIdentity(): string { return backendUrl(this.baseUrl()).href; }

  private readonly handoffApprovals = new Map<string, HandoffPreview>();
  private handoffConfiguration<T>(binding: RepositoryBinding | undefined, action: () => T): T {
    try { if (binding) { validateCheckpointBinding(binding); if (binding.backendUrl !== undefined && new URL(binding.backendUrl).href !== this.backendIdentity) throw new Error(); } return action(); }
    catch { throw new ApiError('configuration', 'Invalid handoff request or repository context.'); }
  }
  private handoffKey(binding: RepositoryBinding, digest: string): string { return JSON.stringify([this.backendIdentity,binding.repositoryIdentity,binding.snapshotId,binding.indexedCommit.toLowerCase(),digest]); }
  async handoffCapability(signal?: AbortSignal): Promise<HandoffCapability> {
    return this.parse(await this.request('GET','/api/ide/handoffs/capabilities',undefined,signal,this.options.timeoutMs ?? 10000,256000,true),validateHandoffCapability);
  }
  async previewHandoff(binding: RepositoryBinding,input:HandoffInput,selection?:HandoffSelection,signal?:AbortSignal):Promise<HandoffPreview> {
    const approved=this.handoffConfiguration(binding,()=>{ const result={input:validateHandoffInput(input,binding),...(selection!==undefined?{selection:validateHandoffSelection(selection)}:{})};if(Buffer.byteLength(JSON.stringify(result),'utf8')>24576)throw new Error();return result; });
    const preview=this.parse(await this.request('POST','/api/ide/handoffs/preview',approved,signal,this.options.timeoutMs ?? 10000,256000,true),value=>validateHandoffPreview(value,binding,approved.input,approved.selection));
    const key=this.handoffKey(binding,preview.digest);this.handoffApprovals.delete(key);this.handoffApprovals.set(key,structuredClone(preview));while(this.handoffApprovals.size>3)this.handoffApprovals.delete(this.handoffApprovals.keys().next().value!);return preview;
  }
  async createHandoff(binding:RepositoryBinding,request:{requestId:string;input:HandoffInput;selection:HandoffSelection;digest:string},signal?:AbortSignal):Promise<SavedHandoff> {
    const {body,preview}=this.handoffConfiguration(binding,()=>{if(Object.keys(request).some(key=>!['requestId','input','selection','digest'].includes(key)))throw new Error();const body={requestId:validateHandoffRecordId(request.requestId),input:validateHandoffInput(request.input,binding),selection:validateHandoffSelection(request.selection),digest:validateHandoffDigest(request.digest)};const preview=this.handoffApprovals.get(this.handoffKey(binding,body.digest));if(!preview||!isDeepStrictEqual(preview.input,body.input)||!isDeepStrictEqual(preview.selection,body.selection)||Buffer.byteLength(JSON.stringify(body),'utf8')>24576)throw new Error();return {body,preview};});
    return this.parse(await this.request('POST','/api/ide/handoffs',body,signal,this.options.timeoutMs ?? 10000,256000,true),value=>validateSavedHandoff(value,binding,undefined,preview));
  }
  async listHandoffs(binding:RepositoryBinding,limit=10,offset=0,signal?:AbortSignal):Promise<HandoffPage> {
    this.handoffConfiguration(binding,()=>{if(!Number.isSafeInteger(limit)||limit<1||limit>25||!Number.isSafeInteger(offset)||offset<0||offset>10000)throw new Error();});
    return this.parse(await this.request('GET',`/api/ide/handoffs?snapshotId=${binding.snapshotId}&limit=${limit}&offset=${offset}`,undefined,signal,this.options.timeoutMs ?? 10000,256000,true),value=>validateHandoffPage(value,binding,limit,offset));
  }
  async handoff(binding:RepositoryBinding,id:string,signal?:AbortSignal):Promise<SavedHandoff> {
    this.handoffConfiguration(binding,()=>validateHandoffRecordId(id));return this.parse(await this.request('GET',`/api/ide/handoffs/${id}?snapshotId=${binding.snapshotId}`,undefined,signal,this.options.timeoutMs ?? 10000,256000,true),value=>validateSavedHandoff(value,binding,id));
  }
  async exportHandoff(binding:RepositoryBinding,id:string,signal?:AbortSignal):Promise<{id:string;markdown:string;digest:string}> {
    this.handoffConfiguration(binding,()=>validateHandoffRecordId(id));return this.parse(await this.request('GET',`/api/ide/handoffs/${id}/export?snapshotId=${binding.snapshotId}`,undefined,signal,this.options.timeoutMs ?? 10000,256000,true),value=>validateHandoffExport(value,id));
  }
  async deleteHandoff(binding:RepositoryBinding,id:string,signal?:AbortSignal):Promise<{id:string;deleted:true}> {
    this.handoffConfiguration(binding,()=>validateHandoffRecordId(id));return this.parse(await this.request('DELETE',`/api/ide/handoffs/${id}?snapshotId=${binding.snapshotId}`,undefined,signal,this.options.timeoutMs ?? 10000,256000,true),value=>validateHandoffDeletion(value,id));
  }

  private checkpointConfiguration<T>(action: () => T): T {
    try { return action(); } catch { throw new ApiError('configuration', 'Invalid checkpoint request or repository context.'); }
  }
  private checkpointRoot(): string { return this.options.authenticated?.() ? '/api/ide/team/checkpoints' : '/api/ide/checkpoints'; }
  async checkpointCapability(signal?: AbortSignal): Promise<CheckpointCapability> {
    return this.parse(await this.request('GET', `${this.checkpointRoot()}/capabilities`, undefined, signal, this.options.timeoutMs ?? 10000, 64000, true), validateCheckpointCapability);
  }
  async createCheckpoint(binding: RepositoryBinding, input: CheckpointInput, signal?: AbortSignal): Promise<CheckpointDetail> {
    const approved = this.checkpointConfiguration(() => validateCheckpointInput(input, binding));
    return this.parse(await this.request('POST', `${this.checkpointRoot()}`, approved, signal, this.options.timeoutMs ?? 10000, 128000, true), value => validateCheckpointDetail(value, binding, undefined, approved));
  }
  async listCheckpoints(binding: RepositoryBinding, limit = 10, offset = 0, signal?: AbortSignal): Promise<CheckpointPage> {
    this.checkpointConfiguration(() => { validateCheckpointBinding(binding); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25 || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw new Error(); });
    return this.parse(await this.request('GET', `${this.checkpointRoot()}?snapshotId=${binding.snapshotId}&limit=${limit}&offset=${offset}`, undefined, signal, this.options.timeoutMs ?? 10000, 128000, true), value => validateCheckpointPage(value, binding, limit, offset));
  }
  async checkpoint(binding: RepositoryBinding, id: string, signal?: AbortSignal): Promise<CheckpointDetail> {
    this.checkpointConfiguration(() => { validateCheckpointBinding(binding); if (!validSnapshotId(id)) throw new Error(); });
    return this.parse(await this.request('GET', `${this.checkpointRoot()}/${id}?snapshotId=${binding.snapshotId}`, undefined, signal, this.options.timeoutMs ?? 10000, 128000, true), value => validateCheckpointDetail(value, binding, id));
  }
  async resumeCheckpoint(binding: RepositoryBinding, id: string, localContext: LocalCheckpointContext, signal?: AbortSignal): Promise<CheckpointResume> {
    const approved = this.checkpointConfiguration(() => { validateCheckpointBinding(binding); if (!validSnapshotId(id)) throw new Error(); return validateLocalCheckpointContext(localContext); });
    return this.parse(await this.request('POST', `${this.checkpointRoot()}/${id}/resume`, { currentSnapshotId: binding.snapshotId, localContext: approved }, signal, this.options.timeoutMs ?? 10000, 128000, true), value => validateCheckpointResume(value, binding, id, approved));
  }
  async deleteCheckpoint(binding: RepositoryBinding, id: string, signal?: AbortSignal): Promise<{ id: string; deleted: true }> {
    this.checkpointConfiguration(() => { validateCheckpointBinding(binding); if (!validSnapshotId(id)) throw new Error(); });
    return this.parse(await this.request('DELETE', `${this.checkpointRoot()}/${id}?snapshotId=${binding.snapshotId}`, undefined, signal, this.options.timeoutMs ?? 10000, 64000, true), value => validateCheckpointDeletion(value, id));
  }

  async listPullRequests(binding: RepositoryBinding, state: PrState = 'all', page = 1, signal?: AbortSignal): Promise<PullRequestPage> {
    if (!validSnapshotId(binding.snapshotId) || normalizeGithubRemote(binding.repositoryIdentity) !== binding.repositoryIdentity || !['open', 'closed', 'all'].includes(state) || !Number.isSafeInteger(page) || page < 1 || page > 100) throw new ApiError('configuration', 'Invalid PR repository or list filters.');
    const data = await this.request('GET', `/api/pr/pulls?snapshotId=${binding.snapshotId}&state=${state}&page=${page}`, undefined, signal, this.options.timeoutMs ?? 30000, 256000);
    return this.parse(data, value => validatePullRequestPage(value, binding.repositoryIdentity, state, page));
  }
  async startPrAnalysis(url: string, repositoryIdentity: string, signal?: AbortSignal): Promise<{ id: string }> {
    let canonical: string;
    try { canonical = parsePrUrl(url, repositoryIdentity).url; }
    catch { throw new ApiError('configuration', 'Enter a public GitHub PR URL belonging to the connected repository.'); }
    const data = await this.request('POST', '/api/pr/analyses', { url: canonical }, signal, this.options.timeoutMs ?? 10000, 64000);
    return this.parse(data, value => {
      if (!value || typeof value !== 'object' || !('id' in value) || !validSnapshotId(value.id)) throw new Error('Invalid PR analysis job ID.');
      return { id: value.id };
    });
  }
  async prJob(id: string, signal?: AbortSignal): Promise<PrJob> {
    if (!validSnapshotId(id)) throw new ApiError('configuration', 'Invalid PR analysis job ID.');
    return this.parse(await this.request('GET', `/api/pr/analyses/${id}`, undefined, signal, this.options.timeoutMs ?? 10000, 64000), value => validatePrJob(value, id));
  }
  async prComparison(id: string, repositoryIdentity: string, prUrl: string, signal?: AbortSignal): Promise<PrComparison> {
    try { if (!validSnapshotId(id)) throw new Error(); parsePrUrl(prUrl, repositoryIdentity); }
    catch { throw new ApiError('configuration', 'Invalid PR comparison identity.'); }
    return this.parse(await this.request('GET', `/api/pr/comparisons/${id}`, undefined, signal, this.options.timeoutMs ?? 10000, 8000000), value => validatePrComparison(value, id, repositoryIdentity, prUrl));
  }

  /** The full validated graph of an already analyzed snapshot, used only by the editor-tab overview. */
  async repositoryGraph(snapshotId: string, signal?: AbortSignal): Promise<RepositoryGraph> {
    if (!validSnapshotId(snapshotId)) throw new ApiError('configuration', 'Connect a valid repository snapshot first.');
    const data = await this.request('GET', `/api/snapshots/${encodeURIComponent(snapshotId)}`, undefined, signal,
      this.options.timeoutMs ?? 20000, 24_000_000);
    return this.parse(data, value => validateRepositoryGraph(value, snapshotId));
  }

  async neighborhood(snapshotId: string, componentId: string, limit = 25, signal?: AbortSignal): Promise<Neighborhood> {
    if (!validSnapshotId(snapshotId) || !validComponentId(componentId) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError('configuration', 'Invalid Atlas snapshot, component or result limit.');
    const data = await this.request('GET', `/api/ide/snapshots/${snapshotId}/components/${encodeURIComponent(componentId)}/neighborhood?limit=${limit}`, undefined, signal, this.options.timeoutMs ?? 10000, 2000000);
    return this.parse(data, value => validateNeighborhood(value, snapshotId, componentId, limit));
  }

  /** Connect accepts either the immutable snapshot ID or its completed analysis job ID.
   *  Only the connection flow resolves jobs; all saved bindings stay pinned to snapshots. */
  async snapshotForConnection(id: string, signal?: AbortSignal): Promise<SnapshotMetadata> {
    if (!validSnapshotId(id)) throw new ApiError('configuration', 'Enter a valid snapshot or analysis job ID.');
    try {
      return await this.snapshot(id, signal);
    } catch (error) {
      if (!(error instanceof ApiError) || error.kind !== 'http' || error.status !== 404) throw error;
    }
    let job: unknown;
    try {
      job = await this.get<unknown>(`/api/analyses/${encodeURIComponent(id)}`, signal);
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'http' && error.status === 404) {
        throw new ApiError('http',
          `Neither a snapshot nor an analysis job with this ID exists on ${this.backendIdentity}. ` +
          'Check that the web app and extension use the same backend and database, or analyze the repository again.', 404);
      }
      throw error;
    }
    if (!job || typeof job !== 'object' || Array.isArray(job) || !('status' in job)) {
      throw new ApiError('response', 'Backend returned an invalid analysis job.');
    }
    if (job.status === 'running') {
      throw new ApiError('response', 'Repository analysis is still running. Connect after it completes.');
    }
    if (job.status === 'failed') {
      throw new ApiError('response', 'Repository analysis failed. Check the analysis progress in the web app and retry.');
    }
    if (job.status !== 'complete' || !('snapshot_id' in job) || !validSnapshotId(job.snapshot_id)) {
      throw new ApiError('response', 'Analysis has no completed snapshot yet. Check the web app for its status.');
    }
    try {
      return await this.snapshot(job.snapshot_id, signal);
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'http' && error.status === 404) {
        throw new ApiError('http',
          `Analysis completed, but its snapshot is missing from ${this.backendIdentity}. ` +
          'Check that the web app and extension use the same backend database, or analyze the repository again.', 404);
      }
      throw error;
    }
  }

  async snapshot(id: string, signal?: AbortSignal): Promise<SnapshotMetadata> {
    if (!validSnapshotId(id)) throw new ApiError('configuration', 'Enter a snapshot ID containing 1–150 letters, digits, underscores or hyphens.');
    const data = await this.get<unknown>(`/api/snapshots/${encodeURIComponent(id)}`, signal);
    try { return validateSnapshot(data, id); }
    catch (error) { throw new ApiError('response', error instanceof Error ? error.message : 'Invalid snapshot response.'); }
  }

  private parse<T>(value: unknown, validate: (value: unknown) => T): T {
    try { return validate(value); }
    catch (error) { throw new ApiError('response', error instanceof Error ? error.message : 'Invalid backend response.'); }
  }
  async evidence(id: string, signal?: AbortSignal): Promise<SnapshotEvidence> {
    if (!validSnapshotId(id)) throw new ApiError('configuration', 'Invalid snapshot ID.');
    return this.parse(await this.get(`/api/snapshots/${id}`, signal), value => validateEvidence(value, id));
  }
  async resolveSelection(evidence: SnapshotEvidence, file: string, startLine: number, endLine: number, signal?: AbortSignal): Promise<Resolution> {
    if (!safeSourcePath(file) || !Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine || endLine > 1000000 || endLine - startLine > 10000) throw new ApiError('configuration', 'Invalid selected source range.');
    const data = await this.post('/api/ide/resolve-selection', { snapshotId: evidence.snapshotId, file, startLine, endLine }, signal);
    const result = this.parse(data, value => validateResolution(value, evidence));
    if (result.candidates.some(candidate => {
      const ref = evidence.references.find(item => item.id === candidate.referenceId);
      return !ref || ref.file !== file || ref.startLine > startLine || ref.endLine < endLine;
    })) throw new ApiError('response', 'Resolver candidates do not contain the requested file and source range.');
    return result;
  }
  async question(evidence: SnapshotEvidence, componentId: string, question: string, signal?: AbortSignal): Promise<MentorAnswer> {
    if (!question.trim() || question.length > 1500 || !evidence.components.some(item => item.id === componentId)) throw new ApiError('configuration', 'Choose an indexed component and enter a question of 1–1500 characters.');
    const data = await this.request('POST', `/api/snapshots/${evidence.snapshotId}/questions`, { componentId, question }, signal, this.options.timeoutMs ?? 45000);
    return this.parse(data, value => validateMentorAnswer(value, evidence, componentId));
  }
  async source(snapshot: SnapshotMetadata, ref: SourceReference, signal?: AbortSignal): Promise<PinnedSource> {
    if (!validSnapshotId(snapshot.snapshotId) || ref.snapshotId !== snapshot.snapshotId || !safeSourcePath(ref.file) || !ref.id || ref.id.length > 200) throw new ApiError('configuration', 'Invalid indexed source identity.');
    const data = await this.request('GET', `/api/snapshots/${snapshot.snapshotId}/source?referenceId=${encodeURIComponent(ref.id)}`, undefined, signal, this.options.timeoutMs ?? 35000);
    return this.parse(data, value => validateSource(value, snapshot, ref));
  }

  get<T = unknown>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>('GET', path, undefined, signal);
  }

  post<T = unknown>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>('POST', path, body, signal);
  }

  async health(signal?: AbortSignal): Promise<HealthResponse> {
    const data = await this.get<unknown>('/api/health', signal);
    if (!data || typeof data !== 'object' || !('ok' in data) || data.ok !== true) {
      throw new ApiError('response', 'Backend health response must contain ok: true.');
    }
    return { ok: true };
  }

  private async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body: unknown, signal?: AbortSignal, timeoutMs = this.options.timeoutMs ?? 5000, maxBytes?: number, privateResponse = false): Promise<T> {
    const url = destination(backendUrl(this.baseUrl()), path);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const headers = new Headers(this.options.headers?.());
      headers.set('Accept', 'application/json');
      if (method === 'POST') headers.set('Content-Type', 'application/json');
      const response = await fetch(url, {
        method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined,
        signal: controller.signal, redirect: 'manual',
      });
      // Keep timeout active through body consumption, not just response headers.
      let text: string;
      if (maxBytes !== undefined && response.body) {
        const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
        while (true) {
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > maxBytes) { await reader.cancel(); throw new ApiError('response', 'Atlas response exceeded its byte limit.'); }
          chunks.push(part.value);
        }
        text = Buffer.concat(chunks).toString('utf8');
      } else text = await response.text();
      let data: unknown;
      const isJson = /\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type') ?? '');
      try { data = isJson && text ? JSON.parse(text) : undefined; }
      catch { /* Report malformed JSON below, retaining HTTP status for failures. */ }
      if (!response.ok) {
        const detail = !privateResponse && data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
          ? data.error.slice(0, 300) : `HTTP ${response.status}`;
        throw new ApiError('http', `Backend request failed: ${detail}`, response.status);
      }
      if (!isJson || data === undefined) throw new ApiError('response', 'Backend returned an invalid JSON response.');
      return data as T;
    } catch (error) {
      if (signal?.aborted) throw new ApiError('cancelled', 'Request cancelled.');
      if (timedOut) throw new ApiError('timeout', 'Backend did not respond within the request timeout.');
      if (error instanceof ApiError) throw error;
      throw new ApiError('network', 'Cannot reach the backend. Check that it is running and the URL is correct.');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
}
