import * as vscode from 'vscode';
import type { HandoffController } from '../handoffController';
import type { HandoffPanel } from '../views/handoffPanel';
import type { HandoffInput } from '../api-client/handoffContracts';
import type { RepositoryBinding } from '../repository';
import type { MentorController, ResolvedComponentContext } from '../mentorController';
import type { AtlasController } from '../atlasController';
import type { EditorContext } from '../vscode-adapters/editorContext';
import type { ComparisonContexts } from '../comparisonContexts';
import type { SourceNavigation } from '../vscode-adapters/sourceNavigation';
import type { AtlasAction, AtlasItem } from '../views/atlasTree';
import type { HandoffAction, HandoffItem } from '../views/savedHandoffs';
import { checkpointActionContext } from '../views/savedTasks';
export interface HandoffSeed {
    binding: RepositoryBinding;
    componentId?: string;
    sourceReferenceIds: string[];
    origin: HandoffInput['origin'];
}
export interface HandoffCommands {
    launchLocal(seed: HandoffSeed): Promise<void>;
    launch(seed: HandoffSeed): Promise<void>;
    perform(type: string, value: Record<string, unknown>): Promise<void>;
}
export function registerHandoffCommands(context: vscode.ExtensionContext, handoffs: HandoffController, panel: HandoffPanel, mentor: MentorController, atlas: AtlasController, temporary: ComparisonContexts, source: SourceNavigation, editor: () => EditorContext | undefined, binding: () => RepositoryBinding | undefined, share?: (seed: HandoffSeed) => Promise<void>): HandoffCommands {
    const active = new Set<AbortController>();
    context.subscriptions.push({ dispose: () => { for (const c of active)
            c.abort(); active.clear(); } });
    const launchLocal = async (seed: HandoffSeed) => { if (panel.revealDraft(seed.binding, seed.componentId, seed.origin))
        return; if (!await handoffs.prepare(seed.binding))
        return; panel.compose(seed.binding, { snapshotId: seed.binding.snapshotId, ...(seed.componentId ? { componentId: seed.componentId } : {}), sourceReferenceIds: seed.sourceReferenceIds.slice(0, 16), question: '', attemptedSteps: '', additionalContext: '', origin: seed.origin }); };
    const launch = async (seed: HandoffSeed) => share ? share(seed) : launchLocal(seed);
    const fromTarget = async (target: ResolvedComponentContext | undefined, type: 'editor' | 'mentor' | 'map') => { if (!target)
        throw new Error('Choose a supported indexed component first'); await launch({ binding: target.binding, componentId: target.component.id, sourceReferenceIds: [target.component.referenceId], origin: { type } }); };
    const editorLaunch = async () => { const selection = editor(); if (!selection)
        throw new Error('Select code in a connected trusted workspace'); const c = new AbortController(); active.add(c); try {
        await fromTarget(await mentor.resolveContext(selection, c.signal), 'editor');
    }
    finally {
        active.delete(c);
    } };
    const choose = async (action?: HandoffAction) => { if (action?.contextId && action.contextId !== checkpointActionContext(binding()))
        throw new Error('Stale repository'); if (action?.id) {
        if (handoffs.state.detail?.id !== action.id && !handoffs.state.page?.items.some(item => item.id === action.id))
            throw new Error('Unknown handoff');
        return action.id;
    } if (!handoffs.state.page)
        await handoffs.refresh(); const anchor = checkpointActionContext(binding()); const item = await vscode.window.showQuickPick((handoffs.state.page?.items ?? []).map(item => ({ label: item.question, description: item.createdAt.slice(0, 10), id: item.id })), { title: 'Codebase Mentor: Saved Handoffs' }); if (anchor !== checkpointActionContext(binding()))
        throw new Error('Context changed'); return item?.id; };
    const remove = async (id: string, viewId: string) => { if (handoffs.state.viewId !== viewId)
        throw new Error('Stale action'); if (handoffs.state.detail?.id !== id && !handoffs.state.page?.items.some(item => item.id === id))
        throw new Error('Unknown handoff'); const answer = await vscode.window.showWarningMessage('Delete this saved handoff?', { modal: true, detail: 'Only this handoff will be deleted. Checkpoints and repository snapshots remain.' }, 'Delete handoff'); if (answer === 'Delete handoff')
        await handoffs.delete(id, viewId); };
    const perform = async (type: string, value: Record<string, unknown>) => {
        if (type === 'new') {
            await editorLaunch();
            return;
        }
        if (type === 'refresh') {
            await handoffs.refresh();
            return;
        }
        if (type === 'previous' || type === 'next') {
            const page = handoffs.state.page;
            if (page && (type === 'previous' || page.hasMore))
                await handoffs.refresh(type === 'next' ? page.offset + page.limit : Math.max(0, page.offset - page.limit));
            return;
        }
        if (typeof value.viewId !== 'string' || value.viewId !== handoffs.state.viewId)
            throw new Error('Stale action');
        if (type === 'open') {
            if (typeof value.handoffId !== 'string')
                return;
            const id = await choose({ id: value.handoffId });
            if (id) {
                await handoffs.open(id);
                panel.details();
            }
            return;
        }
        if (type === 'delete') {
            if (typeof value.handoffId === 'string')
                await remove(value.handoffId, value.viewId);
            return;
        }
        const state = handoffs.current(value.viewId);
        if (value.handoffId !== state.detail.id)
            throw new Error('Wrong saved handoff');
        if (type === 'copy' || type === 'export') {
            // Obtain exact canonical bytes only after explicit action. No content-derived paths.
            if (type === 'copy') {
                const markdown = await handoffs.export(value.viewId);
                handoffs.current(value.viewId);
                await vscode.env.clipboard.writeText(markdown);
                handoffs.current(value.viewId);
                handoffs.notifyExport('copy');
                return;
            }
            const destination = await vscode.window.showSaveDialog({ title: 'Export reviewed handoff as Markdown', filters: { Markdown: ['md'] }, saveLabel: 'Export Markdown' });
            if (!destination)
                return;
            handoffs.current(value.viewId);
            if (destination.scheme !== 'file')
                throw new Error('Choose a local Markdown file');
            const markdown = await handoffs.export(value.viewId);
            handoffs.current(value.viewId);
            await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(markdown));
            handoffs.current(value.viewId);
            handoffs.notifyExport('file');
            return;
        }
        if (type === 'source' && typeof value.referenceId === 'string') {
            const reference = state.detail.context.references.find(r => r.id === value.referenceId);
            if (!reference)
                throw new Error('Excluded source');
            const saved = state.detail.context;
            const snapshot = { snapshotId: saved.snapshotId, repositoryIdentity: saved.repositoryIdentity, indexedCommit: saved.indexedCommit, limitations: saved.limitations };
            const temporaryBinding = temporary.create(state.binding, state.detail.id, snapshot, 'before');
            const current = editor();
            const sourceContext: EditorContext = current?.workspaceUri === state.binding.workspaceUri ? { ...current, binding: temporaryBinding } : { workspaceUri: state.binding.workspaceUri, repositoryRootUri: state.binding.workspaceUri, file: reference.file, binding: temporaryBinding, selection: { start: { line: reference.startLine - 1, character: 0 }, end: { line: reference.startLine - 1, character: 0 } }, hasSelection: false, hasUnsavedChanges: false, revision: 'unknown', viewColumn: vscode.ViewColumn.One };
            await source.openReference({ binding: temporaryBinding, snapshot, sourceContext }, reference);
        }
    };
    const register = (name: string, handler: (raw?: HandoffAction) => Promise<unknown>) => context.subscriptions.push(vscode.commands.registerCommand(`codebaseMentor.${name}`, async (raw?: HandoffAction | HandoffItem) => { try {
        await handler(raw && 'handoffAction' in raw ? raw.handoffAction : raw as HandoffAction | undefined);
    }
    catch {
        void vscode.window.showErrorMessage('Handoff action failed. Review the intended repository and backend availability.');
    } }));
    register('askSeniorWithContext', editorLaunch);
    register('askSeniorMentor', async () => { await fromTarget(mentor.selectedContext(), 'mentor'); });
    context.subscriptions.push(vscode.commands.registerCommand('codebaseMentor.askSeniorMap', async (raw?: AtlasAction | AtlasItem) => { try {
        const action = raw && 'action' in raw ? raw.action : raw as AtlasAction | undefined;
        const result = atlas.state.result;
        if (!result)
            throw new Error();
        await fromTarget(atlas.targetFor(action?.componentId ?? result.target.component.id, action?.viewId ?? result.id), 'map');
    }
    catch {
        void vscode.window.showErrorMessage('Select a current Map component for the handoff.');
    } }));
    register('refreshHandoffs', async () => { await handoffs.refresh(); });
    register('openHandoff', async (action) => { const id = await choose(action); if (id) {
        await handoffs.open(id);
        panel.details();
    } });
    register('deleteHandoff', async (action) => { const id = await choose(action); if (id)
        await remove(id, handoffs.state.viewId); });
    register('nextHandoffs', async () => { await perform('next', {}); });
    register('previousHandoffs', async () => { await perform('previous', {}); });
    return { launch, launchLocal, perform };
}
