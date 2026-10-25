import * as vscode from 'vscode';
import { normalizeGithubRemote, validCommit, validSnapshotId, type RepositoryBinding } from '../repository';
import { safeSourcePath } from '../api-client/mentorContracts';
import type { MentorApi } from '../api-client/client';
import type { SourceNavigation } from '../vscode-adapters/sourceNavigation';

export function parseIdeSourceUri(uri: vscode.Uri) {
  if (!['vscode', 'vscode-insiders'].includes(uri.scheme) || uri.authority !== 'codebase-mentor-local.codebase-mentor' || uri.path !== '/moveToSource' || uri.fragment || uri.query.length > 4000 || uri.toString().length > 5000)
    throw new Error('Invalid Codebase Mentor source link.');
  const query = new URLSearchParams(uri.query);
  const keys = ['snapshotId', 'repository', 'commit', 'file', 'line'];
  if ([...query.keys()].some(key => !keys.includes(key)) || keys.some(key => query.getAll(key).length !== 1))
    throw new Error('Invalid or duplicate source-link parameters.');
  const snapshotId = query.get('snapshotId') || '', repository = query.get('repository') || '', commit = query.get('commit') || '', file = query.get('file') || '', rawLine = query.get('line') || '';
  const line = Number(rawLine);
  if (!validSnapshotId(snapshotId) || !normalizeGithubRemote(repository) || normalizeGithubRemote(repository) !== repository || !validCommit(commit) || !safeSourcePath(file) || !/^[1-9]\d{0,6}$/.test(rawLine) || line > 1000000)
    throw new Error('The IDE link must contain a valid repository, immutable commit, relative path and source line.');
  return { snapshotId, repository, commit: commit.toLowerCase(), file, line };
}

export function registerMoveToIde(context: vscode.ExtensionContext, api: MentorApi, source: SourceNavigation,
  bindings: () => RepositoryBinding[], ready?: () => Promise<void>,
  connect?: (target: ReturnType<typeof parseIdeSourceUri>, current: () => boolean) => Promise<boolean>) {
  let generation = 0;
  const open = async (uri: vscode.Uri) => {
    const target = parseIdeSourceUri(uri), request = ++generation;
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before using Move to IDE.');
    // A protocol link can activate a cold extension before bindings are restored.
    await ready?.();
    if (request !== generation) return;
    const evidence = await api.evidence(target.snapshotId);
    if (request !== generation) return;
    if (evidence.snapshotId !== target.snapshotId || evidence.repositoryIdentity !== target.repository || evidence.indexedCommit.toLowerCase() !== target.commit) throw new Error('Saved snapshot, repository or commit does not match the IDE link.');
    const matches = () => bindings().filter(b => b.backendUrl === api.backendIdentity && b.snapshotId === target.snapshotId && b.repositoryIdentity === target.repository && b.indexedCommit.toLowerCase() === target.commit);
    let candidates = matches();
    if (!candidates.length && connect) {
      if (!await connect(target, () => request === generation)) return;
      if (request !== generation) return;
      candidates = matches();
    }
    if (!candidates.length) throw new Error(`No matching repository snapshot is connected. Open ${target.repository} in VS Code and connect snapshot ${target.snapshotId}. Configured backend: ${api.backendIdentity}`);
    const binding = candidates.length === 1 ? candidates[0] : (await vscode.window.showQuickPick(candidates.map(binding => ({ label: vscode.Uri.parse(binding.workspaceUri).fsPath, binding })), { title: 'Move to IDE: choose the connected workspace' }))?.binding;
    if (!binding || request !== generation) return;
    const reference = evidence.references.find(ref => ref.file === target.file);
    if (!reference) throw new Error('This file has no source evidence in the connected snapshot. No location was guessed.');
    await source.openWorkspaceLine({ binding, snapshot: evidence, sourceContext: {
      workspaceUri: binding.workspaceUri, repositoryRootUri: binding.workspaceUri, file: target.file,
      binding, selection: { start: { line: target.line - 1, character: 0 }, end: { line: target.line - 1, character: 0 } },
      hasSelection: false, hasUnsavedChanges: false, revision: 'unknown', viewColumn: vscode.ViewColumn.One,
    } }, reference, target.line);
  };
  const handleUri = async (uri: vscode.Uri) => {
    try { await open(uri); }
    catch (error) { void vscode.window.showErrorMessage(`Move to IDE: ${error instanceof Error ? error.message : 'Source navigation failed.'}`); }
  };
  context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }),
    // The command and native URI use the same validation and navigation path.
    vscode.commands.registerCommand('codebaseMentor.moveToIde', (value: unknown) => {
      if (typeof value !== 'string') throw new Error('Move to IDE requires a source link.');
      return open(vscode.Uri.parse(value));
    }));
}
