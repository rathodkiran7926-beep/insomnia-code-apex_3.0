import * as vscode from 'vscode';
import { compareRepository, type LocalGitContext, type RepositoryBinding } from '../repository';
import { relativeRepositoryPath, workspaceContext } from './workspaceContext';
import type { EditorSelection } from '../selection';
export { backendLineRange, type EditorSelection } from '../selection';

export interface EditorContext {
  workspaceUri: string;
  repositoryRootUri: string;
  file: string;
  selection: EditorSelection;
  hasSelection: boolean;
  hasUnsavedChanges: boolean;
  binding?: RepositoryBinding;
  revision: 'matched' | 'different' | 'unknown';
  documentUri?: string;
  documentVersion?: number;
  fileModified?: boolean;
  viewColumn?: number;
  localHead?: string;
}

export function captureEditorContext(git: { read(uri: vscode.Uri): LocalGitContext; fileModified?(uri: vscode.Uri): boolean | undefined }, bindingFor: (workspaceUri: string) => RepositoryBinding | undefined): EditorContext | undefined {
  const { activeFolder, trusted } = workspaceContext();
  const editor = vscode.window.activeTextEditor;
  if (!trusted || !activeFolder || !editor) return;
  const local = git.read(editor.document.uri);
  const folderLocal = git.read(activeFolder.uri);
  const root = local.rootUri ? vscode.Uri.parse(local.rootUri) : activeFolder.uri;
  const file = relativeRepositoryPath(root, editor.document.uri);
  if (!file) return;
  // A nested repository must not inherit its parent's snapshot binding.
  const binding = local.rootUri === folderLocal.rootUri ? bindingFor(activeFolder.uri.toString()) : undefined;
  const { start, end } = editor.selection;
  return {
    workspaceUri: activeFolder.uri.toString(), repositoryRootUri: root.toString(), file,
    selection: { start: { line: start.line, character: start.character }, end: { line: end.line, character: end.character } },
    hasSelection: !editor.selection.isEmpty, hasUnsavedChanges: editor.document.isDirty,
    documentUri: editor.document.uri.toString(), documentVersion: editor.document.version,
    fileModified: git.fileModified?.(editor.document.uri),
    viewColumn: editor.viewColumn,
    localHead: local.head,
    binding, revision: binding ? compareRepository(local, binding).revision : 'unknown',
  };
}
