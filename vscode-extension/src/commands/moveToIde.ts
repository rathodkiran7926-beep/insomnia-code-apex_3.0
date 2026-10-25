import * as vscode from 'vscode';
import { normalizeGithubRemote, validCommit, type RepositoryBinding } from '../repository';
import { safeSourcePath } from '../api-client/mentorContracts';
import type { MentorApi } from '../api-client/client';
import type { SourceNavigation } from '../vscode-adapters/sourceNavigation';

export function parseIdeSourceUri(uri: vscode.Uri) {
  if (!['vscode', 'vscode-insiders'].includes(uri.scheme) || uri.authority !== 'codebase-mentor-local.codebase-mentor' || uri.path !== '/open-source' || uri.fragment || uri.toString().length > 5000)
    throw new Error('Invalid Codebase Mentor source link.');
  const query = new URLSearchParams(uri.query);
  if ([...query.keys()].some(key => !['repository', 'commit', 'file', 'line'].includes(key)) || [...query.keys()].some(key => query.getAll(key).length !== 1))
    throw new Error('Invalid or duplicate source-link parameters.');
  const repository = query.get('repository') || '', commit = query.get('commit') || '', file = query.get('file') || '', rawLine = query.get('line') || '';
  const line = Number(rawLine);
  if (!normalizeGithubRemote(repository) || normalizeGithubRemote(repository) !== repository || !validCommit(commit) || !safeSourcePath(file) || !/^[1-9]\d{0,6}$/.test(rawLine) || line > 1000000)
    throw new Error('The IDE link must contain a valid repository, immutable commit, relative path and source line.');
  return { repository, commit: commit.toLowerCase(), file, line };
}

export function registerMoveToIde(context: vscode.ExtensionContext, api: MentorApi, source: SourceNavigation,
  bindings: () => RepositoryBinding[], ready?: () => Promise<void>) {
  let generation = 0;
  const open = async (uri: vscode.Uri) => {
    const target = parseIdeSourceUri(uri), request = ++generation;
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before using Move to IDE.');
    // A protocol link can activate a cold extension before bindings are restored.
    await ready?.();
    if (request !== generation) return;
    const candidates = bindings().filter(b => b.backendUrl === api.backendIdentity && b.repositoryIdentity === target.repository && b.indexedCommit.toLowerCase() === target.commit);
    if (!candidates.length) throw new Error('Connect this repository and the matching snapshot in the Codebase Mentor extension first. The web app and extension must use the same backend.');
    const binding = candidates.length === 1 ? candidates[0] : (await vscode.window.showQuickPick(candidates.map(binding => ({ label: vscode.Uri.parse(binding.workspaceUri).fsPath, binding })), { title: 'Move to IDE: choose the connected workspace' }))?.binding;
    if (!binding || request !== generation) return;
    const evidence = await api.evidence(binding.snapshotId);
    if (request !== generation) return;
    if (evidence.repositoryIdentity !== target.repository || evidence.indexedCommit.toLowerCase() !== target.commit) throw new Error('Saved source version does not match the IDE link.');
    const reference = evidence.references.find(ref => ref.file === target.file);
    if (!reference) throw new Error('This file has no source evidence in the connected snapshot. No location was guessed.');
    await source.openWorkspaceSource({ binding, snapshot: evidence, sourceContext: {
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
