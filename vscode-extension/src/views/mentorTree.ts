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
    // Keep the existing item providers and commands, but progressively disclose
    // management controls instead of presenting them as a flat action list.
    const taskState = this.checkpoints?.(); const handoffState = this.handoffs?.();
    const tasks = row(`Saved Tasks${taskState?.page ? ` (${taskState.page.items.length}${taskState.page.hasMore ? '+' : ''})` : ''}`, 'history');
    tasks.id = 'codebaseMentor.savedTasks';
    tasks.collapsibleState = taskState?.page?.items.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    const handoffs = row(`Saved Handoffs${handoffState?.page ? ` (${handoffState.page.items.length}${handoffState.page.hasMore ? '+' : ''})` : ''}`, 'export');
    handoffs.id = 'codebaseMentor.savedHandoffs';
    handoffs.collapsibleState = handoffState?.page?.items.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    const activeUri = this.editorContext?.()?.workspaceUri;
    const primary = this.repositories && folders.length ? folders.find(folder => folder.uri.toString() === activeUri) ?? (folders.length === 1 ? folders[0] : undefined) : undefined;
    const selected = this.editorContext?.();
    const actions = this.mentorState ? [
      row('Explain Selection', 'sparkle', 'Explain the indexed component enclosing your selection.', 'codebaseMentor.explainSelection'),
      row('Open Mentor', 'comment-discussion', 'Review the current answer and source citations.', 'codebaseMentor.openMentor'),
      row('Architecture Diagram', 'type-hierarchy', 'Open an interactive, evidence-backed diagram in an editor tab.', 'codebaseMentor.openMap'),
      row('Ask Senior', 'export', 'Prepare a reviewed handoff; local feature must be enabled.', 'codebaseMentor.askSeniorWithContext'),
    ] : [];
    const details = row('Repository Details & Settings', 'gear');
    details.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    const detailRows: vscode.TreeItem[] = [];
    if (this.repositories) for (const folder of folders) {
      const entries = this.repositoryRows({ uri: folder.uri.toString(), name: folder.name });
      if (folders.length === 1) detailRows.push(...entries);
      else {
        const group = row(folder.name, 'repo', folder.uri.toString());
        group.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        this.children.set(group, entries); detailRows.push(group);
      }
    }
    detailRows.push(row(state.status === 'connected' ? 'Check Backend Connection' : 'Retry Backend Connection', 'refresh', state.message, 'codebaseMentor.checkConnection'), row('Open Settings', 'gear', 'Configure the backend URL.', 'codebaseMentor.openSettings'));
    this.children.set(details, detailRows);
    const repo = primary && this.repositories?.context({ uri: primary.uri.toString(), name: primary.name });
    const summary = repo?.binding
      ? `Repository: ${repo.binding.repositoryIdentity.replace('https://github.com/', '')}`
      : 'Repository: Not connected';
    const summaryItem = row(summary, repo?.binding ? 'repo' : 'plug', repo?.binding ? `Snapshot ${repo.binding.snapshotId}\nCommit ${repo.binding.indexedCommit}\n${repo.message ?? repo.status}` : 'Connect an analyzed repository snapshot.', repo?.binding ? undefined : 'codebaseMentor.connectRepository');
    if (repo?.binding) {
      summaryItem.description = repo.comparison?.revision === 'matched' ? 'Indexed revision matched' : repo.comparison?.revision === 'different' ? 'Different revision' : 'Revision unverified';
    }
    const overview: vscode.TreeItem[] = [
      row(label, icon, state.message),
      row(workspace ? `Workspace: ${workspace}` : 'No workspace open', 'folder', workspace ?? 'Open a repository folder.'),
      ...(this.repositories && folders.length ? [summaryItem] : []),
      ...(repo?.binding ? [row(`Snapshot ${repo.binding.snapshotId.slice(0, 8)} · ${repo.local.branch ?? 'Branch unknown'} · ${repo.binding.indexedCommit.slice(0, 8)}`, 'git-commit', `Indexed commit: ${repo.binding.indexedCommit}\nLocal HEAD: ${repo.local.head ?? 'Unknown'}\nIdentity: ${repo.comparison?.identity ?? 'unverified'}\n${repo.message ?? ''}`)] : []),
      ...(selected ? [row(`Selected: ${selected.file.split('/').at(-1) ?? selected.file}`, 'file-code', `${selected.file}\nSelection ${selected.selection.start.line + 1}–${selected.selection.end.line + 1}`, 'codebaseMentor.explainSelection')] : []),
      ...actions,
      ...(this.checkpoints ? [tasks] : []),
      ...(this.handoffs ? [handoffs] : []),
      ...(this.repositories && !repo?.binding && folders.length ? [row('Connect Repository', 'plug', 'Select an analyzed snapshot.', 'codebaseMentor.connectRepository')] : []),
      details,
    ];
    // Keep the status and workspaces visible, but hide advanced identity fields,
    // refresh, disconnect, settings and large capability warnings in Details.
    return overview;
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
