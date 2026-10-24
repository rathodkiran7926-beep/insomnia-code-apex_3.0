import * as vscode from 'vscode';
import type { CheckpointState } from '../checkpointController';
import type { RepositoryBinding } from '../repository';
export interface CheckpointAction { id?: string; viewId?: string; contextId?: string }
export const checkpointActionContext = (binding: RepositoryBinding | undefined): string | undefined => binding && JSON.stringify([binding.backendUrl, binding.workspaceUri, binding.snapshotId, binding.connectedAt]);
export class SavedTaskItem extends vscode.TreeItem { checkpointAction?: CheckpointAction }
export function savedTaskItems(state: CheckpointState): SavedTaskItem[] {
  const row = (label: string, command?: string, action?: CheckpointAction, icon = 'history') => {
    const item = new SavedTaskItem(label, vscode.TreeItemCollapsibleState.None); item.iconPath = new vscode.ThemeIcon(icon); item.tooltip = label;
    item.checkpointAction = action; if (command) item.command = { command: `codebaseMentor.${command}`, title: label, arguments: action ? [action] : [] }; return item;
  };
  return [row(state.message, undefined, undefined, state.status === 'loading' || state.status === 'saving' ? 'sync~spin' : 'info'),
    ...(state.page?.items.map(checkpoint => {
      const action = { id: checkpoint.id, contextId: checkpointActionContext(state.binding) }; const item = row(checkpoint.taskTitle, 'resumeTask', action);
      item.id = `checkpoint-task:${action.contextId}:${checkpoint.id}`;
      item.contextValue = 'savedTask'; item.description = `${checkpoint.createdAt.slice(0, 10)} · ${checkpoint.indexedCommit.slice(0, 12)}${checkpoint.localContext.branch ? ` · ${checkpoint.localContext.branch}` : ''}${checkpoint.snapshotId !== state.binding?.snapshotId ? ' · different saved snapshot' : ''}`;
      item.tooltip = `${checkpoint.taskTitle}\nRepository: ${checkpoint.repositoryIdentity}\nSaved snapshot: ${checkpoint.snapshotId}\nSaved indexed commit: ${checkpoint.indexedCommit}\nLocal branch is extension-reported: ${checkpoint.localContext.branch ?? 'unknown'}`; return item;
    }) ?? []),
    ...(state.page && !state.page.items.length ? [row('No saved task checkpoints yet.')] : []),
    row('Save Task Checkpoint', 'saveTaskCheckpoint', undefined, 'save'), row('Refresh Saved Tasks', 'refreshCheckpoints', undefined, 'refresh'),
    ...(state.page?.hasMore ? [row('Next Saved Tasks', 'nextCheckpoints', undefined, 'arrow-right')] : []),
    ...(state.page && state.page.offset > 0 ? [row('Previous Saved Tasks', 'previousCheckpoints', undefined, 'arrow-left')] : []),
  ];
}
