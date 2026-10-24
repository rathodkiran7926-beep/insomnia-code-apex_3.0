import * as vscode from 'vscode';
import path from 'node:path';

export const supportedUri = (uri: vscode.Uri): boolean => ['file', 'vscode-remote'].includes(uri.scheme);

export function sameRepositoryUri(left: vscode.Uri, right: vscode.Uri): boolean {
  if (!supportedUri(left) || left.scheme !== right.scheme || left.authority !== right.authority) return false;
  const a = left.path.replace(/\/$/, ''); const b = right.path.replace(/\/$/, '');
  return /^\/[a-z]:\//i.test(left.path) ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** URI paths, not fsPath: remote authorities must never be mixed. */
export function relativeRepositoryPath(root: vscode.Uri, file: vscode.Uri): string | undefined {
  if (!supportedUri(root) || root.scheme !== file.scheme || root.authority !== file.authority) return;
  if ([root.path, file.path].some(value => /[\\\0]/.test(value) || value.split('/').some(segment => segment === '.' || segment === '..'))) return;
  const base = root.path.replace(/\/$/, '');
  const windows = /^\/[a-z]:\//i.test(root.path);
  const comparedBase = windows ? base.toLowerCase() : base;
  const comparedFile = windows ? file.path.toLowerCase() : file.path;
  if (!comparedFile.startsWith(comparedBase + '/')) return;
  const relative = file.path.slice(base.length + 1);
  if (!relative || path.posix.isAbsolute(relative)) return;
  return relative;
}

export function workspaceContext() {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const uri = vscode.window.activeTextEditor?.document.uri;
  return {
    folders, multiRoot: folders.length > 1, trusted: vscode.workspace.isTrusted,
    activeFolder: uri && supportedUri(uri) ? vscode.workspace.getWorkspaceFolder(uri) : undefined,
  };
}

export async function chooseWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const { folders } = workspaceContext();
  if (folders.length === 0) {
    void vscode.window.showInformationMessage('Open a folder or workspace before connecting a repository.');
    return;
  }
  if (folders.length === 1) return folders[0];
  const picked = await vscode.window.showQuickPick(folders.map(folder => ({ label: folder.name, description: folder.uri.toString(), folder })), { title: 'Codebase Mentor: Choose workspace folder' });
  return picked?.folder;
}
