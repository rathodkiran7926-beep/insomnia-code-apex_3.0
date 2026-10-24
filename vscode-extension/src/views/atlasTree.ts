import * as vscode from 'vscode';
import type { AtlasController } from '../atlasController';
import type { Relationship } from '../api-client/atlasContracts';
export interface AtlasAction { viewId: string; componentId?: string; referenceId?: string }
export class AtlasItem extends vscode.TreeItem { action?: AtlasAction }

export class AtlasTree implements vscode.TreeDataProvider<AtlasItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<AtlasItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly children = new WeakMap<AtlasItem, AtlasItem[]>();
  constructor(private readonly atlas: AtlasController, private readonly connected: () => boolean, private readonly localNotice?: () => string | undefined) {}
  refresh(): void { this.changed.fire(undefined); }
  getTreeItem(item: AtlasItem): AtlasItem { return item; }
  private row(label: string, icon = 'info', command?: string, action?: AtlasAction): AtlasItem {
    const item = new AtlasItem(label, vscode.TreeItemCollapsibleState.None); item.tooltip = label; item.iconPath = new vscode.ThemeIcon(icon);
    item.action = action;
    if (command) item.command = { command: `codebaseMentor.${command}`, title: label, arguments: action ? [action] : [] };
    return item;
  }
  private group(label: string, children: AtlasItem[], expanded = true): AtlasItem {
    const item = this.row(label, 'list-tree'); item.collapsibleState = expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    this.children.set(item, children); return item;
  }
  getChildren(parent?: AtlasItem): AtlasItem[] {
    if (parent) return this.children.get(parent) ?? [];
    const state = this.atlas.state; const result = state.result;
    const status = this.row(state.message, state.status === 'loading' ? 'sync~spin' : state.status === 'error' ? 'warning' : 'info');
    if (!result) return [status,
      this.row(this.connected() ? 'Select code and choose Show Related Code.' : 'Connect a repository snapshot to explore architecture.', 'repo'),
      this.row(this.connected() ? 'Show Related Code' : 'Connect Repository', 'plug', this.connected() ? 'showRelatedCode' : 'connectRepository'),
      ...(state.status === 'error' ? [this.row('Retry Map', 'refresh', 'refreshMap')] : [])];
    const { neighborhood: n } = result;
    const action = (componentId?: string, referenceId?: string): AtlasAction => ({ viewId: result.id, componentId, referenceId });
    const refRow = (id: string, label: string): AtlasItem => {
      const ref = n.references.find(r => r.id === id)!;
      const row = this.row(`${label}: ${ref.file}:${ref.startLine}–${ref.endLine}`, 'go-to-file', 'openAtlasSource', action(undefined, id));
      row.tooltip = `${label}\n${ref.file}:${ref.startLine}–${ref.endLine}\nIndexed commit ${n.indexedCommit}`; return row;
    };
    const selected = this.row(n.component.name, 'symbol-method', 'openAtlasSource', action(n.component.id, n.component.referenceId));
    selected.description = `${n.component.role}${n.component.inferred ? ' · inferred role' : ''}`; selected.contextValue = 'atlasComponent';
    const relationshipRow = (edge: Relationship, direction: 'incoming' | 'outgoing') => {
      const id = direction === 'incoming' ? edge.source : edge.target; const c = n.components.find(c => c.id === id)!;
      const item = this.group(c.name, [refRow(edge.referenceId, 'Relationship evidence'), refRow(c.referenceId, 'Component declaration')], false);
      item.action = action(c.id, c.referenceId); item.contextValue = 'atlasComponent';
      item.description = `${edge.type} · ${edge.certainty ?? 'certainty unavailable'}${edge.inferred ? ' · inferred' : ''}`;
      item.tooltip = `${edge.source} → ${edge.target}\nType: ${edge.type}\nCertainty: ${edge.certainty ?? 'not stored'}${edge.mountPath ? `\nMount: ${edge.mountPath}` : ''}${edge.evidence?.length ? `\n${edge.evidence.join('\n')}` : ''}\nExplore ${c.name}; expand for call-site/relationship evidence.`;
      item.command = { command: 'codebaseMentor.exploreComponent', title: 'Explore Component', arguments: [item.action] }; return item;
    };
    const empty = () => this.row('No supported relationships found for this component.');
    const allEdges = [...new Map([...n.incoming, ...n.outgoing].map(e => [e.id, e])).values()];
    const details = [
      this.group('Selected Component', [selected, refRow(n.component.referenceId, 'Declaration'), this.row('Explain with Codebase Mentor', 'comment-discussion', 'explainAtlasComponent', action(n.component.id))], false),
      this.group(`Incoming Relationships (${n.incoming.length})`, n.incoming.length ? n.incoming.map(e => relationshipRow(e, 'incoming')) : [empty()], false),
      this.group(`Outgoing Relationships (${n.outgoing.length})`, n.outgoing.length ? n.outgoing.map(e => relationshipRow(e, 'outgoing')) : [empty()], false),
      this.group('Source Evidence', [refRow(n.component.referenceId, 'Component declaration'), ...allEdges.map(e => refRow(e.referenceId, `${e.type} evidence`))], false),
      this.group('Documentation', n.documentation.length ? n.documentation.flatMap(doc => {
        const row = this.row('Inferred AI documentation · review required', 'book'); row.tooltip = doc.explanation;
        const prose = this.row(doc.explanation, 'note');
        return [row, prose, ...doc.referenceIds.map(id => refRow(id, 'Documentation evidence'))];
      }) : [this.row('No component-specific documentation is available.')], false),
      ...(n.truncated ? [this.row(`Showing at most ${n.limit} relationships; more are available in the full Atlas.`, 'warning')] : []),
      this.group('Analysis limitations', n.limitations.map(text => this.row(text, 'warning')), false),
      this.row('Back to Editor Selection', 'code', 'mapBackToEditor'),
      this.row('Refresh Map', 'refresh', 'refreshMap'),
      this.row('Open Full Architecture Atlas', 'link-external', 'openFullAtlas'),
    ];
    const summary = this.row(n.component.name, 'symbol-method', 'openMap');
    summary.description = `${n.incoming.length} in · ${n.outgoing.length} out`;
    summary.tooltip = `Selected indexed component: ${n.component.name}\n${n.repositoryIdentity} @ ${n.indexedCommit}`;
    return [
      this.row('Open Architecture Diagram', 'type-hierarchy', 'openMap'),
      summary,
      ...(result.target?.scopeNotice ? [this.row('Selection scope (see diagram)', 'info', 'openMap')] : []),
      ...(this.localNotice?.() ? [this.row('Revision notice (see diagram)', 'warning', 'openMap')] : []),
      ...(state.canBack ? [this.row('Back to Previous Component', 'arrow-left', 'mapBack')] : []),
      this.group('Detailed Map Tree', details, false),
    ];
  }
  dispose(): void { this.changed.dispose(); }
}
