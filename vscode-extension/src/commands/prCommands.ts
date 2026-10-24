import type { HandoffInput } from '../api-client/handoffContracts';
import * as vscode from 'vscode';
import type { MentorApi } from '../api-client/client';
import type { PrComponent, PrComparison } from '../api-client/prContracts';
import type { PrController } from '../prController';
import type { ComparisonContexts } from '../comparisonContexts';
import type { AtlasController } from '../atlasController';
import type { MentorController, ResolvedComponentContext } from '../mentorController';
import type { MentorPanel } from '../views/mentorPanel';
import type { SourceNavigation } from '../vscode-adapters/sourceNavigation';
import type { EditorContext } from '../vscode-adapters/editorContext';
import type { ChangesAction, ChangesItem } from '../views/changesTree';
import type { SourceReference } from '../api-client/mentorContracts';

type Side = 'before' | 'after';
export function comparisonComponent(result: PrComparison, side: Side, componentId: string, referenceId?: string): PrComponent {
  const component = [...result.components.flatMap(c => c[side] ? [c[side]!] : []), ...result.impact[side]].find(c => c.id === componentId && (!referenceId || c.reference.id === referenceId));
  if (!component) throw new Error('This component does not belong to the selected comparison side.'); return component;
}
export function comparisonReference(result: PrComparison, side: Side, referenceId: string): SourceReference {
  const candidates = [...result.components.flatMap(c => c[side] ? [c[side]!.reference] : []), ...result.impact[side].map(c => c.reference), ...result.edges[side === 'after' ? 'added' : 'removed'].map(e => e.reference)];
  const reference = candidates.find(r => r.id === referenceId);
  if (!reference) throw new Error('This evidence is unavailable in the selected comparison side.'); return reference;
}

export function registerPrCommands(context: vscode.ExtensionContext, pr: PrController, api: MentorApi, temporary: ComparisonContexts, atlas: AtlasController, mentor: MentorController, panel: MentorPanel, source: SourceNavigation, editor: () => EditorContext | undefined, handoff?: (target: ResolvedComponentContext, origin: HandoffInput['origin']) => Promise<void>): void {
  const sideMetadata = new Map<string, Awaited<ReturnType<MentorApi['snapshot']>>>();
  const active = new Set<AbortController>();
  context.subscriptions.push(pr.onChange(() => {
    const state = pr.state; if (!state.comparison) { sideMetadata.clear(); for (const controller of active) controller.abort(); }
  }), { dispose: () => { for (const controller of active) controller.abort(); sideMetadata.clear(); } });
  const target = async (action: ChangesAction, reference: SourceReference, component?: PrComponent): Promise<ResolvedComponentContext> => {
    const state = pr.current(action.viewId); const side = action.side!; const comparison = state.comparison;
    const snapshotId = side === 'before' ? comparison.beforeSnapshotId : comparison.afterSnapshotId;
    const repository = side === 'before' ? comparison.pr.baseRepository : comparison.pr.headRepository;
    const commit = side === 'before' ? comparison.pr.baseCommit : comparison.pr.headCommit;
    const cacheKey = `${state.binding.backendUrl}:${comparison.id}:${side}`;
    let snapshot = sideMetadata.get(cacheKey);
    if (!snapshot) {
      const controller = new AbortController(); active.add(controller);
      try { snapshot = await api.snapshot(snapshotId, controller.signal); } finally { active.delete(controller); }
      pr.current(action.viewId);
      if (snapshot.snapshotId !== snapshotId || snapshot.repositoryIdentity !== repository || snapshot.indexedCommit !== commit) throw new Error('Comparison-side snapshot identity does not match its pinned PR version.');
      sideMetadata.set(cacheKey, snapshot); while (sideMetadata.size > 2) sideMetadata.delete(sideMetadata.keys().next().value!);
    }
    const binding = temporary.create(state.binding, comparison.id, snapshot, side);
    const original = editor();
    const sourceContext: EditorContext = original?.workspaceUri === binding.workspaceUri ? { ...original, binding } : {
      workspaceUri: binding.workspaceUri, repositoryRootUri: binding.workspaceUri, file: reference.file, binding,
      selection: { start: { line: reference.startLine - 1, character: 0 }, end: { line: reference.startLine - 1, character: 0 } },
      hasSelection: false, hasUnsavedChanges: false, revision: 'unknown', viewColumn: vscode.ViewColumn.One,
    };
    return { binding, snapshot, component: component ? { id: component.id, name: component.name, role: component.role, referenceId: component.reference.id } : { id: 'evidence', name: 'Comparison evidence', role: 'evidence', referenceId: reference.id }, sourceContext,
      scopeNotice: `PR #${comparison.pr.number} · ${side === 'before' ? 'before / merge base' : 'after / head'} · ${commit.slice(0, 12)}. Temporary exploration; saved workspace binding is unchanged.` };
  };
  const register = (name: string, handler: (action?: ChangesAction) => Promise<unknown>) => context.subscriptions.push(vscode.commands.registerCommand(`codebaseMentor.${name}`, async (raw?: ChangesAction | ChangesItem) => {
    try {
      const action = raw && 'action' in raw ? raw.action : raw as ChangesAction | undefined;
      if (action?.viewId && action.viewId !== pr.state.viewId) throw new Error('This Changes action is stale. Use the current repository and PR selection.');
      await handler(action);
    }
    catch (error) { void vscode.window.showErrorMessage(`Codebase Mentor: ${error instanceof Error ? error.message : 'PR action failed.'}`); }
  }));
  const sideAction = (action?: ChangesAction): ChangesAction & { side: Side } => {
    if (!action || !['before', 'after'].includes(action.side ?? '')) throw new Error('Choose a before or after item in Changes.');
    pr.current(action.viewId); return action as ChangesAction & { side: Side };
  };
  register('openChanges', async () => { await vscode.commands.executeCommand('codebaseMentor.changes.focus'); await pr.open(); });
  register('refreshPrList', async () => { await pr.refreshList(); });
  register('prNextPage', async () => { await pr.nextPage(); });
  register('prPreviousPage', async () => { await pr.previousPage(); });
  register('prFilterList', async () => { const state = await vscode.window.showQuickPick(['all', 'open', 'closed'] as const, { title: 'Codebase Mentor: PR State' }); if (state) await pr.refreshList(state as 'all' | 'open' | 'closed'); });
  register('selectPr', async action => {
    if (!action?.url) throw new Error('Choose a discovered PR.');
    const item = pr.state.page?.pullRequests.find(p => p.url === action.url); pr.select(item ?? action.url);
  });
  register('prEnterUrl', async () => {
    const url = await vscode.window.showInputBox({ title: 'Codebase Mentor: Select Remote PR', prompt: 'Public GitHub PR URL for the connected base repository. Analysis starts only when requested.', ignoreFocusOut: true });
    if (url !== undefined) pr.select(url.trim());
  });
  register('startPrAnalysis', async () => { await pr.start(); });
  register('resumePrJob', async () => { await pr.resume(); });
  register('cancelPrWaiting', async () => { pr.cancel(); });
  register('refreshPrComparison', async () => { await pr.refreshComparison(); });
  register('reanalyzePr', async () => { await pr.reanalyze(); });
  register('openPrSource', async raw => {
    const action = sideAction(raw); if (!action.referenceId) throw new Error('Choose source evidence.');
    const reference = comparisonReference(pr.current(action.viewId).comparison, action.side, action.referenceId);
    await source.openReference(await target(action, reference), reference);
  });
  register('prExploreMap', async raw => {
    const action = sideAction(raw); if (!action.componentId) throw new Error('Choose a comparison component.');
    const component = comparisonComponent(pr.current(action.viewId).comparison, action.side, action.componentId, action.referenceId);
    await atlas.open(await target(action, component.reference, component)); await vscode.commands.executeCommand('codebaseMentor.openMap');
  });
  register('prExplainComponent', async raw => {
    const action = sideAction(raw); if (!action.componentId) throw new Error('Choose a comparison component.');
    const component = comparisonComponent(pr.current(action.viewId).comparison, action.side, action.componentId, action.referenceId);
    const resolved = await target(action, component.reference, component); panel.show(); await mentor.explainComponent(resolved);
  });
  register('askSeniorChange', async raw => {
    const action = sideAction(raw); if (!action.componentId || !handoff) throw new Error('Choose a comparison component.');
    const result = pr.current(action.viewId).comparison;
    const component = comparisonComponent(result, action.side, action.componentId, action.referenceId);
    const resolved = await target(action, component.reference, component); pr.current(action.viewId);
    await handoff(resolved, { type:'pr', comparisonId:result.id, comparisonSide:action.side });
  });
  register('openPrDiff', async action => {
    if (!action || !Number.isInteger(action.fileIndex)) throw new Error('Choose a changed file.');
    const result = pr.current(action.viewId).comparison; const file = result.pr.files[action.fileIndex!];
    if (!file) throw new Error('Changed file is unavailable.');
    const find = (side: Side, filePath: string) => [...result.components.flatMap(c => c[side] ? [c[side]!] : []), ...result.impact[side]].find(c => c.reference.file === filePath)?.reference;
    const before = find('before', file.previousPath ?? file.path); const after = find('after', file.path);
    if (!file.hidden && before && after) {
      try { await source.openDiff(await target({ ...action, side: 'before' }, before), before, await target({ ...action, side: 'after' }, after), after); return; }
      catch { pr.current(action.viewId); /* Explicit fallback below; never substitute a patch or working tree. */ }
    }
    pr.current(action.viewId);
    const chosen = await vscode.window.showInformationMessage('Exact complete source for both comparison sides is unavailable. Open the real GitHub PR files page?', 'Open PR files');
    pr.current(action.viewId); if (chosen === 'Open PR files') await vscode.env.openExternal(vscode.Uri.parse(`${result.pr.url}/files`));
  });
}
