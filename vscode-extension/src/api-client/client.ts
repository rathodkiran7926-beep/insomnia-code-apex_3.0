import { validateSnapshot, validSnapshotId, type SnapshotMetadata } from '../repository';
import { validateEvidence, validateResolution, validateMentorAnswer, validateSource, safeSourcePath, type SnapshotEvidence, type Resolution, type MentorAnswer, type PinnedSource, type SourceReference } from './mentorContracts';

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
  // Future authentication can supply headers from SecretStorage here.
  // No authentication protocol or credential persistence is implemented.
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

  private async request<T>(method: 'GET' | 'POST', path: string, body: unknown, signal?: AbortSignal, timeoutMs = this.options.timeoutMs ?? 5000): Promise<T> {
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
      const text = await response.text();
      let data: unknown;
      const isJson = /\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type') ?? '');
      try { data = isJson && text ? JSON.parse(text) : undefined; }
      catch { /* Report malformed JSON below, retaining HTTP status for failures. */ }
      if (!response.ok) {
        const detail = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
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
