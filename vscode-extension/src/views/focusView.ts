import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { ConnectionState } from '../connection';
import type { RepositoryController, FolderContext } from '../repositoryController';
import type { EditorContext } from '../vscode-adapters/editorContext';
import type { CheckpointState } from '../checkpointController';
import type { HandoffState } from '../handoffController';
import { checkpointActionContext } from './savedTasks';
import type { MentorState } from '../mentorController';
import { escapeHtml } from './mentorContent';

/** View-only state; all identities and mutations stay in the existing controllers. */
export interface FocusModel {
  connection: { status: ConnectionState['status']; message: string };
  workspace: string;
  folderCount: number;
  trusted: boolean;
  repository?: {
    name: string; status: string; message: string; snapshot?: string; commit?: string;
    branch: string; head?: string; identity: string; revision: string; dirty: boolean;
    usable: boolean; workspaceUri: string;
  };
  selection?: { name: string; file: string; line: number; dirty: boolean };
  tasks: { status: CheckpointState['status']; message: string; items: { id: string; title: string; createdAt: string }[]; more: boolean; previous: boolean };
  handoffs: { status: HandoffState['status']; message: string; items: { id: string; title: string; createdAt: string }[]; more: boolean; previous: boolean };
  mentorAvailable: boolean;
}

export interface FocusEnvironment {
  connection(): ConnectionState;
  repositories: RepositoryController;
  editor(): EditorContext | undefined;
  mentor(): MentorState;
  tasks(): CheckpointState;
  handoffs(): HandoffState;
  folders(): FolderContext[];
  trusted(): boolean;
}

const sameBinding = (a: { workspaceUri: string; backendUrl: string; snapshotId: string; connectedAt: string } | undefined,
  b: { workspaceUri: string; backendUrl: string; snapshotId: string; connectedAt: string } | undefined): boolean =>
  Boolean(a && b && a.workspaceUri === b.workspaceUri && a.backendUrl === b.backendUrl && a.snapshotId === b.snapshotId && a.connectedAt === b.connectedAt);

export function focusModel(env: FocusEnvironment): FocusModel {
  const folders = env.folders(); const selection = env.editor();
  const taskState = env.tasks(); const handoffState = env.handoffs();
  const activeUri = selection?.workspaceUri ?? taskState.binding?.workspaceUri ?? handoffState.binding?.workspaceUri;
  const folder = folders.find(f => f.uri === activeUri) ?? (folders.length === 1 ? folders[0] : undefined);
  const context = folder ? env.repositories.context(folder) : undefined;
  const binding = context?.binding;
  const usable = Boolean(folder && env.repositories.bindingFor(folder.uri));
  const taskScoped = sameBinding(taskState.binding, usable ? binding : undefined);
  const handoffScoped = sameBinding(handoffState.binding, usable ? binding : undefined);
  const connection = env.connection();
  return {
    connection: { status: connection.status, message: connection.message },
    workspace: folder?.name ?? (folders.length > 1 ? `${folders.length} workspace folders` : 'No workspace open'),
    folderCount: folders.length, trusted: env.trusted(),
    ...(context && folder ? { repository: {
      name: binding?.repositoryIdentity.replace(/^https:\/\/github\.com\//, '') ?? folder.name,
      status: context.status, message: context.message ?? '',
      ...(binding ? { snapshot: binding.snapshotId, commit: binding.indexedCommit } : {}),
      branch: context.local.branch ?? 'Unknown', head: context.local.head,
      identity: context.comparison?.identity ?? 'unknown',
      revision: context.comparison?.revision ?? 'unknown', dirty: Boolean(context.local.dirty),
      usable, workspaceUri: folder.uri,
    } } : {}),
    ...(selection && selection.workspaceUri === folder?.uri ? { selection: {
      name: selection.file.split('/').at(-1) ?? selection.file, file: selection.file,
      line: selection.selection.start.line + 1, dirty: selection.hasUnsavedChanges,
    } } : {}),
    tasks: { status: taskScoped ? taskState.status : 'idle', message: taskScoped ? taskState.message : 'Connect a validated repository to see saved tasks.',
      items: taskScoped ? (taskState.page?.items ?? []).slice(0, 6).map(i => ({ id: i.id, title: i.taskTitle, createdAt: i.createdAt })) : [],
      more: Boolean(taskScoped && taskState.page?.hasMore), previous: Boolean(taskScoped && taskState.page && taskState.page.offset > 0) },
    handoffs: { status: handoffScoped ? handoffState.status : 'idle', message: handoffScoped ? handoffState.message : 'Connect a validated repository to see saved handoffs.',
      items: handoffScoped ? (handoffState.page?.items ?? []).slice(0, 6).map(i => ({ id: i.id, title: i.question, createdAt: i.createdAt })) : [],
      more: Boolean(handoffScoped && handoffState.page?.hasMore), previous: Boolean(handoffScoped && handoffState.page && handoffState.page.offset > 0) },
    mentorAvailable: Boolean(env.mentor()),
  };
}

/** Responsive VS Code sidebar webview, with strictly whitelisted host commands. */
export class FocusView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private ready = false;
  private disposed = false;
  private epoch = 0;
  private scheduled?: ReturnType<typeof setTimeout>;
  private readonly owned: vscode.Disposable[] = [];
  constructor(private readonly extensionUri: vscode.Uri, private readonly env: FocusEnvironment,
    private readonly onVisibility?: (visible: boolean) => void) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view; this.ready = false;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, enableCommandUris: false, localResourceRoots: [media] };
    const nonce = randomBytes(18).toString('base64');
    const stylesheet = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'focus.css'));
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'focus.js'));
    view.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="${escapeHtml(stylesheet.toString())}"><title>Codebase Mentor Focus</title></head><body><main id="focus-root"></main><script nonce="${nonce}" src="${escapeHtml(script.toString())}"></script></body></html>`;
    this.owned.push(view.webview.onDidReceiveMessage(raw => { void this.receive(raw); }), view.onDidChangeVisibility(() => {
      this.onVisibility?.(view.visible); if (view.visible) this.refresh();
    }), view.onDidDispose(() => { this.view = undefined; this.ready = false; this.onVisibility?.(false); }));
    this.onVisibility?.(view.visible);
  }
  refresh(): void {
    if (this.disposed || !this.view || !this.ready || !this.view.visible) return;
    if (this.scheduled) clearTimeout(this.scheduled);
    this.scheduled = setTimeout(() => { this.scheduled = undefined; this.send(); }, 65);
  }
  private send(): void {
    if (!this.ready || !this.view || !this.view.visible || this.disposed) return;
    const model = focusModel(this.env);
    void this.view.webview.postMessage({ type: 'render', epoch: ++this.epoch, model });
  }
  private async receive(raw: unknown): Promise<void> {
    if (this.disposed || !raw || typeof raw !== 'object') return;
    const data = raw as Record<string, unknown>;
    if (data.type === 'ready') { this.ready = true; this.send(); return; }
    if (data.type !== 'action' || data.epoch !== this.epoch || typeof data.action !== 'string') return;
    const commands: Record<string, string> = {
      connect: 'connectRepository', refreshRepo: 'refreshRepository', changeSnapshot: 'changeSnapshot', disconnect: 'disconnectRepository',
      check: 'checkConnection', settings: 'openSettings', explain: 'explainSelection', mentor: 'openMentor',
      atlas: 'openMap', related: 'showRelatedCode', senior: 'askSeniorWithContext', webArchitecture: 'openRepositoryArchitecture',
      saveTask: 'saveTaskCheckpoint', refreshTasks: 'refreshCheckpoints', nextTasks: 'nextCheckpoints', previousTasks: 'previousCheckpoints',
      refreshHandoffs: 'refreshHandoffs', nextHandoffs: 'nextHandoffs', previousHandoffs: 'previousHandoffs',
      changes: 'openChanges',
    };
    try {
      const model = focusModel(this.env);
      if (data.action === 'resumeTask' || data.action === 'openHandoff' || data.action === 'detailsTask' || data.action === 'seniorTask' || data.action === 'deleteTask' || data.action === 'deleteHandoff') {
        if (typeof data.id !== 'string' || data.id.length > 200) return;
        const isTask = ['resumeTask', 'detailsTask', 'seniorTask', 'deleteTask'].includes(data.action);
        const state = isTask ? this.env.tasks() : this.env.handoffs();
        const entry = isTask ? model.tasks.items.find(i => i.id === data.id) : model.handoffs.items.find(i => i.id === data.id);
        if (!entry || !state.binding || !model.repository?.usable || state.binding.workspaceUri !== model.repository.workspaceUri) return;
        const command = { resumeTask: 'resumeTask', detailsTask: 'viewCheckpointDetails', deleteTask: 'deleteCheckpoint', seniorTask: 'askSeniorTask', openHandoff: 'openHandoff', deleteHandoff: 'deleteHandoff' }[data.action];
        if (!command) return;
        await vscode.commands.executeCommand(`codebaseMentor.${command}`, { id: data.id, contextId: checkpointActionContext(state.binding) });
      } else {
        const command = commands[data.action]; if (!command) return;
        // Commands remain responsible for revalidating trusted repository/selection context.
        await vscode.commands.executeCommand(`codebaseMentor.${command}`);
      }
    } catch {
      void vscode.window.showErrorMessage('Codebase Mentor: This action could not be completed. Check the repository and try again.');
    } finally { this.refresh(); }
  }
  dispose(): void {
    this.disposed = true; if (this.scheduled) clearTimeout(this.scheduled);
    for (const owned of this.owned.splice(0)) owned.dispose();
    this.view = undefined;
  }
}
