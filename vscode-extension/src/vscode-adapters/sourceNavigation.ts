import * as vscode from 'vscode';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError, type MentorApi } from '../api-client/client';
import { validateCitation, validateSource, type PinnedSource, type SnapshotEvidence, type SourceReference } from '../api-client/mentorContracts';
import { compareRepository, type RepositoryBinding } from '../repository';
import type { MentorResult } from '../mentorController';
import type { EditorContext } from './editorContext';
import type { GitContext } from './gitContext';
import type { RepositoryController } from '../repositoryController';
import { relativeRepositoryPath, sameRepositoryUri } from './workspaceContext';

const normalizedText = (text: string) => text.replace(/\r\n/g, '\n');
const bindingKey = (binding: RepositoryBinding | undefined) => binding && JSON.stringify([binding.backendUrl, binding.workspaceUri, binding.snapshotId, binding.repositoryIdentity, binding.indexedCommit, binding.connectedAt]);

export class SourceNavigation implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly documents = new Map<string, { text: string; backend: string }>();
  private pending?: { controller: AbortController; binding: RepositoryBinding };
  private disposed = false;
  constructor(private readonly api: Pick<MentorApi, 'source' | 'backendIdentity'>, private readonly git: Pick<GitContext, 'read' | 'fileModified'>, private readonly repositories: Pick<RepositoryController, 'bindingFor'>) {}

  private bound(binding: RepositoryBinding): void {
    if (this.disposed || !vscode.workspace.isTrusted || this.api.backendIdentity !== binding.backendUrl || bindingKey(this.repositories.bindingFor(binding.workspaceUri)) !== bindingKey(binding)) throw new Error('This answer belongs to an unavailable or changed repository binding. Reconnect and explain the selection again.');
  }
  private active(controller: AbortController, binding: RepositoryBinding): void {
    if (controller.signal.aborted) throw new ApiError('cancelled', 'Source navigation cancelled.');
    this.bound(binding);
  }
  contextChanged(): void {
    if (this.pending) try { this.bound(this.pending.binding); } catch { this.cancel(); }
  }
  cancel(): void { this.pending?.controller.abort(); this.pending = undefined; }

  contextVersion(context: EditorContext): string {
    if (!context.documentUri) return 'unavailable';
    const uri = vscode.Uri.parse(context.documentUri);
    const git = this.git.read(uri);
    const document = (vscode.workspace.textDocuments ?? []).find(item => item.uri.toString() === uri.toString());
    return JSON.stringify([git.rootUri, git.identity, git.head, this.git.fileModified(uri), document?.version ?? 1, document?.isDirty ?? false]);
  }

  private async safeLocal(root: vscode.Uri, folder: vscode.Uri, file: vscode.Uri): Promise<boolean> {
    if (root.scheme !== 'file' || folder.scheme !== 'file' || file.scheme !== 'file' || relativeRepositoryPath(folder, file) === undefined) return false;
    const relative = relativeRepositoryPath(root, file);
    if (!relative) return false;
    try {
      const actualRoot = await realpath(root.fsPath);
      const actualFile = await realpath(file.fsPath);
      const expected = path.resolve(actualRoot, ...relative.split('/'));
      return process.platform === 'win32' ? actualFile.toLowerCase() === expected.toLowerCase() : actualFile === expected;
    } catch { return false; }
  }

  private localMatches(binding: RepositoryBinding, file: vscode.Uri): boolean {
    const local = this.git.read(file);
    const folderGit = this.git.read(vscode.Uri.parse(binding.workspaceUri));
    const comparison = compareRepository(local, binding);
    return comparison.identity === 'matched' && comparison.revision === 'matched' &&
      Boolean(local.rootUri && folderGit.rootUri && sameRepositoryUri(vscode.Uri.parse(local.rootUri), vscode.Uri.parse(folderGit.rootUri))) && this.git.fileModified(file) !== true;
  }

  async verified(context: EditorContext, evidence: SnapshotEvidence, reference: SourceReference, signal: AbortSignal): Promise<boolean> {
    if (!context.binding || !context.documentUri || context.file !== reference.file || context.hasUnsavedChanges) return false;
    try {
      this.bound(context.binding);
      const file = vscode.Uri.parse(context.documentUri); const root = vscode.Uri.parse(context.repositoryRootUri);
      if (!this.localMatches(context.binding, file) || !await this.safeLocal(root, vscode.Uri.parse(context.workspaceUri), file)) return false;
      const document = await vscode.workspace.openTextDocument(file);
      if (document.isDirty || context.documentVersion !== undefined && document.version !== context.documentVersion) return false;
      const source = validateSource(await this.api.source(evidence, reference, signal), evidence, reference);
      if (signal.aborted) throw new ApiError('cancelled', 'Source comparison cancelled.');
      this.bound(context.binding);
      return !document.isDirty && this.localMatches(context.binding, file) && normalizedText(document.getText()) === normalizedText(source.excerpt);
    } catch (error) {
      if (signal.aborted) throw error;
      return false;
    }
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const content = this.documents.get(uri.toString());
    if (uri.scheme !== 'codebase-mentor-source' || !content || content.backend !== this.api.backendIdentity) throw new Error('This indexed document is unavailable. Open its citation again from the matching backend.');
    return content.text;
  }
  private range(document: vscode.TextDocument, reference: SourceReference): vscode.Range {
    if (reference.endLine > document.lineCount) throw new Error('Citation is outside the available source lines.');
    return new vscode.Range(reference.startLine - 1, 0, reference.endLine - 1, document.lineAt(reference.endLine - 1).text.length);
  }

  async open(result: MentorResult, referenceId: string): Promise<'local' | 'indexed' | 'external' | undefined> {
    this.bound(result.binding);
    const raw = result.answer.citations.find(item => item.id === referenceId);
    if (!raw) throw new Error('This answer has no such indexed source citation.');
    const reference = validateCitation(raw, result.snapshot);
    this.cancel(); const controller = new AbortController(); this.pending = { controller, binding: result.binding };
    try {
      let response: PinnedSource;
      try { response = await this.api.source(result.snapshot, reference, controller.signal); }
      catch (error) {
        this.active(controller, result.binding);
        if (error instanceof ApiError && error.kind === 'response') throw error;
        const chosen = await vscode.window.showWarningMessage('Indexed source is unavailable. Open its immutable GitHub source instead?', 'Open pinned GitHub source');
        this.active(controller, result.binding);
        if (chosen === 'Open pinned GitHub source') { await vscode.env.openExternal(vscode.Uri.parse(reference.url)); return 'external'; }
        return;
      }
      const source = validateSource(response, result.snapshot, reference);
      this.active(controller, result.binding);
      const folder = vscode.Uri.parse(result.binding.workspaceUri);
      const localRoot = this.git.read(folder).rootUri;
      if (localRoot) {
        const root = vscode.Uri.parse(localRoot); const file = vscode.Uri.joinPath(root, ...reference.file.split('/'));
        if (this.localMatches(result.binding, file) && await this.safeLocal(root, folder, file)) {
          try {
            const document = await vscode.workspace.openTextDocument(file);
            if (!document.isDirty && normalizedText(document.getText()) === normalizedText(source.excerpt)) {
              const version = document.version;
              const editor = await vscode.window.showTextDocument(document, { preview: true, viewColumn: result.sourceContext.viewColumn ?? vscode.ViewColumn.One });
              this.active(controller, result.binding);
              if (!document.isDirty && document.version === version && this.localMatches(result.binding, file)) {
                editor.selection = new vscode.Selection(this.range(document, reference).start, this.range(document, reference).end);
                editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                return 'local';
              }
            }
          } catch (error) { if (controller.signal.aborted) throw error; /* Use indexed text when a local file is unavailable. */ }
        }
      }
      this.active(controller, result.binding);
      const extension = path.posix.extname(reference.file);
      const label = `${path.posix.basename(reference.file, extension)} (indexed ${result.snapshot.indexedCommit.slice(0, 12)})${extension}`;
      const uri = vscode.Uri.from({ scheme: 'codebase-mentor-source', path: `/${randomUUID()}/${label}`, query: `commit=${result.snapshot.indexedCommit}&snapshot=${result.snapshot.snapshotId}` });
      this.documents.set(uri.toString(), { text: source.excerpt, backend: result.binding.backendUrl });
      while (this.documents.size > 16) this.documents.delete(this.documents.keys().next().value!);
      const document = await vscode.workspace.openTextDocument(uri);
      this.active(controller, result.binding);
      const editor = await vscode.window.showTextDocument(document, { preview: true, viewColumn: result.sourceContext.viewColumn ?? vscode.ViewColumn.One });
      this.active(controller, result.binding);
      editor.selection = new vscode.Selection(this.range(document, reference).start, this.range(document, reference).end);
      editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      return 'indexed';
    } finally { if (this.pending?.controller === controller) this.pending = undefined; }
  }
  dispose(): void { this.disposed = true; this.cancel(); this.documents.clear(); }
}
