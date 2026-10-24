import * as vscode from 'vscode';
import { HandoffController } from './handoffController';
import { HandoffPanel } from './views/handoffPanel';
import { registerHandoffCommands, type HandoffCommands } from './commands/handoffCommands';
import { MentorApi } from './api-client/client';
import { Connection } from './connection';
import { registerCommands } from './commands/register';
import { FocusView } from './views/focusView';
import { BindingStore, type RepositoryBinding } from './repository';
import { RepositoryController } from './repositoryController';
import { GitContext } from './vscode-adapters/gitContext';
import { captureEditorContext } from './vscode-adapters/editorContext';
import { registerRepositoryCommands } from './commands/repositoryCommands';
import { SourceNavigation } from './vscode-adapters/sourceNavigation';
import { MentorController } from './mentorController';
import { MentorPanel } from './views/mentorPanel';
import { registerMentorCommands } from './commands/mentorCommands';
import { AtlasController } from './atlasController';
import { AtlasTree } from './views/atlasTree';
import { AtlasPanel } from './views/atlasPanel';
import { RepositoryAtlasPanel } from './views/repositoryAtlasPanel';
import { registerAtlasCommands } from './commands/atlasCommands';
import { ComparisonContexts } from './comparisonContexts';
import { PrController } from './prController';
import { ChangesTree } from './views/changesTree';
import { ChangesView } from './views/changesView';
import { registerPrCommands } from './commands/prCommands';
import { CheckpointController } from './checkpointController';
import { CheckpointPanel } from './views/checkpointPanel';
import { registerCheckpointCommands, type CheckpointCommands } from './commands/checkpointCommands';
import type { LocalCheckpointContext } from './api-client/checkpointContracts';

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
  const temporary = new ComparisonContexts(uri => repositories.bindingFor(uri));
  const checkpointTemporary = new ComparisonContexts(uri => repositories.bindingFor(uri), 'checkpoint');
  const handoffTemporary = new ComparisonContexts(uri => repositories.bindingFor(uri), 'handoff');
  const effective = { bindingFor: (uri: string, expected?: RepositoryBinding) => {
    const candidate = temporary.bindingFor(uri, expected);
    if (expected && candidate?.connectedAt === expected.connectedAt) return candidate;
    const checkpoint = checkpointTemporary.bindingFor(uri, expected);
    return expected && checkpoint?.connectedAt === expected.connectedAt ? checkpoint : handoffTemporary.bindingFor(uri, expected);
  } };
  const source = new SourceNavigation(api, git, effective);
  const mentor = new MentorController(api, {
    trusted: () => vscode.workspace.isTrusted, editor: editorContext, binding: (uri, expected) => effective.bindingFor(uri, expected),
    choose: async (candidates, evidence) => (await vscode.window.showQuickPick(candidates.map(candidate => {
      const ref = evidence.references.find(item => item.id === candidate.referenceId);
      return { label: candidate.name, description: `${candidate.role} · ${ref?.file}:${ref?.startLine}–${ref?.endLine}`, candidate };
    }), { title: 'Codebase Mentor: Choose Indexed Component', placeHolder: 'Select the enclosing component you want explained.' }))?.candidate,
    verified: (selection, evidence, reference, signal) => source.verified(selection, evidence, reference, signal),
    sourceVersion: selection => source.contextVersion(selection),
    // Explain Selection is an explicit user request for the pinned indexed snapshot.
    // Show the scope/revision warning inside the Mentor instead of interrupting
    // every request with a Windows modal. Never upload unsaved editor buffers.
    acknowledge: async () => true,
  });
  const mentorPanel = new MentorPanel(context.extensionUri, mentor, source);
  const atlas = new AtlasController(api, {
    trusted: () => vscode.workspace.isTrusted, binding: (uri, expected) => effective.bindingFor(uri, expected),
    workspace: () => editorContext()?.workspaceUri, editor: editorContext,
    resolve: (selection, signal) => mentor.resolveContext(selection, signal),
  });
  const atlasLocalNotice = (): string | undefined => {
    const target = atlas.state.result?.target; if (!target) return;
    const folder = folders().find(item => item.uri === target.binding.workspaceUri); if (!folder) return;
    const local = repositories.context(folder); const editor = editorContext();
    if (local.comparison?.revision !== 'matched') return 'Local revision differs or is unknown. Selection coordinates refer to the indexed snapshot; inspect its source.';
    if (local.local.dirty || editor?.hasUnsavedChanges) return 'Local changes are outside the indexed snapshot. Source links verify text or open read-only indexed source.';
  };
  const atlasPanel = new AtlasPanel(context.extensionUri, atlas, atlasLocalNotice);
  const atlasTree = new AtlasTree(atlas, () => folders().some(folder => Boolean(repositories.bindingFor(folder.uri))), atlasLocalNotice);
  let checkpoints: CheckpointController | undefined;
  let handoffContext: HandoffController | undefined;
  const activeBinding = (): RepositoryBinding | undefined => {
    const active = vscode.window.activeTextEditor;
    if (active && ['file', 'vscode-remote'].includes(active.document.uri.scheme)) return editorContext()?.binding;
    const selected = pr.state.binding ?? checkpoints?.state.binding ?? handoffContext?.state.binding;
    if (selected) return repositories.bindingFor(selected.workspaceUri);
    const all = folders(); return all.length === 1 ? repositories.bindingFor(all[0]!.uri) : undefined;
  };
  // The repo-wide Atlas reuses the existing indexed snapshot endpoint and
  // never changes the workspace binding. Component drill-down reuses Map.
  const fullRepositoryAtlas = new RepositoryAtlasPanel(context.extensionUri, api, {
    trusted: () => vscode.workspace.isTrusted,
    bindings: () => folders().flatMap(folder => {
      const binding = repositories.bindingFor(folder.uri); return binding ? [binding] : [];
    }),
    current: binding => repositories.bindingFor(binding.workspaceUri, binding),
    focus: async (binding, component, reference, graph) => {
      const target = {
        binding,
        snapshot: { snapshotId: graph.snapshotId, repositoryIdentity: graph.repositoryIdentity,
          indexedCommit: graph.indexedCommit, limitations: graph.limitations },
        component, reference,
        // An indexed-only target. No real local editor selection is claimed.
        sourceContext: { workspaceUri: binding.workspaceUri, repositoryRootUri: binding.workspaceUri,
          file: reference.file, selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          hasSelection: false, hasUnsavedChanges: false, binding, revision: 'unknown' as const },
        scopeNotice: 'Selected from the complete indexed repository architecture.',
      };
      atlasPanel.show(); await atlas.open(target);
    },
    source: async (binding, component, reference, graph) => {
      await source.openWorkspaceSource({ binding,
        snapshot: { snapshotId: graph.snapshotId, repositoryIdentity: graph.repositoryIdentity,
          indexedCommit: graph.indexedCommit, limitations: graph.limitations },
        sourceContext: { workspaceUri: binding.workspaceUri, repositoryRootUri: binding.workspaceUri,
          file: reference.file, selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          hasSelection: false, hasUnsavedChanges: false, binding, revision: 'unknown' as const },
      }, reference);
    },
  });
  // Saved identity may retain local editing state during a transient outage;
  // bindingFor remains the only actionable, revalidated evidence binding.
  const recoverableBinding = (): RepositoryBinding | undefined => {
    if (!vscode.workspace.isTrusted) return;
    const active = vscode.window.activeTextEditor;
    const selected = pr.state.binding ?? checkpoints?.state.binding ?? handoffContext?.state.binding;
    const uri = active && ['file','vscode-remote'].includes(active.document.uri.scheme)
      ? editorContext()?.workspaceUri : selected?.workspaceUri ?? (folders().length === 1 ? folders()[0]?.uri : undefined);
    const folder = folders().find(item => item.uri === uri); if (!folder) return;
    const state = repositories.context(folder);
    if (!['saved','connecting','unavailable'].includes(state.status) || state.comparison?.identity === 'mismatch') return;
    return state.binding?.backendUrl === api.backendIdentity ? state.binding : undefined;
  };
  const pr = new PrController(api, { trusted: () => vscode.workspace.isTrusted, binding: activeBinding });
  const localCheckpointContext = (): LocalCheckpointContext => {
    const binding = activeBinding(); const local = binding ? git.read(vscode.Uri.parse(binding.workspaceUri)) : {};
    return { ...(local.branch && local.branch.length <= 200 ? { branch: local.branch } : {}), ...(local.head ? { headCommit: local.head } : {}),
      gitStatus: editorContext()?.hasUnsavedChanges || local.dirty === true ? 'modified' : local.dirty === false ? 'clean' : 'unknown' };
  };
  const tasks = checkpoints = new CheckpointController(api, { binding: activeBinding, trusted: () => vscode.workspace.isTrusted, local: localCheckpointContext, recoverableBinding });
  let checkpointActions: CheckpointCommands | undefined;
  const checkpointPanel = new CheckpointPanel(context.extensionUri, tasks, { binding: activeBinding, recoverableBinding, perform: async (type, value) => { await checkpointActions?.perform(type, value); } });
  const handoffs = handoffContext = new HandoffController(api, { binding: activeBinding, trusted: () => vscode.workspace.isTrusted, recoverableBinding });
  let handoffActions: HandoffCommands | undefined;
  const handoffPanel = new HandoffPanel(context.extensionUri, handoffs, async (type,value) => { await handoffActions?.perform(type,value); }, activeBinding);
  const changesTree = new ChangesTree(pr, () => Boolean(activeBinding()));
  const changesView = new ChangesView(context.extensionUri, pr, changesTree);
  let focusVisible = false; let checkpointAnchor: string | undefined;
  let disposed = false;
  const check = async () => {
    if (disposed) return;
    const gitReady = git.initialize();
    await connection.check();
    await gitReady;
    if (!disposed) await repositories.restore();
  };
  context.subscriptions.push(connection, git, repositories, temporary, checkpointTemporary, handoffTemporary, handoffs, handoffPanel, tasks, checkpointPanel, mentor, source, mentorPanel, atlas, atlasPanel, fullRepositoryAtlas, atlasTree, pr, changesTree, changesView,
    handoffs.onChange(() => { handoffTemporary.setSession(handoffs.state.binding, handoffs.state.detail?.id); source.contextChanged(); }),
    tasks.onChange(() => { checkpointTemporary.setSession(tasks.state.binding, tasks.state.detail?.checkpoint.id); mentor.contextChanged(); atlas.contextChanged(); source.contextChanged(); }),
    pr.onChange(() => {
      temporary.setSession(pr.state.binding, pr.state.comparison?.id);
      mentor.contextChanged(); atlas.contextChanged(); source.contextChanged(); changesTree.refresh();
    }),
    vscode.window.registerWebviewViewProvider('codebaseMentor.changes', changesView, { webviewOptions: { retainContextWhenHidden: true } }),
    atlas.onChange(() => atlasTree.refresh()),
    vscode.workspace.registerTextDocumentContentProvider('codebase-mentor-source', source),
    repositories.onChange(() => {
      pr.contextChanged(); tasks.contextChanged(); handoffs.contextChanged(); mentor.contextChanged(); source.contextChanged(); atlas.contextChanged(); atlasTree.refresh(); changesTree.refresh();
      const binding = activeBinding(); const anchor = binding && JSON.stringify([binding.backendUrl, binding.workspaceUri, binding.snapshotId, binding.connectedAt]);
      if (anchor !== checkpointAnchor) { checkpointAnchor = anchor; if (anchor && focusVisible) { void tasks.refresh(); void handoffs.refresh(); } }
    }),
    { dispose: () => { disposed = true; } });
  const focusProvider = new FocusView(context.extensionUri, {
    connection: () => connection.state, repositories, editor: editorContext,
    mentor: () => mentor.state, tasks: () => tasks.state, handoffs: () => handoffs.state,
    folders, trusted: () => vscode.workspace.isTrusted,
  }, visible => {
    focusVisible = visible;
    if (visible) { void tasks.refresh(); void handoffs.refresh(); }
  });
  context.subscriptions.push(focusProvider,
    vscode.window.registerWebviewViewProvider('codebaseMentor.focus', focusProvider, { webviewOptions: { retainContextWhenHidden: true } }),
    tasks.onChange(() => focusProvider.refresh()), handoffs.onChange(() => focusProvider.refresh()),
    connection.onChange(() => focusProvider.refresh()), repositories.onChange(() => focusProvider.refresh()),
    mentor.onChange(() => focusProvider.refresh()),
    vscode.window.onDidChangeActiveTextEditor(() => focusProvider.refresh()),
    vscode.window.onDidChangeTextEditorSelection(() => focusProvider.refresh()));
  registerCommands(context, connection, check);
  registerRepositoryCommands(context, repositories, git, connection);
  registerMentorCommands(context, mentor, mentorPanel, source, editorContext);
  registerAtlasCommands(context, atlas, mentor, mentorPanel, source, atlasPanel, () => fullRepositoryAtlas.show());
  registerPrCommands(context, pr, api, temporary, atlas, mentor, mentorPanel, source, editorContext, async (resolved,origin) => { await handoffActions?.launch({binding:resolved.binding,componentId:resolved.component.id,sourceReferenceIds:[resolved.component.referenceId],origin}); });
  checkpointActions = registerCheckpointCommands(context, tasks, checkpointPanel, checkpointTemporary, mentor, mentorPanel, atlas, pr, source, editorContext, activeBinding, localCheckpointContext, async seed => { await handoffActions?.launch(seed); });
  handoffActions = registerHandoffCommands(context, handoffs, handoffPanel, mentor, atlas, handoffTemporary, source, editorContext, activeBinding);
  let editorTimer: ReturnType<typeof setTimeout> | undefined;
  const refreshEditor = () => {
    pr.contextChanged(); tasks.contextChanged(); handoffs.contextChanged(); mentor.contextChanged(); source.contextChanged(); atlas.contextChanged();
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
  // Read-only extension API for IDE commands; context is transient and never persisted here.
  return { getEditorContext: editorContext, getMentorState: () => mentor.state, getAtlasState: () => atlas.state, getPrState: () => pr.state, getCheckpointState: () => tasks.state, getHandoffState: () => handoffs.state,
    getSelectedComponentContext: () => mentor.selectedContext(), getRepositoryContext: (uri: string) => {
    const folder = folders().find(item => item.uri === uri);
    return folder ? repositories.context(folder) : undefined;
  } };
}
