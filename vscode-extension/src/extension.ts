import * as vscode from 'vscode';
import { MentorApi } from './api-client/client';
import { Connection } from './connection';
import { registerCommands } from './commands/register';
import { MentorTree } from './views/mentorTree';
import { BindingStore } from './repository';
import { RepositoryController } from './repositoryController';
import { GitContext } from './vscode-adapters/gitContext';
import { captureEditorContext } from './vscode-adapters/editorContext';
import { registerRepositoryCommands } from './commands/repositoryCommands';
import { SourceNavigation } from './vscode-adapters/sourceNavigation';
import { MentorController } from './mentorController';
import { MentorPanel } from './views/mentorPanel';
import { registerMentorCommands } from './commands/mentorCommands';

export function activate(context: vscode.ExtensionContext) {
  const api = new MentorApi(() => vscode.workspace.getConfiguration('codebaseMentor')
    .get<string>('apiBaseUrl', 'http://127.0.0.1:3001'));
  const connection = new Connection(api);
  const git = new GitContext();
  const folders = () => (vscode.workspace.workspaceFolders ?? []).map(folder => ({ uri: folder.uri.toString(), name: folder.name }));
  const repositories = new RepositoryController(api, new BindingStore(context.workspaceState), {
    folders, trusted: () => vscode.workspace.isTrusted, git: uri => git.read(vscode.Uri.parse(uri)),
  });
  const editorContext = () => captureEditorContext(git, uri => repositories.bindingFor(uri));
  const source = new SourceNavigation(api, git, repositories);
  const mentor = new MentorController(api, {
    trusted: () => vscode.workspace.isTrusted, editor: editorContext, binding: uri => repositories.bindingFor(uri),
    choose: async (candidates, evidence) => (await vscode.window.showQuickPick(candidates.map(candidate => {
      const ref = evidence.references.find(item => item.id === candidate.referenceId);
      return { label: candidate.name, description: `${candidate.role} · ${ref?.file}:${ref?.startLine}–${ref?.endLine}`, candidate };
    }), { title: 'Codebase Mentor: Choose Indexed Component', placeHolder: 'Select the enclosing component you want explained.' }))?.candidate,
    verified: (selection, evidence, reference, signal) => source.verified(selection, evidence, reference, signal),
    sourceVersion: selection => source.contextVersion(selection),
    acknowledge: async () => await vscode.window.showWarningMessage('Explain the indexed snapshot instead of unverified local code?', {
      modal: true, detail: 'The checkout revision, selected file or unsaved editor differs from the indexed source, or its identity could not be verified. Current line numbers may identify different indexed code. The Mentor will name the resolved indexed component. No editor buffer will be uploaded.',
    }, 'Explain indexed snapshot') === 'Explain indexed snapshot',
  });
  const mentorPanel = new MentorPanel(context.extensionUri, mentor, source);
  let disposed = false;
  const check = async () => {
    if (disposed) return;
    const gitReady = git.initialize();
    await connection.check();
    await gitReady;
    if (!disposed) await repositories.restore();
  };
  context.subscriptions.push(connection, git, repositories, mentor, source, mentorPanel,
    vscode.workspace.registerTextDocumentContentProvider('codebase-mentor-source', source),
    repositories.onChange(() => { mentor.contextChanged(); source.contextChanged(); }),
    { dispose: () => { disposed = true; } });
  for (const surface of ['focus', 'map', 'changes'] as const) {
    const provider = new MentorTree(surface, () => connection.state, repositories, editorContext, () => mentor.state);
    context.subscriptions.push(provider,
      vscode.window.registerTreeDataProvider(`codebaseMentor.${surface}`, provider),
      connection.onChange(() => provider.refresh()),
      repositories.onChange(() => provider.refresh()), mentor.onChange(() => provider.refresh()));
  }
  registerCommands(context, connection, check);
  registerRepositoryCommands(context, repositories, git, connection);
  registerMentorCommands(context, mentor, mentorPanel, source, editorContext);
  let editorTimer: ReturnType<typeof setTimeout> | undefined;
  const refreshEditor = () => {
    mentor.contextChanged(); source.contextChanged();
    if (editorTimer) clearTimeout(editorTimer);
    editorTimer = setTimeout(() => { editorTimer = undefined; repositories.notifyLocalChange(); }, 75);
  };
  context.subscriptions.push(
    git.onDidChange(() => repositories.notifyLocalChange()),
    vscode.window.onDidChangeActiveTextEditor(refreshEditor),
    vscode.window.onDidChangeTextEditorSelection(refreshEditor),
    vscode.workspace.onDidChangeTextDocument(event => { if (event.document === vscode.window.activeTextEditor?.document) refreshEditor(); }),
    vscode.workspace.onDidSaveTextDocument(refreshEditor),
    vscode.workspace.onDidGrantWorkspaceTrust(() => { void check(); }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { repositories.synchronize(); void check(); }),
    { dispose: () => { if (editorTimer) clearTimeout(editorTimer); } },
  );
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('codebaseMentor.apiBaseUrl')) { repositories.synchronize(); void check(); }
  }));
  repositories.synchronize();
  void check();
  // Read-only extension API reusable by later IDE commands. No source contents.
  return { getEditorContext: editorContext, getMentorState: () => mentor.state,
    getSelectedComponentContext: () => mentor.selectedContext(), getRepositoryContext: (uri: string) => {
    const folder = folders().find(item => item.uri === uri);
    return folder ? repositories.context(folder) : undefined;
  } };
}
