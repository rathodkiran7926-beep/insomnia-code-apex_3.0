import * as vscode from 'vscode';
import type { PrController } from '../prController';
import type { PrComponent, PrEdge, PrSetupChange, PullRequest } from '../api-client/prContracts';

export interface ChangesAction { viewId: string; side?: 'before' | 'after'; componentId?: string; referenceId?: string; fileIndex?: number; url?: string }
export class ChangesItem extends vscode.TreeItem { action?: ChangesAction }

/** Presentation of validated backend findings only. Expansion never performs I/O. */
export class ChangesTree implements vscode.TreeDataProvider<ChangesItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ChangesItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly children = new WeakMap<ChangesItem, () => ChangesItem[]>();
  constructor(private readonly pr: PrController, private readonly connected: () => boolean) {}
  refresh(): void { this.changed.fire(undefined); }
  getTreeItem(item: ChangesItem): ChangesItem { return item; }
  private row(label: string, icon = 'info', command?: string, action?: ChangesAction): ChangesItem {
    const item = new ChangesItem(label, vscode.TreeItemCollapsibleState.None);
    item.tooltip = label; item.iconPath = new vscode.ThemeIcon(icon); item.action = action;
    if (command) item.command = { command: `codebaseMentor.${command}`, title: label, arguments: action ? [action] : [] };
    return item;
  }
  private group(label: string, children: () => ChangesItem[]): ChangesItem {
    const item = this.row(label, 'list-tree'); item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    // Capture the selected view's validated data; existing item actions retain its stale-check token.
    this.children.set(item, children); return item;
  }
  private bounded<T>(items: T[], render: (item: T, index: number) => ChangesItem, empty: string, limit = 100): ChangesItem[] {
    if (!items.length) return [this.row(empty)];
    return [...items.slice(0, limit).map(render), ...(items.length > limit ? [this.row(`${items.length - limit} additional items omitted; showing ${limit} of ${items.length}.`, 'warning')] : [])];
  }
  getChildren(parent?: ChangesItem): ChangesItem[] {
    if (parent) return this.children.get(parent)?.() ?? [];
    const state = this.pr.state; const result = state.comparison;
    const action = (extra: Omit<ChangesAction, 'viewId'> = {}): ChangesAction => ({ viewId: state.viewId, ...extra });
    const rows = [this.row(state.message || `PR Changes: ${state.status}`, ['running', 'starting', 'listing'].includes(state.status) ? 'sync~spin' : state.status === 'error' ? 'warning' : 'info')];
    if (!this.connected()) return [...rows, this.row('Connect a repository snapshot to discover remote pull requests.', 'repo'), this.row('Connect Repository', 'plug', 'connectRepository')];
    if (state.selected) {
      const selected = state.selected;
      rows.push(this.row(`#${result?.pr.number ?? selected.number} ${result?.pr.title ?? selected.title}`, 'git-pull-request'));
      // Manual URLs have placeholder metadata until comparison retrieval.
      if (!state.manual || result) rows.push(this.row(`State: ${result?.pr.state ?? selected.state}${!state.manual && selected.draft ? ' · draft' : ''}${!state.manual && selected.merged ? ' · merged' : ''}`));
      rows.push(this.row('Selected remote PR · local branch association unverified.', 'info'));
      const base = result?.pr.baseBranch ?? selected.base; const head = result?.pr.headBranch ?? selected.head;
      if (base || head) rows.push(this.row(`Branches: ${base || 'base unavailable'} ← ${head || 'head unavailable'}`, 'git-branch'));
    }
    if (result) rows.push(this.group('Comparison Versions', () => [
      this.row(`Stored comparison: ${result.createdAt}. Reanalyze explicitly for new commits.`, 'history'),
      this.row(`Merge base (before): ${result.pr.baseCommit}`, 'git-commit'),
      this.row(`Target branch tip: ${result.pr.targetCommit}`, 'git-commit'),
      this.row(`Head (after): ${result.pr.headCommit}`, 'git-commit'),
    ]));
    const page = state.page;
    const prRow = (pr: PullRequest) => {
      const item = this.row(`#${pr.number} ${pr.title}`, 'git-pull-request', 'selectPr', action({ url: pr.url }));
      item.description = `${pr.state}${pr.draft ? ' · draft' : ''}${pr.merged ? ' · merged' : ''}${pr.base || pr.head ? ` · ${pr.base || '?'} ← ${pr.head || '?'}` : ''}`; return item;
    };
    rows.push(this.group(`Pull Requests${page ? ` · ${page.state} · page ${page.page}` : ''}`, () => [
      ...(page ? this.bounded(page.pullRequests, prRow, 'No pull requests found for this filter. Enter a PR URL or change the filter.', 30) : [this.row('Refresh the list to discover remote pull requests.')]),
      this.row('Refresh PR List', 'refresh', 'refreshPrList', action()),
      ...(page?.hasMore ? [this.row('Next Page', 'arrow-right', 'prNextPage', action())] : []),
      ...(page && page.page > 1 ? [this.row('Previous Page', 'arrow-left', 'prPreviousPage', action())] : []),
      this.row('Filter PR List', 'filter', 'prFilterList', action()), this.row('Enter PR URL', 'link', 'prEnterUrl', action()),
    ]));
    if (state.job) rows.push(this.row(`Job ${state.job.id}: ${state.job.progress}% · ${state.job.status} · ${state.job.message}`, 'info'), this.row('Resume Existing Job', 'play', 'resumePrJob', action()));
    if (state.status === 'running' || state.status === 'starting' || state.status === 'listing') rows.push(this.row('Stop Local Waiting', 'debug-stop', 'cancelPrWaiting', action()));
    if (state.selected && !result && !['running', 'starting', 'listing'].includes(state.status)) rows.push(this.row('Start Analysis', 'play', 'startPrAnalysis', action()));
    if (result || state.job) rows.push(this.row('Refresh Stored Comparison', 'refresh', 'refreshPrComparison', action()));
    if (!result) return rows;
    rows.push(this.row('Reanalyze Selected PR (New Job)', 'debug-restart', 'reanalyzePr', action()));

    const source = (component: PrComponent, side: 'before' | 'after', label: string): ChangesItem => {
      const item = this.row(`${label}: ${component.name}`, 'symbol-method', 'openPrSource', action({ side, componentId: component.id, referenceId: component.reference.id }));
      item.description = `${component.role} · ${component.reference.file}:${component.reference.startLine}–${component.reference.endLine}`;
      item.contextValue = 'prComponent'; return item;
    };
    const edge = (entry: PrEdge, side: 'before' | 'after') => {
      const item = this.row(`${side === 'after' ? 'added' : 'removed'}: ${entry.source} → ${entry.target} · ${entry.type}`, 'references', 'openPrSource', action({ side, referenceId: entry.reference.id }));
      item.description = `${entry.certainty ?? 'certainty unavailable'} · ${entry.reference.file}:${entry.reference.startLine}–${entry.reference.endLine}`; return item;
    };
    const setup = (entry: PrSetupChange) => {
      const item = this.row(`${entry.name}${entry.section ? ` · ${entry.section}` : ''} · ${entry.path}`);
      // Values are deliberately never interpolated, including unexpected values and empty strings.
      item.description = `${entry.before === null ? 'absent' : 'present'} → ${entry.after === null ? 'absent' : 'present'}`; return item;
    };
    rows.push(
      this.group(`Changed Files (${result.pr.files.length}${result.pr.limited ? ' · backend limited' : ''})`, () => this.bounded(result.pr.files, (file, index) => {
        const item = this.row(file.path, 'diff', 'openPrDiff', action({ fileIndex: index }));
        item.description = `${file.status} · +${file.additions} −${file.deletions}${file.previousPath ? ` · from ${file.previousPath}` : ''}${file.hidden ? ' · content withheld' : ''}${file.patchLimited ? ' · patch limited' : ''}`; return item;
      }, 'No changed-file metadata is available.')),
      this.group(`Architecture Components (${result.components.length})`, () => this.bounded(result.components, change => this.group(`${change.status}: ${change.after?.name ?? change.before?.name ?? 'component'}${change.ambiguous ? ' · ambiguous match' : ''}`, () => [
        ...(change.before ? [source(change.before, 'before', 'Before declaration')] : []), ...(change.after ? [source(change.after, 'after', 'After declaration')] : []),
      ]), 'No architecture component changes were reported.')),
      this.group('Relationship Changes', () => [
        this.group(`Added (${result.edges.added.length})`, () => this.bounded(result.edges.added, entry => edge(entry, 'after'), 'No added relationships were reported.')),
        this.group(`Removed (${result.edges.removed.length})`, () => this.bounded(result.edges.removed, entry => edge(entry, 'before'), 'No removed relationships were reported.')),
      ]),
      this.group('Potential Impact — Static Analysis', () => (['before', 'after'] as const).map(side => this.group(`${side === 'before' ? 'Before' : 'After'} (${result.impact[side].length})`, () => this.bounded(result.impact[side], entry => {
        const item = source(entry, side, 'Potentially affected'); item.description = `${item.description} · depth ${entry.depth} · via ${entry.via}`; return item;
      }, 'No potential impact was reported for this side.')))),
      this.group('Setup Changes — Static Findings', () => [
        this.row('Setup has not been executed. Environment requiredness is unknown.'),
        this.group(`Environment Names (${result.setup.environment.length})`, () => this.bounded(result.setup.environment, entry => this.row(`${entry.name} · ${entry.change} · ${entry.path} · requiredness unknown`), 'No environment-name changes were reported.')),
        this.group(`Dependencies (${result.setup.dependencies.length})`, () => this.bounded(result.setup.dependencies, setup, 'No dependency changes were reported.')),
        this.group(`Scripts (${result.setup.scripts.length})`, () => this.bounded(result.setup.scripts, setup, 'No script changes were reported.')),
        this.group(`Migrations (${result.setup.migrations.length})`, () => this.bounded(result.setup.migrations, entry => this.row(`${entry.status}: ${entry.path}`), 'No migration-file changes were reported.')),
        this.group('Setup Guide Presence', () => (['before', 'after'] as const).map(side => this.group(`${side === 'before' ? 'Before' : 'After'} (${result.setup.guides[side].length})`, () => this.bounded(result.setup.guides[side], guide => {
          const item = this.row(guide.path); item.description = `package manager ${guide.packageManager ? 'present' : 'absent'} · engines ${guide.engines ? 'present' : 'absent'} · scripts ${guide.scripts ? 'present' : 'absent'}`; return item;
        }, 'No setup guide metadata is available for this side.')))),
      ]),
      this.group(`Warnings (${result.warnings.length})`, () => [
        ...result.warnings.slice(0, 200).map(warning => this.row(warning, 'warning')),
        // Validator keeps 200 messages plus its omission notice; retain that final notice.
        ...(result.warnings.length > 200 ? [this.row(result.warnings[result.warnings.length - 1]!, 'warning')] : []),
        ...(!result.warnings.length ? [this.row('No comparison warnings were reported.')] : []),
      ]),
    );
    return rows;
  }
  dispose(): void { this.changed.dispose(); }
}
