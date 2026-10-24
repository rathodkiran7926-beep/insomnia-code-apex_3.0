import * as vscode from 'vscode';
import type { HandoffState } from '../handoffController';
import { checkpointActionContext } from './savedTasks';
export interface HandoffAction {
    id?: string;
    contextId?: string;
}
export class HandoffItem extends vscode.TreeItem {
    handoffAction?: HandoffAction;
}
export function savedHandoffItems(state: HandoffState): HandoffItem[] {
    const row = (label: string, command?: string, action?: HandoffAction) => { const item = new HandoffItem(label, vscode.TreeItemCollapsibleState.None); item.iconPath = new vscode.ThemeIcon('export'); item.tooltip = label; item.handoffAction = action; if (command)
        item.command = { command: `codebaseMentor.${command}`, title: label, arguments: action ? [action] : [] }; return item; };
    return [row(state.message), ...(state.page?.items.map(saved => { const action = { id: saved.id, contextId: checkpointActionContext(state.binding) }; const item = row(saved.question, 'openHandoff', action); item.id = `handoff-task:${action.contextId}:${saved.id}`; item.contextValue = 'savedHandoff'; item.description = `${saved.createdAt.slice(0, 10)} · ${saved.indexedCommit.slice(0, 12)} · ready`; return item; }) ?? []), ...(state.status === 'ready' && state.page && !state.page.items.length ? [row('No saved handoffs yet.')] : []), row('Ask Senior with Context', 'askSeniorWithContext'), row('Refresh Saved Handoffs', 'refreshHandoffs'), ...(state.page?.hasMore ? [row('Next Handoffs', 'nextHandoffs')] : []), ...(state.page && state.page.offset > 0 ? [row('Previous Handoffs', 'previousHandoffs')] : [])];
}
