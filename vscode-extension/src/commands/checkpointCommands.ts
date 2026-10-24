import type { HandoffSeed } from './handoffCommands';
import * as vscode from 'vscode';
import type { CheckpointController } from '../checkpointController';
import type { CheckpointPanel } from '../views/checkpointPanel';
import { checkpointActionContext, type CheckpointAction, type SavedTaskItem } from '../views/savedTasks';
import type { MentorController, ResolvedComponentContext } from '../mentorController';
import type { AtlasController } from '../atlasController';
import type { MentorPanel } from '../views/mentorPanel';
import type { ComparisonContexts } from '../comparisonContexts';
import type { SourceNavigation } from '../vscode-adapters/sourceNavigation';
import type { EditorContext } from '../vscode-adapters/editorContext';
import type { LocalCheckpointContext } from '../api-client/checkpointContracts';
import type { PrController } from '../prController';
import type { Component, SourceReference } from '../api-client/mentorContracts';
import type { RepositoryBinding } from '../repository';

class CheckpointActionError extends Error {}

export interface CheckpointCommands {
  save(): Promise<void>;
  perform(type: string, value: Record<string, unknown>): Promise<void>;
}
export function registerCheckpointCommands(context: vscode.ExtensionContext, checkpoints: CheckpointController, panel: CheckpointPanel, temporary: ComparisonContexts, mentor: MentorController, mentorPanel: MentorPanel, atlas: AtlasController, pr: PrController, source: SourceNavigation, editor: () => EditorContext | undefined, binding: () => RepositoryBinding | undefined, local: () => LocalCheckpointContext, handoff?: (seed:HandoffSeed)=>Promise<void>): CheckpointCommands {
  const active = new Set<AbortController>();
  context.subscriptions.push({ dispose: () => { for (const c of active) c.abort(); active.clear(); } });
  const ensure = (viewId?: string) => { if (viewId && viewId !== checkpoints.state.viewId) throw new CheckpointActionError('This saved-task action is stale. Refresh Saved Tasks.'); };
  const save = async () => {
    const parent = await checkpoints.prepare(); if (!parent) return;
    const choices: { reference: SourceReference; component?: Component }[] = []; let notice = 'No automatic source or editor-buffer upload. Reference attachments are optional.';
    const current = editor();
    if (current?.binding?.snapshotId === parent.snapshotId && current.workspaceUri === parent.workspaceUri) {
      const controller = new AbortController(); active.add(controller);
      try {
        const resolved = await mentor.resolveContext(current, controller.signal);
        if (resolved) {
          if (resolved.reference) choices.push({ reference: resolved.reference, component: resolved.component });
          notice = resolved.scopeNotice;
        }
      } catch { notice = 'Current selection could not be resolved. You can save notes without source attachments.'; }
      finally { active.delete(controller); }
    }
    const graph = atlas.state.result;
    if (graph?.target.binding.workspaceUri === parent.workspaceUri && graph.neighborhood.snapshotId === parent.snapshotId && graph.target.binding.backendUrl === parent.backendUrl) {
      for (const reference of graph.neighborhood.references.slice(0, 8)) if (!choices.some(c => c.reference.id === reference.id)) choices.push({ reference, component: graph.neighborhood.components.find(c => c.referenceId === reference.id) });
    }
    if (binding()?.connectedAt !== parent.connectedAt || binding()?.snapshotId !== parent.snapshotId || binding()?.backendUrl !== parent.backendUrl) return;
    panel.edit({ binding: parent, localContext: local(), choices: choices.slice(0, 8), notice });
  };
  const choose = async (action?: CheckpointAction): Promise<string | undefined> => {
    ensure(action?.viewId);
    if (action?.contextId && action.contextId !== checkpointActionContext(binding())) throw new CheckpointActionError('This saved-task repository context is stale. Refresh Saved Tasks.');
    if (action?.id) {
      if (checkpoints.state.detail?.checkpoint.id !== action.id && !checkpoints.state.page?.items.some(item => item.id === action.id)) throw new CheckpointActionError('Choose a checkpoint from the current saved-task list.');
      return action.id;
    }
    if (!checkpoints.state.page) await checkpoints.refresh();
    const token = checkpoints.state.viewId;
    const selected = await vscode.window.showQuickPick((checkpoints.state.page?.items ?? []).map(item => ({ label: item.taskTitle, description: `${item.createdAt.slice(0, 10)} · ${item.indexedCommit.slice(0, 12)}`, id: item.id })), { title: 'Codebase Mentor: Saved Tasks' });
    ensure(token); return selected?.id;
  };
  const remove = async (action?: CheckpointAction) => {
    const id = await choose(action); if (!id) return; const state = checkpoints.state; const token = state.viewId;
    const title = state.page?.items.find(item => item.id === id)?.taskTitle ?? (state.detail?.checkpoint.id === id ? state.detail.checkpoint.taskTitle : 'selected checkpoint');
    const answer = await vscode.window.showWarningMessage(`Delete saved task “${title}”?`, { modal: true, detail: 'Only this task checkpoint will be deleted. Repository snapshots and other checkpoints remain.' }, 'Delete checkpoint');
    if (answer === 'Delete checkpoint') { ensure(token); await checkpoints.delete(id, token); }
  };
  const target = (viewId: string, referenceId?: string, componentId?: string): { resolved: ResolvedComponentContext; reference: SourceReference } => {
    const state = checkpoints.current(viewId); const detail = state.detail; const checkpoint = detail.checkpoint;
    if (!detail.snapshotAvailable) throw new Error('The saved snapshot is unavailable. Original notes remain readable.');
    const component = componentId ? detail.components.find(c => c.id === componentId && (!referenceId || c.referenceId === referenceId)) : undefined;
    if (componentId && !component) throw new Error('The saved component is unavailable.');
    const reference = detail.references.find(r => r.id === (referenceId ?? component?.referenceId)); if (!reference) throw new Error('The saved source reference is unavailable.');
    const snapshot = { snapshotId: checkpoint.snapshotId, repositoryIdentity: checkpoint.repositoryIdentity, indexedCommit: checkpoint.indexedCommit, limitations: detail.warnings };
    const temporaryBinding = temporary.create(state.binding, checkpoint.id, snapshot, 'before');
    const current = editor(); const sourceContext: EditorContext = current?.workspaceUri === state.binding.workspaceUri ? { ...current, binding: temporaryBinding } : {
      workspaceUri: state.binding.workspaceUri, repositoryRootUri: state.binding.workspaceUri, binding: temporaryBinding, file: reference.file,
      selection: { start: { line: reference.startLine - 1, character: 0 }, end: { line: reference.startLine - 1, character: 0 } }, hasSelection: false, hasUnsavedChanges: false, revision: 'unknown', viewColumn: vscode.ViewColumn.One,
    };
    return { reference, resolved: { binding: temporaryBinding, snapshot, component: component ?? { id: 'saved-evidence', name: 'Saved source evidence', role: 'evidence', referenceId: reference.id }, sourceContext, scopeNotice: `Saved task · original indexed snapshot ${checkpoint.snapshotId} @ ${checkpoint.indexedCommit.slice(0, 12)}. User notes are separate from source facts; saved workspace binding is unchanged.` } };
  };
  const perform = async (type: string, value: Record<string, unknown>) => {
    const action: CheckpointAction = { ...(typeof value.checkpointId === 'string' ? { id: value.checkpointId } : {}), ...(typeof value.viewId === 'string' ? { viewId: value.viewId } : {}) };
    if (type === 'new') { await save(); return; }
    if (type === 'refresh') { await checkpoints.refresh(); return; }
    if (type === 'next') { const page = checkpoints.state.page; if (page?.hasMore) await checkpoints.refresh(page.offset + page.limit); return; }
    if (type === 'previous') { const page = checkpoints.state.page; if (page) await checkpoints.refresh(Math.max(0, page.offset - page.limit)); return; }
    if (type === 'delete') { await remove(action); return; }
    if (type === 'resume') { const id = await choose(action.id ? action : { id: checkpoints.state.detail?.checkpoint.id, viewId: action.viewId }); if (id) { await checkpoints.resume(id); panel.details(); } return; }
    if (typeof value.viewId !== 'string') return;
    const state = checkpoints.current(value.viewId);
    if (type === 'handoff') {
      if (!handoff || !state.detail.snapshotAvailable) throw new Error('Saved snapshot is unavailable.');
      const saved = state.detail.checkpoint; const snapshot = {snapshotId:saved.snapshotId,repositoryIdentity:saved.repositoryIdentity,indexedCommit:saved.indexedCommit,limitations:state.detail.warnings};
      const targetBinding = temporary.create(state.binding,saved.id,snapshot,'before');
      await handoff({binding:targetBinding,componentId:state.detail.components[0]?.id,sourceReferenceIds:saved.sourceReferenceIds,origin:{type:'checkpoint',checkpointId:saved.id}}); return;
    }
    if (type === 'changes') {
      const comparison = state.resume?.comparison;
      if (!comparison) { void vscode.window.showInformationMessage('No matching stored PR comparison is available. No PR association was inferred.'); return; }
      await pr.reviewStored(comparison); await vscode.commands.executeCommand('codebaseMentor.changes.focus'); return;
    }
    const referenceId = typeof value.referenceId === 'string' ? value.referenceId : undefined;
    const componentId = typeof value.componentId === 'string' ? value.componentId : undefined;
    if (!['source', 'map', 'mentor', 'fileDiff'].includes(type)) return;
    const saved = target(value.viewId, referenceId, componentId);
    if (type === 'source') await source.openReference(saved.resolved, saved.reference);
    if (type === 'map' && componentId) { await atlas.open(saved.resolved); await vscode.commands.executeCommand('codebaseMentor.openMap'); }
    if (type === 'mentor' && componentId) { mentorPanel.show(); await mentor.explainComponent(saved.resolved); }
    if (type === 'fileDiff') {
      const resume = state.resume; const change = resume?.changes.items.find(item => item.referenceId === referenceId);
      if (!resume || !change?.currentReference || change.status === 'unknown') throw new Error('Verified stored file comparison is unavailable.');
      const currentBinding = temporary.create(state.binding, state.detail.checkpoint.id, resume.currentSnapshot, 'after');
      await source.openDiff(saved.resolved, saved.reference, { ...saved.resolved, binding: currentBinding, snapshot: resume.currentSnapshot }, change.currentReference, { before: 'saved checkpoint', after: 'current snapshot' });
    }
  };
  const register = (name: string, handler: (action?: CheckpointAction) => Promise<unknown>) => context.subscriptions.push(vscode.commands.registerCommand(`codebaseMentor.${name}`, async (raw?: CheckpointAction | SavedTaskItem) => {
    try { const action = raw && 'checkpointAction' in raw ? raw.checkpointAction : raw as CheckpointAction | undefined; ensure(action?.viewId); await handler(action); }
    catch (error) { void vscode.window.showErrorMessage(error instanceof CheckpointActionError ? error.message : 'Saved-task action could not be completed. Refresh the intended repository context.'); }
  }));
  register('saveTaskCheckpoint', save); register('refreshCheckpoints', async () => { await checkpoints.refresh(); });
  register('resumeTask', async action => { const id = await choose(action); if (id) { await checkpoints.resume(id); panel.details(); } });
  register('viewCheckpointDetails', async action => { const id = await choose(action); if (id) { await checkpoints.view(id); panel.details(); } });
  register('deleteCheckpoint', remove);
  register('askSeniorTask', async action => { const id=await choose(action); if(!id)return; if(checkpoints.state.detail?.checkpoint.id!==id)await checkpoints.view(id); await perform('handoff',{viewId:checkpoints.state.viewId}); });
  register('nextCheckpoints', async () => { const page = checkpoints.state.page; if (page?.hasMore) await checkpoints.refresh(page.offset + page.limit); });
  register('previousCheckpoints', async () => { const page = checkpoints.state.page; if (page) await checkpoints.refresh(Math.max(0, page.offset - page.limit)); });
  return { save, perform };
}
