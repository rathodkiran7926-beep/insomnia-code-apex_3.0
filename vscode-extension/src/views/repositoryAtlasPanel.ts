import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { RepositoryBinding } from '../repository';
import type { RepositoryGraph } from '../api-client/repositoryGraph';
import type { MentorApi } from '../api-client/client';
import type { SourceReference, Component } from '../api-client/mentorContracts';
import { escapeHtml } from './mentorContent';

export interface RepositoryAtlasEnvironment {
  trusted(): boolean;
  bindings(): RepositoryBinding[];
  current(binding: RepositoryBinding): RepositoryBinding | undefined;
  focus(binding: RepositoryBinding, component: Component, reference: SourceReference, graph: RepositoryGraph): Promise<void>;
  source(binding: RepositoryBinding, component: Component, reference: SourceReference, graph: RepositoryGraph): Promise<void>;
}
const key = (b: RepositoryBinding) => JSON.stringify([b.backendUrl, b.workspaceUri, b.snapshotId, b.repositoryIdentity, b.indexedCommit, b.connectedAt]);

/** Full snapshot overview in an editor tab. All edges are backend-indexed evidence;
 *  presentation-only file grouping/layout runs in the isolated VS Code webview. */
export class RepositoryAtlasPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private ready = false;
  private binding?: RepositoryBinding;
  private graph?: RepositoryGraph;
  private loading?: AbortController;
  private status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private message = '';
  private token = 0;
  private disposed = false;
  private readonly resources: vscode.Disposable[] = [];
  constructor(private readonly extensionUri: vscode.Uri, private readonly api: Pick<MentorApi, 'backendIdentity' | 'repositoryGraph'>,
    private readonly env: RepositoryAtlasEnvironment) {}

  async show(): Promise<void> {
    if (this.disposed || !this.env.trusted()) throw new Error('Trust the workspace before viewing repository architecture.');
    const bindings = this.env.bindings().filter(b => b.backendUrl === this.api.backendIdentity && key(this.env.current(b) ?? {} as RepositoryBinding) === key(b));
    if (!bindings.length) throw new Error('Connect and validate a repository snapshot before opening Full Architecture.');
    const binding = bindings.length === 1 ? bindings[0] : (await vscode.window.showQuickPick(bindings.map(b => ({
      label: b.repositoryIdentity.replace('https://github.com/', ''), description: `${b.snapshotId.slice(0, 12)} · ${b.workspaceUri}`, binding: b,
    })), { title: 'Full Repository Architecture', placeHolder: 'Choose the connected repository to visualize' }))?.binding;
    if (!binding) return;
    this.createPanel();
    this.panel!.reveal(this.panel!.viewColumn, true);
    await this.load(binding);
  }

  private createPanel(): void {
    if (this.panel) return;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel('codebaseMentor.repositoryAtlas', 'Full Repository Architecture',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, enableCommandUris: false, retainContextWhenHidden: true, localResourceRoots: [media] });
    const view = this.panel.webview;
    this.resources.push(this.panel.onDidDispose(() => {
      this.loading?.abort(); this.loading = undefined; this.binding = undefined; this.graph = undefined;
      this.panel = undefined; this.ready = false;
      for (const resource of this.resources.splice(0)) resource.dispose();
    }), view.onDidReceiveMessage(raw => { void this.receive(raw); }));
    const nonce = randomBytes(18).toString('base64');
    const css = view.asWebviewUri(vscode.Uri.joinPath(media, 'repositoryAtlas.css'));
    const js = view.asWebviewUri(vscode.Uri.joinPath(media, 'repositoryAtlas.js'));
    view.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.cspSource}; script-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="${escapeHtml(css.toString())}"><title>Full Repository Architecture</title></head><body><main id="repo-atlas"></main><script nonce="${nonce}" src="${escapeHtml(js.toString())}"></script></body></html>`;
  }

  private valid(binding: RepositoryBinding): boolean {
    return this.env.trusted() && this.api.backendIdentity === binding.backendUrl &&
      Boolean(this.env.current(binding) && key(this.env.current(binding)!) === key(binding));
  }
  private render(): void {
    if (!this.ready || !this.panel) return;
    void this.panel.webview.postMessage({ type: 'render', token: this.token, status: this.status, message: this.message,
      graph: this.status === 'ready' && this.graph ? {
        snapshotId: this.graph.snapshotId, repositoryIdentity: this.graph.repositoryIdentity,
        indexedCommit: this.graph.indexedCommit, components: this.graph.components,
        references: this.graph.references, relationships: this.graph.relationships,
        limitations: this.graph.limitations,
      } : undefined });
  }
  private async load(binding: RepositoryBinding): Promise<void> {
    this.loading?.abort(); const controller = new AbortController(); this.loading = controller;
    this.binding = binding; this.graph = undefined; this.status = 'loading'; this.message = 'Loading the complete indexed repository architecture…';
    ++this.token; this.render();
    try {
      if (!this.valid(binding)) throw new Error('Repository connection changed. Reconnect before viewing architecture.');
      const graph = await this.api.repositoryGraph(binding.snapshotId, controller.signal);
      if (this.loading !== controller || controller.signal.aborted || !this.valid(binding)) return;
      if (graph.repositoryIdentity !== binding.repositoryIdentity || graph.indexedCommit !== binding.indexedCommit) throw new Error('The returned repository graph does not match the connected snapshot.');
      this.graph = graph; this.status = 'ready'; this.message = '';
    } catch (error) {
      if (this.loading !== controller || controller.signal.aborted) return;
      this.status = 'error'; this.message = error instanceof Error ? error.message : 'Could not load repository architecture.';
    } finally {
      if (this.loading === controller) { this.loading = undefined; this.render(); }
    }
  }
  private async receive(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') return;
    const data = raw as Record<string, unknown>;
    if (data.type === 'ready') { this.ready = true; this.render(); return; }
    if (data.type !== 'action' || data.token !== this.token || typeof data.action !== 'string') return;
    const binding = this.binding;
    if (!binding || !this.valid(binding)) { this.graph = undefined; this.status = 'error'; this.message = 'Repository connection changed. Reopen Full Architecture.'; this.render(); return; }
    if (data.action === 'refresh') { await this.load(binding); return; }
    if (!this.graph || this.status !== 'ready' || !['focus', 'source'].includes(data.action) || typeof data.componentId !== 'string') return;
    const component = this.graph.components.find(c => c.id === data.componentId);
    const reference = component && this.graph.references.find(r => r.id === component.referenceId);
    if (!component || !reference) return;
    try {
      if (data.action === 'focus') await this.env.focus(binding, component, reference, this.graph);
      else await this.env.source(binding, component, reference, this.graph);
    } catch (error) { void vscode.window.showErrorMessage(`Codebase Mentor: ${error instanceof Error ? error.message : 'Architecture action failed.'}`); }
  }
  dispose(): void {
    this.disposed = true; this.loading?.abort(); this.graph = undefined;
    this.panel?.dispose(); for (const item of this.resources.splice(0)) item.dispose();
  }
}
