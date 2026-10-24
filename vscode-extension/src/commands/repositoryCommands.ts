import * as vscode from 'vscode';
import { validSnapshotId } from '../repository';
import { RepositoryController, type FolderContext } from '../repositoryController';
import type { Connection } from '../connection';
import { GitContext } from '../vscode-adapters/gitContext';
import { chooseWorkspaceFolder, supportedUri } from '../vscode-adapters/workspaceContext';

export function registerRepositoryCommands(context: vscode.ExtensionContext, repositories: RepositoryController, git: GitContext, connection: Connection): void {
  const choose = async (argument: unknown): Promise<FolderContext | undefined> => {
    const folder = typeof argument === 'string'
      ? vscode.workspace.workspaceFolders?.find(item => item.uri.toString() === argument)
      : await chooseWorkspaceFolder();
    if (!folder) return;
    if (!supportedUri(folder.uri)) throw new Error('This workspace URI scheme is not supported for repository context.');
    return { uri: folder.uri.toString(), name: folder.name };
  };
  const register = (id: string, handler: (argument: unknown) => Promise<void>) => {
    context.subscriptions.push(vscode.commands.registerCommand(id, async (argument: unknown) => {
      try { await handler(argument); }
      catch (error) { void vscode.window.showErrorMessage(`Codebase Mentor: ${error instanceof Error ? error.message : 'Repository action failed.'}`); }
    }));
  };
  const connect = async (argument: unknown) => {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before connecting a repository.');
    const folder = await choose(argument);
    if (!folder) return;
    await git.initialize();
    const id = await vscode.window.showInputBox({
      title: 'Codebase Mentor: Connect Repository',
      prompt: 'Enter an existing snapshot ID from the Codebase Mentor web platform.',
      ignoreFocusOut: true,
      validateInput: value => validSnapshotId(value.trim()) ? undefined : 'Use 1–150 letters, digits, underscores or hyphens.',
    });
    if (id === undefined) return;
    await repositories.connect(folder, id.trim(), async (snapshot, local, comparison) => {
      const identity = comparison.identity === 'matched' ? 'Repository identity verified from Git remote.' : 'Repository identity unavailable. This connection will remain unverified.';
      const revision = comparison.revision === 'matched' ? 'Matched revision.' : comparison.revision === 'different' ? 'Different revision: indexed evidence describes another commit.' : 'Local revision unknown.';
      const action = comparison.identity === 'unverified' ? 'Connect unverified' : comparison.revision === 'different' ? 'Connect different revision' : 'Connect repository';
      const chosen = await vscode.window.showWarningMessage(`Connect ${folder.name} to ${snapshot.repositoryIdentity}?`, {
        modal: true,
        detail: `Snapshot: ${snapshot.snapshotId}\nIndexed commit: ${snapshot.indexedCommit}\nLocal HEAD: ${local.head ?? 'Unknown'}\nBranch: ${local.branch ?? 'Unknown'}\n${identity}\n${revision}${local.dirty ? '\nLocal changes are present.' : ''}\nNo source files will be uploaded.`,
      }, action);
      return chosen === action;
    });
  };
  register('codebaseMentor.connectRepository', connect);
  register('codebaseMentor.changeSnapshot', connect);
  register('codebaseMentor.refreshRepository', async argument => {
    const folder = await choose(argument); if (!folder) return;
    await git.initialize(); await connection.check(); await repositories.refresh(folder);
  });
  register('codebaseMentor.disconnectRepository', async argument => {
    const folder = await choose(argument); if (folder) await repositories.disconnect(folder);
  });
}
