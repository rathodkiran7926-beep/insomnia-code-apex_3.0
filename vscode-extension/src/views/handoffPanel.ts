import * as vscode from 'vscode';
import { randomBytes, randomUUID } from 'node:crypto';
import type { HandoffController } from '../handoffController';
import { validateHandoffInput, validateHandoffSelection } from '../api-client/handoffContracts';
import type { RepositoryBinding } from '../repository';
import { escapeHtml } from './mentorContent';
import { renderHandoffBody, type HandoffDraft } from './handoffContent';
import type { HandoffInput } from '../api-client/handoffContracts';
export class HandoffPanel implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private ready = false;
    private draft?: HandoffDraft;
    private requestId?: string;
    private resources: vscode.Disposable[] = [];
    private readonly changed: {
        dispose(): void;
    };
    constructor(private readonly extensionUri: vscode.Uri, private readonly controller: HandoffController, private readonly perform: (type: string, value: Record<string, unknown>) => Promise<void>, private readonly binding?: () => RepositoryBinding | undefined) {
        this.changed = controller.onChange(() => { if (!controller.state.binding) {
            this.draft = undefined;
            this.requestId = undefined;
        } if (this.draft?.mode === 'compose') {
            if (this.ready && this.panel)
                void this.panel.webview.postMessage({ type: 'status', status: controller.state.status, message: controller.state.message, unavailable: this.binding ? !this.binding() : !controller.state.binding });
            return;
        } this.render(); });
    }
    revealDraft(binding: RepositoryBinding, componentId: string | undefined, origin: HandoffInput['origin']): boolean { const d = this.draft; if (d && JSON.stringify(d.binding) === JSON.stringify(binding) && d.input.componentId === componentId && JSON.stringify(d.input.origin) === JSON.stringify(origin)) {
        this.show();
        return true;
    } return false; }
    compose(binding: RepositoryBinding, input: HandoffInput) { this.draft = { id: randomUUID(), binding, input, mode: 'compose' }; this.requestId = undefined; this.show(); this.render(); }
    details() { this.draft = undefined; this.requestId = undefined; this.show(); this.render(); }
    private show() { if (this.panel) {
        this.panel.reveal(this.panel.viewColumn, true);
        return;
    } const media = vscode.Uri.joinPath(this.extensionUri, 'media'); this.panel = vscode.window.createWebviewPanel('codebaseMentor.handoffs', 'Context Handoff', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, enableCommandUris: false, retainContextWhenHidden: true, localResourceRoots: [media] }); this.resources.push(this.panel.onDidDispose(() => { this.panel = undefined; this.ready = false; this.draft = undefined; this.requestId = undefined; for (const d of this.resources.splice(0))
        d.dispose(); this.controller.cancel(); }), this.panel.webview.onDidReceiveMessage(value => { void this.receive(value); })); const webview = this.panel.webview, nonce = randomBytes(18).toString('base64'); const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'mentor.css')); const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'handoffs.js')); webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="${escapeHtml(css.toString())}"><title>Context Handoff</title></head><body><div id="handoff-root"></div><script nonce="${nonce}" src="${escapeHtml(js.toString())}"></script></body></html>`; }
    private async receive(raw: unknown) {
        if (!raw || typeof raw !== 'object')
            return;
        const value = raw as Record<string, unknown>;
        try {
            if (value.type === 'ready') {
                this.ready = true;
                this.render();
                return;
            }
            if (value.type === 'cancel') {
                this.draft = undefined;
                this.controller.cancel();
                this.render();
                return;
            }
            if (['preview', 'refine', 'save', 'edit'].includes(String(value.type))) {
                const draft = this.draft;
                if (!draft || draft.id !== value.draftId)
                    return;
                if (value.type === 'preview') {
                    if (draft.mode !== 'compose' || !value.fields || typeof value.fields !== 'object')
                        return;
                    const fields = value.fields as Record<string, unknown>;
                    const input = validateHandoffInput({ ...draft.input, question: fields.question, attemptedSteps: fields.attemptedSteps, additionalContext: fields.additionalContext }, draft.binding);
                    draft.input = input;
                    await this.controller.preview(draft.binding, input);
                    if (this.draft === draft && this.controller.state.status === 'ready' && this.controller.state.preview) {
                        draft.preview = this.controller.state.preview;
                        draft.mode = 'review';
                        this.requestId = randomUUID();
                        this.render();
                    }
                    return;
                }
                if (value.viewId !== this.controller.state.viewId)
                    return;
                if (value.type === 'edit') {
                    draft.mode = 'compose';
                    this.render();
                    return;
                }
                if (value.type === 'refine') {
                    if (draft.mode !== 'review')
                        return;
                    const selection = validateHandoffSelection(value.selection);
                    draft.pendingSelection = selection;
                    await this.controller.preview(draft.binding, draft.input, selection);
                    if (this.draft === draft && this.controller.state.status === 'ready' && this.controller.state.preview) {
                        draft.preview = this.controller.state.preview;
                        draft.pendingSelection = undefined;
                        this.requestId = randomUUID();
                        this.render();
                    }
                    return;
                }
                if (value.type === 'save') {
                    if (this.controller.state.status !== 'ready' || draft.mode !== 'review' || !this.requestId || draft.preview !== this.controller.state.preview)
                        return;
                    await this.controller.save(this.requestId);
                    if (this.draft === draft && this.controller.state.detail && this.controller.state.status === 'ready') {
                        this.draft = undefined;
                        this.requestId = undefined;
                        this.render();
                    }
                    return;
                }
            }
            if (typeof value.type === 'string')
                await this.perform(value.type, value);
        }
        catch {
            void vscode.window.showErrorMessage('Handoff action could not be completed. Review the current context, field limits and backend availability.');
        }
    }
    private render() { if (this.panel && this.ready) {
        const state = this.controller.state;
        void this.panel.webview.postMessage({ type: 'render', body: renderHandoffBody(this.draft && this.binding && !this.binding() ? { ...state, status: 'loading' } : state, this.draft) });
    } }
    dispose() { this.changed.dispose(); this.panel?.dispose(); for (const d of this.resources.splice(0))
        d.dispose(); this.draft = undefined; }
}
