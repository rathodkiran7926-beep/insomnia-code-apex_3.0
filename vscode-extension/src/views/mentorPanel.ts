import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { MentorController } from '../mentorController';
import type { SourceNavigation } from '../vscode-adapters/sourceNavigation';
import { escapeHtml, renderMentorBody } from './mentorContent';

/** One small editor-side panel, no framework or direct backend access. */
export class MentorPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private ready = false;
  private readonly changed: { dispose(): void };
  private readonly panelDisposables: vscode.Disposable[] = [];
  constructor(private readonly extensionUri: vscode.Uri, private readonly mentor: MentorController, private readonly source: SourceNavigation) {
    this.changed = mentor.onChange(() => this.render());
  }
  show(preserveFocus = true): void {
    if (this.panel) { this.panel.reveal(this.panel.viewColumn, preserveFocus); this.render(); return; }
    const resources = vscode.Uri.joinPath(this.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel('codebaseMentor.mentor', 'Codebase Mentor', { viewColumn: vscode.ViewColumn.Beside, preserveFocus }, {
      enableScripts: true, enableCommandUris: false, localResourceRoots: [resources],
    });
    this.panelDisposables.push(this.panel.onDidDispose(() => {
      this.panel = undefined; this.ready = false;
      for (const disposable of this.panelDisposables.splice(0)) disposable.dispose();
      this.mentor.cancel('Mentor panel closed. Previous answers remain available in this window.');
    }), this.panel.webview.onDidReceiveMessage((message: unknown) => { void this.receive(message); }));
    this.initialize();
  }
  private async receive(value: unknown): Promise<void> {
    if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') return;
    const message = value as Record<string, unknown>;
    try {
      if (message.type === 'ready') { this.ready = true; this.render(); }
      else if (message.type === 'ask' && typeof message.question === 'string' && message.question.length <= 1500 && message.answerId === this.mentor.state.result?.id) await this.mentor.ask(message.question);
      else if (message.type === 'citation' && typeof message.answerId === 'string' && typeof message.referenceId === 'string' && message.referenceId.length <= 200) {
        const result = this.mentor.getResult(message.answerId);
        if (!result) throw new Error('That answer is no longer available. Explain the selection again.');
        await this.source.open(result, message.referenceId);
      } else if (message.type === 'cancel') { this.mentor.cancel(); this.source.cancel(); }
      else if (message.type === 'retry') await this.mentor.retry();
      else if (message.type === 'previous') this.mentor.previous();
      else if (message.type === 'latest') this.mentor.latest();
    } catch (error) { this.mentor.reportError(error instanceof Error ? error.message : 'Mentor action failed.'); }
  }
  private render(): void {
    if (this.panel && this.ready) void this.panel.webview.postMessage({ type: 'render', body: renderMentorBody(this.mentor.state) });
  }
  private initialize(): void {
    if (!this.panel) return;
    const webview = this.panel.webview; const nonce = randomBytes(18).toString('base64');
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media/mentor.css'));
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media/mentor.js'));
    webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="${escapeHtml(style.toString())}"><title>Codebase Mentor</title></head><body><div id="mentor-root"></div><script nonce="${nonce}" src="${escapeHtml(script.toString())}"></script></body></html>`;
  }
  dispose(): void { this.changed.dispose(); this.panel?.dispose(); for (const disposable of this.panelDisposables.splice(0)) disposable.dispose(); }
}
