import * as vscode from 'vscode';
import { normalizeGithubRemote, validCommit, type LocalGitContext } from '../repository';
import { relativeRepositoryPath, sameRepositoryUri, supportedUri } from './workspaceContext';

// Read-only structural subset of microsoft/vscode extensions/git/src/api/git.d.ts,
// API v1, verified against 1.100 and current. No mutating Git methods exposed.
interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD?: { name?: string; commit?: string; upstream?: { remote: string } };
    remotes: readonly { name: string; fetchUrl?: string; pushUrl?: string }[];
    indexChanges: readonly unknown[];
    workingTreeChanges: readonly unknown[];
    mergeChanges: readonly unknown[];
    untrackedChanges?: readonly unknown[];
    onDidChange: vscode.Event<void>;
  };
}
interface GitApi {
  repositories: readonly GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}
interface GitExports {
  enabled: boolean;
  onDidChangeEnablement: vscode.Event<boolean>;
  getAPI(version: 1): GitApi;
}

export class GitContext implements vscode.Disposable {
  private api?: GitApi;
  private disposed = false;
  private loading?: Promise<void>;
  private loaded = false;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly apiDisposables: vscode.Disposable[] = [];
  private readonly repositories = new Map<GitRepository, vscode.Disposable>();

  initialize(): Promise<void> {
    if (this.disposed || this.loaded || !vscode.workspace.isTrusted) return Promise.resolve();
    return this.loading ??= this.load().finally(() => { this.loading = undefined; });
  }

  private async load(): Promise<void> {
    const extension = vscode.extensions.getExtension<GitExports>('vscode.git');
    if (!extension) return;
    try {
      const exports = await extension.activate();
      if (this.disposed) return;
      this.loaded = true;
      const update = () => {
        this.clearApi();
        if (exports.enabled && vscode.workspace.isTrusted) {
          try {
            this.api = exports.getAPI(1);
            this.apiDisposables.push(this.api.onDidOpenRepository(() => this.sync()), this.api.onDidCloseRepository(() => this.sync()));
            this.sync();
          } catch { this.clearApi(); }
        }
        this.changed.fire();
      };
      this.disposables.push(exports.onDidChangeEnablement(update));
      update();
    } catch {
      // Missing/disabled/unavailable Git is an explicit unknown context, not a verified match.
      this.clearApi(); this.changed.fire();
    }
  }

  private sync(): void {
    const active = new Set(this.api?.repositories ?? []);
    for (const [repo, disposable] of this.repositories) if (!active.has(repo)) { disposable.dispose(); this.repositories.delete(repo); }
    for (const repo of active) if (!this.repositories.has(repo)) this.repositories.set(repo, repo.state.onDidChange(() => this.changed.fire()));
    this.changed.fire();
  }

  read(uri: vscode.Uri): LocalGitContext {
    if (!vscode.workspace.isTrusted || !supportedUri(uri)) return {};
    const repo = this.api?.repositories.filter(candidate => sameRepositoryUri(candidate.rootUri, uri) || relativeRepositoryPath(candidate.rootUri, uri) !== undefined)
      .sort((a, b) => b.rootUri.path.length - a.rootUri.path.length)[0];
    if (!repo) return {};
    const { state } = repo;
    // Prefer the checkout's upstream, then origin; ambiguous remaining remotes
    // never establish a match simply because one happens to match the snapshot.
    const primary = state.remotes.find(remote => remote.name === state.HEAD?.upstream?.remote)
      ?? state.remotes.find(remote => remote.name === 'origin');
    const identity = primary ? normalizeGithubRemote(primary.fetchUrl ?? primary.pushUrl ?? '')
      : state.remotes.length === 1 ? normalizeGithubRemote(state.remotes[0]?.fetchUrl ?? state.remotes[0]?.pushUrl ?? '') : undefined;
    return {
      rootUri: repo.rootUri.toString(), identity, branch: state.HEAD?.name,
      head: validCommit(state.HEAD?.commit) ? state.HEAD.commit.toLowerCase() : undefined,
      dirty: state.indexChanges.length > 0 || state.workingTreeChanges.length > 0 || state.mergeChanges.length > 0 || (state.untrackedChanges?.length ?? 0) > 0,
    };
  }

  fileModified(uri: vscode.Uri): boolean | undefined {
    if (!vscode.workspace.isTrusted) return;
    const repo = this.api?.repositories.filter(candidate => sameRepositoryUri(candidate.rootUri, uri) || relativeRepositoryPath(candidate.rootUri, uri) !== undefined).sort((a, b) => b.rootUri.path.length - a.rootUri.path.length)[0];
    if (!repo) return;
    const changes = [...repo.state.indexChanges, ...repo.state.workingTreeChanges, ...repo.state.mergeChanges, ...(repo.state.untrackedChanges ?? [])];
    return changes.some(value => {
      if (!value || typeof value !== 'object') return false;
      const change = value as { uri?: vscode.Uri; originalUri?: vscode.Uri; renameUri?: vscode.Uri };
      return [change.uri, change.originalUri, change.renameUri].some(candidate => candidate && sameRepositoryUri(candidate, uri));
    });
  }

  private clearApi(): void {
    for (const disposable of this.apiDisposables.splice(0)) disposable.dispose();
    for (const disposable of this.repositories.values()) disposable.dispose();
    this.repositories.clear(); this.api = undefined;
  }
  dispose(): void {
    this.disposed = true; this.clearApi();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    this.changed.dispose();
  }
}
