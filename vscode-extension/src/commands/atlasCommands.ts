import * as vscode from 'vscode';
import type { AtlasController } from '../atlasController';
import type { MentorController } from '../mentorController';
import type { MentorPanel } from '../views/mentorPanel';
import type { SourceNavigation } from '../vscode-adapters/sourceNavigation';
import type { AtlasAction, AtlasItem } from '../views/atlasTree';

export function fullAtlasUrl(value: string): string {
  const url = new URL(value); const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || local && url.protocol === 'http:') || url.username || url.password || url.search || url.hash) throw new Error('Configure a web platform root using HTTPS or loopback HTTP, without credentials, query or fragment.');
  url.pathname = `${url.pathname.replace(/\/$/, '')}/`; url.hash = '/workspace'; return url.href;
}
export function registerAtlasCommands(context: vscode.ExtensionContext, atlas: AtlasController, mentor: MentorController, panel: MentorPanel, source: SourceNavigation): void {
  const focus = () => vscode.commands.executeCommand('codebaseMentor.map.focus');
  const register = (name: string, handler: (action?: AtlasAction) => Promise<unknown>) => context.subscriptions.push(vscode.commands.registerCommand(`codebaseMentor.${name}`, async (raw?: AtlasAction | AtlasItem) => {
    try { const action = raw && 'action' in raw ? raw.action : raw as AtlasAction | undefined; await handler(action); }
    catch (error) { void vscode.window.showErrorMessage(`Codebase Mentor: ${error instanceof Error ? error.message : 'Map action failed.'}`); }
  }));
  register('showRelatedCode', async () => { await atlas.showRelated(); await focus(); });
  register('openMap', async () => { if (!atlas.state.result) { const target = mentor.selectedContext(); if (target) await atlas.open(target); else await atlas.showRelated(); } await focus(); });
  register('showMentorRelated', async () => { const target = mentor.selectedContext(); if (!target) throw new Error('Select a current Mentor answer first.'); await atlas.open(target); await focus(); });
  register('refreshMap', async () => { await atlas.refresh(); });
  register('mapBack', async () => { await atlas.back(); });
  register('mapBackToEditor', async () => { await atlas.backToEditor(); });
  register('exploreComponent', async action => { if (!action?.componentId) throw new Error('Choose a related component in Map.'); await atlas.explore(action.componentId, action.viewId); });
  register('openAtlasSource', async action => {
    if (!action?.referenceId) throw new Error('Choose source evidence in Map.');
    const result = atlas.current(action.viewId); const reference = result.neighborhood.references.find(r => r.id === action.referenceId);
    if (!reference) throw new Error('This reference is not in the current neighborhood.');
    await source.openReference(result.target, reference);
  });
  register('explainAtlasComponent', async action => {
    if (!action?.componentId) throw new Error('Choose a component in Map.');
    const target = atlas.targetFor(action.componentId, action.viewId); panel.show(); await mentor.explainComponent(target);
  });
  register('openFullAtlas', async () => {
    const root = vscode.workspace.getConfiguration('codebaseMentor').get<string>('webBaseUrl', 'http://127.0.0.1:5173');
    await vscode.env.openExternal(vscode.Uri.parse(fullAtlasUrl(root)));
    void vscode.window.showInformationMessage('Opened the web workspace. Select the repository there; this web route does not restore the Map component or snapshot.');
  });
}
