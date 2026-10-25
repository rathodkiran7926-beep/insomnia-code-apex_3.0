import { createHash } from 'node:crypto';

export interface SecretStore { get(key: string): Thenable<string | undefined>; store(key: string, value: string): Thenable<void>; delete(key: string): Thenable<void> }
export interface TeamAccount { user: { id: string; name: string; email: string }; workspaces: { id: string; name: string; role: string }[] }
export interface TeamHandoff { id: string; title: string; status: string; created_at: string; updated_at: string; question: string; repository_id: string; author_name?: string; actual_behavior?: string; expected_behavior?: string }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function teamId(value: string): string { if (!uuid.test(value)) throw new Error('Invalid team record.'); return value; }

/** Uses the existing web session protocol. Passwords are never persisted. */
export class TeamClient {
  private credential?: { backend: string; cookie: string };
  private current?: { backend: string; account: TeamAccount };
  private epoch = 0;
  constructor(private readonly backend: () => string, private readonly secrets: SecretStore) {}
  private key(backend: string) { return 'codebaseMentor.teamSession.' + createHash('sha256').update(backend).digest('hex'); }
  get account(): TeamAccount | undefined { if (!this.current) return undefined; try { return this.current.backend === this.backend() ? this.current.account : undefined; } catch { return undefined; } }
  get headers(): Record<string, string> { if (!this.credential) return {}; try { return this.credential.backend === this.backend() ? { Cookie: this.credential.cookie } : {}; } catch { return {}; } }
  async restore(): Promise<void> {
    const backend = this.backend(), epoch = this.epoch;
    const cookie = await this.secrets.get(this.key(backend));
    if (backend !== this.backend() || epoch !== this.epoch || !cookie || !/^mentor_collaboration=[a-f0-9]{64}$/.test(cookie)) return;
    this.credential = { backend, cookie };
    try { await this.me(); } catch { if (epoch === this.epoch) await this.clear(backend); }
  }
  private async clear(backend: string): Promise<void> {
    this.epoch++;
    if (this.credential?.backend === backend) this.credential = undefined;
    if (this.current?.backend === backend) this.current = undefined;
    await this.secrets.delete(this.key(backend));
  }
  async login(email: string, password: string): Promise<void> {
    const backend = this.backend();
    await this.clear(backend);
    try {
      await this.request('/api/collaboration/login', { email, password }, 'POST', true);
      await this.me();
    } catch (error) { await this.clear(backend); throw error; }
  }
  async connect(): Promise<void> {
    if (this.account) return;
    const backend = this.backend();
    const url = new URL(backend);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Automatic handoffs require your local Codebase Mentor backend.');
    await this.clear(backend);
    try {
      await this.request('/api/ide/team/connect', {}, 'POST', true);
      await this.me();
    } catch (error) { await this.clear(backend); throw error; }
  }
  async logout(): Promise<void> {
    const backend = this.backend();
    try { await this.request('/api/collaboration/logout', {}, 'POST'); } finally { await this.clear(backend); }
  }
  async me(): Promise<TeamAccount> {
    const backend = this.backend();
    const value = await this.request<TeamAccount>('/api/collaboration/me');
    if (!value.user || !uuid.test(value.user.id) || typeof value.user.name !== 'string' || typeof value.user.email !== 'string' || !Array.isArray(value.workspaces) || value.workspaces.some(w => !uuid.test(w.id) || typeof w.name !== 'string')) throw new Error('Invalid account response.');
    if (backend !== this.backend()) throw new Error('Backend changed. Sign in again.');
    this.current = { backend, account: value };
    return value;
  }
  async request<T = unknown>(path: string, body?: unknown, method: 'GET' | 'POST' = 'GET', login = false): Promise<T> {
    const backend = this.backend(), epoch = this.epoch;
    const base = new URL(backend);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (base.username || base.password || base.search || base.hash || base.protocol !== 'https:' && !(local && base.protocol === 'http:') || !path.startsWith('/api/') || /[\\\s#]/.test(path)) throw new Error('Configure a trusted HTTPS or loopback backend.');
    const target = new URL(path.slice(1), base.href.endsWith('/') ? base : new URL(base.href + '/'));
    const root = base.pathname.endsWith('/') ? base.pathname : base.pathname + '/';
    if (target.origin !== base.origin || !target.pathname.startsWith(root + 'api/') || /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)|%2f|%5c/i.test(path.split('?')[0] || '')) throw new Error('Invalid API destination.');
    let response: Response;
    try { response = await fetch(target, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(path === '/api/ide/team/connect' ? { 'X-Codebase-Mentor-Client': 'vscode' } : {}), ...(!login ? this.headers : {}) }, body: method === 'POST' ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(method === 'POST' && path === '/api/handoffs' ? 90000 : 15000) }); }
    catch { throw new Error('Cannot reach the handoff backend. Check the connection and retry.'); }
    const reader = response.body?.getReader(); let size = 0; const parts: Uint8Array[] = [];
    try {
      while (reader) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1500000) throw new Error('Team response exceeds its limit.'); parts.push(part.value); }
    } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
    if (backend !== this.backend() || epoch !== this.epoch) throw new Error('Account or backend changed. Retry from the current view.');
    if (!response.ok) {
      if (response.status === 401 && !login) await this.clear(backend);
      throw new Error(response.status === 401 ? 'Sign-in required, or email/password is incorrect.' : path === '/api/ide/team/connect' && response.status === 403 ? 'Enable CODEBASE_MENTOR_IDE_DEMO=1 on your local backend and restart it to use handoffs without signing in.' : response.status === 404 ? 'Handoff not found or you do not have access.' : `Handoff backend rejected the request (HTTP ${response.status}).`);
    }
    if (login) {
      const cookie = response.headers.getSetCookie().map(value => /^mentor_collaboration=([a-f0-9]{64})(?:;|$)/.exec(value)?.[1]).find(Boolean);
      if (!cookie) throw new Error('Backend did not issue a valid session.');
      this.credential = { backend, cookie: `mentor_collaboration=${cookie}` };
      await this.secrets.store(this.key(backend), this.credential.cookie);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as T;
  }
}
