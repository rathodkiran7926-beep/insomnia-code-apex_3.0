import * as vscode from 'vscode';
import type { AtlasController } from '../atlasController';
import type { MentorController } from '../mentorController';
import type { MentorPanel } from '../views/mentorPanel';
import type { SourceNavigation } from '../vscode-adapters/sourceNavigation';
import type { AtlasAction, AtlasItem } from '../views/atlasTree';
import type { AtlasPanel } from '../views/atlasPanel';

export function fullAtlasUrl(value: string): string {
  const url = new URL(value); const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || local && url.protocol === 'http:') || url.username || url.password || url.search || url.hash) throw new Error('Configure a web platform root using HTTPS or loopback HTTP, without credentials, query or fragment.');
  url.pathname = `${url.pathname.replace(/\/$/, '')}/`; url.hash = '/workspace'; return url.href;
}
export function repositoryArchitectureUrl(value: string): string {
  const url = new URL(fullAtlasUrl(value));
  url.hash = '/repository';
  return url.href;
}
export function registerAtlasCommands(context: vscode.ExtensionContext, atlas: AtlasController, mentor: MentorController, panel: MentorPanel, source: SourceNavigation, diagram: AtlasPanel, openRepositoryGraph?: () => Promise<void>): void {
  // Map is a dedicated editor tab; no redundant Map sidebar section.
  const register = (name: string, handler: (action?: AtlasAction) => Promise<unknown>) => context.subscriptions.push(vscode.commands.registerCommand(`codebaseMentor.${name}`, async (raw?: AtlasAction | AtlasItem) => {
    try { const action = raw && 'action' in raw ? raw.action : raw as AtlasAction | undefined; await handler(action); }
    catch (error) { void vscode.window.showErrorMessage(`Codebase Mentor: ${error instanceof Error ? error.message : 'Map action failed.'}`); }
  }));
  register('showRelatedCode', async () => { diagram.show(); await atlas.showRelated(); });
  register('openMap', async () => { diagram.show(); if (!atlas.state.result) { const target = mentor.selectedContext(); if (target) await atlas.open(target); else await atlas.showRelated(); } });
  register('showMentorRelated', async () => { const target = mentor.selectedContext(); if (!target) throw new Error('Select a current Mentor answer first.'); diagram.show(); await atlas.open(target); });
  register('refreshMap', async () => { await atlas.refresh(); });
  register('mapBack', async () => { await atlas.back(); });
  register('mapBackToEditor', async () => { await atlas.backToEditor(); });
  register('exploreComponent', async action => { if (!action?.componentId) throw new Error('Choose a related component in Map.'); await atlas.explore(action.componentId, action.viewId); });
  register('openAtlasSource', async action => {
    if (!action?.referenceId) throw new Error('Choose source evidence in Map.');
    const result = atlas.current(action.viewId); const reference = result.neighborhood.references.find(r => r.id === action.referenceId);
    if (!reference) throw new Error('This reference is not in the current neighborhood.');
    await source.openWorkspaceSource(result.target, reference);
  });
  register('explainAtlasComponent', async action => {
    if (!action?.componentId) throw new Error('Choose a component in Map.');
    const target = atlas.targetFor(action.componentId, action.viewId); panel.show(); await mentor.explainComponent(target);
  });
  register('openRepositoryArchitecture', async () => {
    if (!openRepositoryGraph) throw new Error('Repository architecture viewer is unavailable. Reload the extension.');
    await openRepositoryGraph();
  });
  register('openFullAtlas', async () => {
    const root = vscode.workspace.getConfiguration('codebaseMentor').get<string>('webBaseUrl', 'http://127.0.0.1:5173');
    await vscode.env.openExternal(vscode.Uri.parse(fullAtlasUrl(root)));
    void vscode.window.showInformationMessage('Opened the web workspace. Select the repository there; this web route does not restore the Map component or snapshot.');
  });
}
