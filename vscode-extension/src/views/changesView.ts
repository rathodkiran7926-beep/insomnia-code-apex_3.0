import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { PrController } from '../prController';
import { ChangesTree, type ChangesItem } from './changesTree';
import { escapeHtml } from './mentorContent';

interface Row { label: string; description?: string; action?: string; actions?: { title: string; id: string }[]; children?: Row[] }

/** Card-based PR sidebar. Existing ChangesTree is the only presentation/action source. */
export class ChangesView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private ready = false;
  private epoch = 0;
  private pending?: ReturnType<typeof setTimeout>;
  private readonly resources: vscode.Disposable[] = [];
  private readonly commands = new Map<string, vscode.Command>();
  private disposed = false;
  constructor(private readonly extensionUri: vscode.Uri, private readonly pr: PrController, private readonly tree: ChangesTree) {
    this.resources.push(pr.onChange(() => this.refresh()));
  }
  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view; this.ready = false;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, enableCommandUris: false, localResourceRoots: [media] };
    const nonce = randomBytes(18).toString('base64');
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'changes.css'));
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'changes.js'));
    view.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="${escapeHtml(style.toString())}"><title>Codebase Mentor Changes</title></head><body><main id="changes-root"></main><script nonce="${nonce}" src="${escapeHtml(script.toString())}"></script></body></html>`;
    this.resources.push(view.webview.onDidReceiveMessage(message => { void this.receive(message); }),
      view.onDidChangeVisibility(() => {
        this.pr.setVisible(view.visible);
        if (view.visible) { void this.pr.open(); this.refresh(); }
      }), view.onDidDispose(() => { this.view = undefined; this.ready = false; this.commands.clear(); this.pr.setVisible(false); }));
    if (view.visible) void this.pr.open();
  }
  refresh(): void {
    if (this.disposed || !this.view?.visible || !this.ready) return;
    if (this.pending) clearTimeout(this.pending);
    this.pending = setTimeout(() => { this.pending = undefined; this.send(); }, 45);
  }
  private send(): void {
    if (this.disposed || !this.view?.visible || !this.ready) return;
    this.commands.clear();
    const epoch = ++this.epoch;
    let rowCount = 0;
    const build = (item: ChangesItem, depth = 0): Row => {
      const row: Row = { label: String(item.label), ...(item.description ? { description: String(item.description) } : {}) };
      if (item.command?.command.startsWith('codebaseMentor.')) {
        const key = `row-${++rowCount}`;
        this.commands.set(key, item.command);
        row.action = key;
        // Native context-menu actions must remain available after replacing
        // TreeView with WebviewView. Route them to the existing PR commands.
        if (item.contextValue === 'prComponent' && item.action) {
          row.actions = (['prExploreMap', 'prExplainComponent', 'askSeniorChange'] as const).map((name, i) => {
            const id = `context-${key}-${i}`;
            this.commands.set(id, { command: `codebaseMentor.${name}`, title: name, arguments: [item.action] });
            return { id, title: ['Map', 'Mentor', 'Ask Senior'][i]! };
          });
        }
      }
      if (depth < 5 && item.collapsibleState !== vscode.TreeItemCollapsibleState.None && rowCount < 500) {
        row.children = this.tree.getChildren(item).slice(0, 100).map(child => build(child, depth + 1));
      }
      return row;
    };
    const nodes = this.tree.getChildren().slice(0, 60).map(row => build(row));
    const state = this.pr.state; const comparison = state.comparison;
    void this.view.webview.postMessage({ type: 'render', epoch,
      status: state.status, message: state.message,
      selected: state.selected && { title: comparison?.pr.title ?? state.selected.title, number: comparison?.pr.number ?? state.selected.number, state: comparison?.pr.state ?? state.selected.state },
      job: state.job && { progress: state.job.progress, status: state.job.status },
      comparison: comparison && { files: comparison.pr.files.length, components: comparison.components.length, impact: comparison.impact.before.length + comparison.impact.after.length, setup: comparison.setup.environment.length + comparison.setup.dependencies.length },
      rows: nodes,
    });
  }
  private async receive(raw: unknown): Promise<void> {
    if (this.disposed || !raw || typeof raw !== 'object') return;
    const msg = raw as Record<string, unknown>;
    if (msg.type === 'ready') { this.ready = true; this.send(); return; }
    if (msg.type !== 'action' || msg.epoch !== this.epoch || typeof msg.id !== 'string') return;
    const command = this.commands.get(msg.id);
    if (!command) return;
    try { await vscode.commands.executeCommand(command.command, ...(command.arguments ?? [])); }
    catch { void vscode.window.showErrorMessage('Codebase Mentor: Could not complete this PR action. Please refresh and retry.'); }
    this.refresh();
  }
  dispose(): void {
    this.disposed = true; this.commands.clear();
    if (this.pending) clearTimeout(this.pending);
    for (const d of this.resources.splice(0)) d.dispose();
    this.view = undefined;
  }
}
