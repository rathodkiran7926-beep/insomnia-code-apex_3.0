import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { AtlasController } from '../atlasController';
import { escapeHtml } from './mentorContent';

/** A presentation-only graph of an already validated one-hop backend neighborhood. */
export class AtlasPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private ready = false;
  private readonly changed: vscode.Disposable;
  private readonly resources: vscode.Disposable[] = [];
  constructor(private readonly extensionUri: vscode.Uri, private readonly atlas: AtlasController, private readonly localNotice?: () => string | undefined) {
    this.changed = atlas.onChange(() => this.render());
  }
  show(): void {
    if (this.panel) { this.panel.reveal(this.panel.viewColumn, true); this.render(); return; }
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel('codebaseMentor.atlas', 'Architecture Atlas',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, enableCommandUris: false, retainContextWhenHidden: true, localResourceRoots: [media] });
    this.resources.push(this.panel.onDidDispose(() => {
      this.panel = undefined; this.ready = false;
      for (const entry of this.resources.splice(0)) entry.dispose();
    }), this.panel.webview.onDidReceiveMessage(message => { void this.receive(message); }));
    const webview = this.panel.webview;
    const nonce = randomBytes(18).toString('base64');
    const style = webview.asWebviewUri(vscode.Uri.joinPath(media, 'atlas.css'));
    const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'atlas.js'));
    webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="${escapeHtml(style.toString())}"><title>Architecture Atlas</title></head><body><main id="atlas-root" aria-live="polite"></main><script nonce="${nonce}" src="${escapeHtml(script.toString())}"></script></body></html>`;
    this.render();
  }
  private render(): void {
    if (!this.ready || !this.panel) return;
    const { status, message, result, canBack } = this.atlas.state;
    // Keep only the backend-validated, bounded neighborhood. Do not send source
    // buffers or backend credentials into the webview.
    void this.panel.webview.postMessage({ type: 'render', status, message, viewId: result?.id,
      canBack, scopeNotice: result?.target.scopeNotice, localNotice: this.localNotice?.(),
      neighborhood: result?.neighborhood && {
        repositoryIdentity: result.neighborhood.repositoryIdentity,
        indexedCommit: result.neighborhood.indexedCommit,
        component: result.neighborhood.component,
        components: result.neighborhood.components,
        incoming: result.neighborhood.incoming,
        outgoing: result.neighborhood.outgoing,
        references: result.neighborhood.references,
        documentation: result.neighborhood.documentation,
        truncated: result.neighborhood.truncated,
        limitations: result.neighborhood.limitations,
      },
    });
  }
  private async receive(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') return;
    const item = raw as Record<string, unknown>;
    if (item.type === 'ready') { this.ready = true; this.render(); return; }
    if (item.type !== 'action' || typeof item.action !== 'string') return;
    const commands: Record<string, string> = {
      back: 'mapBack', editor: 'mapBackToEditor', refresh: 'refreshMap', related: 'showRelatedCode',
      web: 'openFullAtlas', connect: 'connectRepository', source: 'openAtlasSource',
      explain: 'explainAtlasComponent', explore: 'exploreComponent', handoff: 'askSeniorMap',
    };
    const command = commands[item.action]; if (!command) return;
    if (['source', 'explain', 'explore', 'handoff'].includes(item.action)) {
      if (typeof item.viewId !== 'string' || item.viewId.length > 100 || typeof item.componentId !== 'string' || item.componentId.length > 200 || item.referenceId !== undefined && (typeof item.referenceId !== 'string' || item.referenceId.length > 200)) return;
      try {
        const result = this.atlas.current(item.viewId);
        if (!result.neighborhood.components.some(c => c.id === item.componentId)) return;
        if (item.action === 'source' && !result.neighborhood.references.some(r => r.id === item.referenceId)) return;
        await vscode.commands.executeCommand(`codebaseMentor.${command}`, { viewId: item.viewId, componentId: item.componentId, ...(item.referenceId ? { referenceId: item.referenceId } : {}) });
      } catch { this.render(); }
    } else await vscode.commands.executeCommand(`codebaseMentor.${command}`);
  }
  dispose(): void { this.changed.dispose(); this.panel?.dispose(); for (const item of this.resources.splice(0)) item.dispose(); }
}
