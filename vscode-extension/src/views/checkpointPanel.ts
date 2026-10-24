import * as vscode from 'vscode';
import { randomBytes, randomUUID } from 'node:crypto';
import type { CheckpointController } from '../checkpointController';
import { validateCheckpointInput } from '../api-client/checkpointContracts';
import type { RepositoryBinding } from '../repository';
import { escapeHtml } from './mentorContent';
import { renderCheckpointBody, type CheckpointDraft } from './checkpointContent';

export interface CheckpointPanelActions { perform(type: string, value: Record<string, unknown>): Promise<void>; binding(): RepositoryBinding | undefined; recoverableBinding?(): RepositoryBinding | undefined }
const key = (b: RepositoryBinding | undefined) => b && JSON.stringify([b.backendUrl, b.workspaceUri, b.snapshotId, b.repositoryIdentity, b.indexedCommit, b.connectedAt]);
export class CheckpointPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel; private ready = false; private draft?: CheckpointDraft;
  private readonly changed: { dispose(): void }; private resources: vscode.Disposable[] = [];
  constructor(private readonly extensionUri: vscode.Uri, private readonly controller: CheckpointController, private readonly actions: CheckpointPanelActions) {
    this.changed = controller.onChange(() => {
      if (this.draft && key(this.actions.binding() ?? this.actions.recoverableBinding?.()) !== key(this.draft.binding)) this.draft = undefined;
      if (this.draft?.mode === 'edit') {
        if (this.panel && this.ready) void this.panel.webview.postMessage({ type: 'status', status: this.controller.state.status, message: this.controller.state.message, unavailable: !this.actions.binding() });
        return;
      }
      this.render();
    });
  }
  edit(draft: Omit<CheckpointDraft, 'id' | 'mode'>): void { if (this.draft && key(this.draft.binding) === key(draft.binding)) { this.show(); return; } this.draft = { ...draft, id: randomUUID(), mode: 'edit' }; this.show(); this.render(); }
  details(): void { this.draft = undefined; this.show(); this.render(); }
  private show(): void {
    if (this.panel) { this.panel.reveal(this.panel.viewColumn, true); return; }
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel('codebaseMentor.checkpoints', 'Task Checkpoint', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, enableCommandUris: false, localResourceRoots: [media] });
    this.resources.push(this.panel.onDidDispose(() => { this.panel = undefined; this.draft = undefined; this.ready = false; for (const d of this.resources.splice(0)) d.dispose(); this.controller.cancel(); }), this.panel.webview.onDidReceiveMessage(value => { void this.receive(value); }));
    const nonce = randomBytes(18).toString('base64'); const webview = this.panel.webview;
    const style = webview.asWebviewUri(vscode.Uri.joinPath(media, 'mentor.css')); const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'checkpoints.js'));
    webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="${escapeHtml(style.toString())}"><title>Task Checkpoint</title></head><body><div id="checkpoint-root"></div><script nonce="${nonce}" src="${escapeHtml(script.toString())}"></script></body></html>`;
  }
  private async receive(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') return; const value = raw as Record<string, unknown>;
    try {
      if (value.type === 'ready') { this.ready = true; this.render(); return; }
      if (value.type === 'preview') {
        const draft = this.draft; if (!draft || value.draftId !== draft.id || key(this.actions.binding()) !== key(draft.binding)) return;
        if (!value.fields || typeof value.fields !== 'object') return; const fields = value.fields as Record<string, unknown>;
        const input = validateCheckpointInput({ ...fields, requestId: randomUUID(), snapshotId: draft.binding.snapshotId, localContext: draft.localContext }, draft.binding);
        if (input.sourceReferenceIds.some(id => !draft.choices.some(c => c.reference.id === id))) throw new Error('Invalid chosen evidence.');
        this.draft = { ...draft, mode: 'preview', input }; this.render(); return;
      }
      if (value.type === 'edit' && this.draft && value.draftId === this.draft.id) { this.draft.mode = 'edit'; this.render(); return; }
      if (value.type === 'save') {
        const draft = this.draft; if (!draft?.input || draft.mode !== 'preview' || draft.id !== value.draftId || key(this.actions.binding()) !== key(draft.binding)) return;
        await this.controller.save(draft.binding, draft.input);
        if (this.controller.state.detail?.checkpoint.taskTitle === draft.input.taskTitle && this.controller.state.status === 'ready') { this.draft = undefined; this.render(); }
        return;
      }
      if (value.type === 'cancel') { this.draft = undefined; this.controller.cancel(); this.render(); return; }
      if (typeof value.type === 'string') await this.actions.perform(value.type, value);
    } catch { void vscode.window.showErrorMessage('Checkpoint action could not be completed. Review the current repository context and field limits.'); }
  }
  private render(): void {
    if (this.panel && this.ready) {
      const state = this.controller.state;
      // Retained metadata permits recovery, never submission against an unavailable binding.
      void this.panel.webview.postMessage({ type: 'render', body: renderCheckpointBody(this.draft && !this.actions.binding() ? { ...state, status: 'loading' } : state, this.draft) });
    }
  }
  dispose(): void { this.changed.dispose(); this.panel?.dispose(); for (const d of this.resources.splice(0)) d.dispose(); this.draft = undefined; }
}
