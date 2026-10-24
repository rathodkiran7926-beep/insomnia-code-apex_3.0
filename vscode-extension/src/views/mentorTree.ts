import type { HandoffState } from '../handoffController';
import { savedHandoffItems } from './savedHandoffs';
import * as vscode from 'vscode';
import type { ConnectionState, ConnectionStatus } from '../connection';
import type { RepositoryController, FolderContext } from '../repositoryController';
import type { EditorContext } from '../vscode-adapters/editorContext';
import type { MentorState } from '../mentorController';
import type { CheckpointState } from '../checkpointController';
import { savedTaskItems } from './savedTasks';

type Surface = 'focus';
const labels: Record<ConnectionStatus, [string, string]> = {
  connecting: ['Connecting', 'sync~spin'], connected: ['Connected', 'pass'],
  disconnected: ['Disconnected', 'debug-disconnect'], 'server-error': ['Server error', 'error'],
  'invalid-configuration': ['Invalid backend configuration', 'warning'],
};

function row(label: string, icon: string, tooltip?: string, command?: string, argument?: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon(icon);
  item.tooltip = tooltip ?? label;
  if (command) item.command = { command, title: label, arguments: argument ? [argument] : [] };
  return item;
}

export class MentorTree implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly children = new WeakMap<vscode.TreeItem, vscode.TreeItem[]>();

  constructor(private readonly surface: Surface, private readonly state: () => ConnectionState,
    private readonly repositories?: RepositoryController, private readonly editorContext?: () => EditorContext | undefined,
    private readonly mentorState?: () => MentorState, private readonly checkpoints?: () => CheckpointState, private readonly handoffs?: () => HandoffState) {}

  refresh(): void { this.changed.fire(undefined); }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
  getChildren(parent?: vscode.TreeItem): vscode.TreeItem[] {
    if (parent?.id === 'codebaseMentor.savedHandoffs') return this.handoffs ? savedHandoffItems(this.handoffs()) : [];
    if (parent?.id === 'codebaseMentor.savedTasks') return this.checkpoints ? savedTaskItems(this.checkpoints()) : [];
    if (parent) return this.children.get(parent) ?? [];
    const folders = vscode.workspace.workspaceFolders ?? [];
    const state = this.state();
    const [label, icon] = labels[state.status];
    const workspace = vscode.workspace.name ?? vscode.workspace.workspaceFolders?.map(folder => folder.name).join(', ');
    const tasks = row('Saved Tasks', 'history'); tasks.id = 'codebaseMentor.savedTasks'; tasks.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    const handoffs = row('Saved Handoffs', 'export'); handoffs.id = 'codebaseMentor.savedHandoffs'; handoffs.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    return [
      row('Codebase Mentor', 'book', 'Your IDE companion to the shared Codebase Mentor platform.'),
      row(label, icon, state.message),
      row(workspace ? `Workspace: ${workspace}` : 'No workspace open', 'folder', workspace ?? 'Open a folder or workspace to prepare for future repository integration.'),
      row('Understand your repository in the IDE', 'lightbulb', 'Connect an existing analyzed snapshot to compare indexed and local repository context.'),
      ...(this.mentorState ? [row('Explain Selection', 'comment-discussion', 'Explain the indexed component enclosing the current code selection.', 'codebaseMentor.explainSelection'),
        row('Open Mentor', 'book', this.mentorState().result ? `Latest component: ${this.mentorState().result!.component.name}` : 'View source-grounded explanations and citations.', 'codebaseMentor.openMentor')] : []),
      ...(this.checkpoints ? [tasks] : []), ...(this.handoffs ? [handoffs] : []),
      ...(!this.repositories || folders.length === 0 ? [row('No repository snapshot connected', 'info', 'Open a workspace folder to connect an existing snapshot.')] : folders.flatMap(folder => {
        const entries = this.repositoryRows({ uri: folder.uri.toString(), name: folder.name });
        if (folders.length === 1) return entries;
        const group = row(folder.name, 'repo', folder.uri.toString());
        group.id = folder.uri.toString();
        group.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        this.children.set(group, entries); return [group];
      })),
      row(state.status === 'connected' ? 'Check backend connection' : 'Retry backend connection', 'refresh', 'Check GET /api/health on the configured server.', 'codebaseMentor.checkConnection'),
      row('Open settings', 'gear', 'Configure the backend URL.', 'codebaseMentor.openSettings'),
    ];
  }

  private repositoryRows(folder: FolderContext): vscode.TreeItem[] {
    const context = this.repositories?.context(folder);
    if (!context) return [];
    const { binding, local, comparison, status } = context;
    const statuses: Record<typeof status, string> = {
      none: 'No snapshot connected', connecting: 'Connecting repository…', ready: 'Snapshot validated',
      saved: 'Saved snapshot: not yet validated', 'other-backend': 'Saved binding belongs to another backend',
      invalid: 'Saved binding is malformed or outdated', untrusted: 'Workspace is not trusted',
      missing: 'Saved snapshot no longer exists', unavailable: 'Backend unavailable — saved metadata only',
      error: 'Snapshot validation failed',
    };
    const entries = [row(statuses[status], status === 'ready' ? 'pass' : status === 'connecting' ? 'sync~spin' : 'info', context.message ?? statuses[status])];
    if (binding) entries.push(
      row(`Repository: ${binding.repositoryIdentity.replace('https://github.com/', '')}`, 'repo'),
      row(`Snapshot: ${binding.snapshotId}`, 'database'),
      row(`Indexed commit: ${binding.indexedCommit.slice(0, 12)}`, 'git-commit', binding.indexedCommit),
      row(`Identity: ${comparison?.identity === 'matched' ? 'Verified' : comparison?.identity === 'mismatch' ? 'Repository mismatch — reconnect' : 'Unverified'}`, comparison?.identity === 'matched' ? 'verified' : 'warning'),
      row(`Revision: ${comparison?.revision === 'matched' ? 'Matched' : comparison?.revision === 'different' ? 'Different revision' : 'Unknown'}`, comparison?.revision === 'different' ? 'warning' : 'git-compare'),
    );
    entries.push(row(`Local HEAD: ${local.head?.slice(0, 12) ?? 'Unknown'}`, 'git-commit', local.head ?? 'Git metadata is unavailable.'),
      row(`Branch: ${local.branch ?? 'Unknown'}`, 'git-branch'));
    if (local.dirty) entries.push(row('Local changes', 'warning', 'Uncommitted changes are not part of the indexed snapshot.'));
    const editor = this.editorContext?.();
    if (editor?.workspaceUri === folder.uri) entries.push(row(`File: ${editor.file}`, 'file-code', `Cursor/selection: ${editor.selection.start.line + 1}:${editor.selection.start.character + 1}–${editor.selection.end.line + 1}:${editor.selection.end.character + 1}`));
    if (editor?.workspaceUri === folder.uri && editor.hasUnsavedChanges) entries.push(row('Unsaved editor changes', 'warning', 'Unsaved contents are never uploaded.'));
    entries.push(row('Connect Repository', 'plug', undefined, 'codebaseMentor.connectRepository', folder.uri),
      row('Refresh Repository Context', 'refresh', undefined, 'codebaseMentor.refreshRepository', folder.uri));
    if (binding || status === 'other-backend' || status === 'invalid') entries.push(
      row('Change Snapshot', 'versions', undefined, 'codebaseMentor.changeSnapshot', folder.uri),
      row('Disconnect Repository', 'debug-disconnect', undefined, 'codebaseMentor.disconnectRepository', folder.uri));
    return entries;
  }
  dispose(): void { this.changed.dispose(); }
}
