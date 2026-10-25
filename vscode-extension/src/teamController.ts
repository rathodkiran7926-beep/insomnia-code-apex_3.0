import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { TeamClient, teamId, type TeamHandoff } from './teamClient';
import type { MentorApi } from './api-client/client';
import type { MentorController } from './mentorController';
import type { RepositoryBinding } from './repository';
import type { EditorContext } from './vscode-adapters/editorContext';
import type { HandoffSeed } from './commands/handoffCommands';
import type { LocalCheckpointContext } from './api-client/checkpointContracts';
import { repositoryArchitectureUrl } from './commands/atlasCommands';

export interface TeamView {
  signedIn: boolean; name?: string; workspace?: string; message: string;
  items: { id: string; title: string; status: string; createdAt: string }[];
  more: boolean; previous: boolean;
}
type Detail = { session: TeamHandoff; snapshot: { file_path: string; commit_sha: string; source_code: string; start_line: number; end_line: number }; comments: { author_name: string; content: string; created_at: string }[]; resolutions: { summary?: string; explanation?: string }[] };

export class TeamController implements vscode.Disposable {
  private listeners = new Set<() => void>();
  private rows: TeamHandoff[] = [];
  private workspaceId?: string;
  private offset = 0;
  private total = 0;
  private serial = 0;
  private disposed = false;
  private connecting?: Promise<void>;
  private message = 'Connecting to local handoffs...';
  constructor(readonly client: TeamClient, private readonly api: MentorApi, private readonly mentor: MentorController,
    private readonly binding: () => RepositoryBinding | undefined, private readonly editor: () => EditorContext | undefined,
    private readonly resetTasks: () => void, private readonly local: () => LocalCheckpointContext = () => ({ gitStatus: 'unknown' })) {}
  onChange(listener: () => void) { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; }
  private emit() { for (const listener of this.listeners) listener(); }
  private anchor() { const b = this.binding(); return JSON.stringify([this.disposed, this.api.backendIdentity, this.client.account?.user.id, b?.snapshotId, b?.connectedAt]); }
  private assert(anchor: string) { if (anchor !== this.anchor()) throw new Error('Account or repository changed. Review the current selection again.'); }
  get view(): TeamView {
    const account = this.client.account;
    return { signedIn: !!account, name: account?.user.name, workspace: account?.workspaces.find(w => w.id === this.workspaceId)?.name,
      message: this.message, items: account ? this.rows.slice(0, 6).map(r => ({ id: r.id, title: r.title, status: r.status, createdAt: r.updated_at })) : [],
      more: this.offset + 30 < this.total, previous: this.offset > 0 };
  }
  async initialize() {
    try { await this.client.restore(); await this.connect(); await this.refresh(); }
    catch (error) { this.message = error instanceof Error ? error.message : 'Could not connect to local handoffs.'; this.emit(); }
  }
  private async connect() {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before using handoffs.');
    if (this.client.account) return;
    if (!this.connecting) this.connecting = this.client.connect().then(() => {
      this.workspaceId = this.client.account?.workspaces[0]?.id;
      this.resetTasks();
    }).finally(() => { this.connecting = undefined; });
    await this.connecting;
  }
  async workspace() {
    await this.connect();
    const account = this.client.account!;
    const choice = await vscode.window.showQuickPick(account.workspaces.map(w => ({ label: w.name, description: w.role, id: w.id })), { title: 'Handoff workspace' });
    if (!choice) return;
    this.workspaceId = choice.id; this.rows = []; await this.refresh();
  }
  async refresh(offset = 0) {
    try { await this.connect(); } catch (error) { this.rows = []; this.message = error instanceof Error ? error.message : 'Could not connect to local handoffs.'; this.emit(); return; }
    const account = this.client.account, binding = this.binding();
    const serial = ++this.serial, anchor = account && binding ? this.anchor() : '';
    this.rows = []; this.offset = offset; this.total = 0;
    if (!account || !binding) { this.message = account ? 'Connect a repository to see your team handoffs.' : 'Connect your local backend to share context.'; this.emit(); return; }
    this.workspaceId = account.workspaces.find(w => w.id === this.workspaceId)?.id || account.workspaces[0]?.id;
    if (!this.workspaceId) { this.message = 'Join a team workspace to share context.'; this.emit(); return; }
    this.message = 'Loading your authored and assigned handoffs…'; this.emit();
    try {
      const base = new URLSearchParams({ workspaceId: this.workspaceId, repository: binding.repositoryIdentity, offset: String(offset) });
      const pages = await Promise.all(['mine', 'assigned'].map(filter => this.client.request<{ sessions: TeamHandoff[]; total: number }>(`/api/handoffs?${base}&filter=${filter}`)));
      this.assert(anchor); if (serial !== this.serial) return;
      this.rows = [...new Map(pages.flatMap(p => p.sessions).map(r => [teamId(r.id), r])).values()].sort((a,b) => b.updated_at.localeCompare(a.updated_at));
      this.total = Math.max(...pages.map(p => p.total));
      this.message = this.rows.length ? 'Local team handoffs. Refresh to retrieve senior feedback.' : 'No authored or assigned handoffs for this repository yet.';
    } catch (error) { if (serial !== this.serial) return; if (!this.client.account) this.resetTasks(); this.message = error instanceof Error ? error.message : 'Could not load team handoffs.'; }
    this.emit();
  }
  async browse() {
    const choice = await vscode.window.showQuickPick(this.rows.map(r => ({ label: r.title, description: r.status, id: r.id })), { title: 'Your authored and assigned handoffs' });
    if (choice) await this.open(choice.id);
  }
  private known(id: string) { teamId(id); if (!this.rows.some(r => r.id === id)) throw new Error('Choose a handoff from the current saved list.'); }
  private async url(id: string) {
    teamId(id); const result = await this.client.request<{ path: string }>(`/api/handoffs/${id}/share`, {}, 'POST');
    if (result.path !== `/#/handoffs/${id}`) throw new Error('Invalid handoff link.');
    const root = vscode.workspace.getConfiguration('codebaseMentor').get<string>('webBaseUrl', 'http://127.0.0.1:5173');
    const url = new URL(repositoryArchitectureUrl(root)); url.hash = `/handoffs/${id}`;
    return url;
  }
  async copy(id: string) { this.known(id); const anchor = this.anchor(), url = await this.url(id); this.assert(anchor); await vscode.env.clipboard.writeText(url.href); void vscode.window.showInformationMessage('Handoff link copied. Workspace sign-in and authorization are required.'); }
  async browser(id: string) { this.known(id); const anchor = this.anchor(), url = await this.url(id); this.assert(anchor); await vscode.env.openExternal(vscode.Uri.parse(url.href)); }
  async open(id: string) {
    this.known(id); const anchor = this.anchor();
    const result = await this.client.request<Detail>(`/api/handoffs/${teamId(id)}`); this.assert(anchor);
    const text = [result.session.title, `Status: ${result.session.status}`, `Repository: ${result.session.repository_id}`, `Commit: ${result.snapshot.commit_sha}`,
      `Source: ${result.snapshot.file_path}:${result.snapshot.start_line}-${result.snapshot.end_line}`, '', 'DEVELOPER QUESTION', result.session.question,
      '', 'SAVED PROGRESS', result.session.actual_behavior || 'No completed work was supplied.', '', 'NEXT ACTION', result.session.expected_behavior || 'No next action was supplied.', '', 'PINNED SOURCE', result.snapshot.source_code,
      '', 'SENIOR FEEDBACK', ...result.comments.flatMap(c => [`${c.author_name} (${c.created_at})`, c.content, '']), !result.comments.length ? 'No feedback yet. Refresh after the senior replies.' : '',
      '', 'RESOLUTION PROPOSALS', ...result.resolutions.map(r => r.summary || r.explanation || 'Open the web handoff to review the proposal.')].join('\n');
    const doc = await vscode.workspace.openTextDocument({ language: 'plaintext', content: text }); await vscode.window.showTextDocument(doc, { preview: true });
    const action = await vscode.window.showInformationMessage(`Handoff: ${result.session.status}`, 'Copy Link', 'Open in Browser');
    if (action === 'Copy Link') await this.copy(id); if (action === 'Open in Browser') await this.browser(id);
  }
  async share(seed?: HandoffSeed) {
    await this.connect();
    if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before sharing context.');
    const binding = seed?.binding || this.binding(); if (!binding) throw new Error('Connect the intended repository first.');
    if (binding.backendUrl !== this.api.backendIdentity) throw new Error('The source selection belongs to another backend. Reconnect it first.');
    const anchor = this.anchor(), account = this.client.account!;
    let referenceId = seed?.sourceReferenceIds[0];
    if (!referenceId) {
      const editor = this.editor();
      if (!editor) throw new Error('Select a source component in an editor first.');
      const resolved = await this.mentor.resolveContext(editor, new AbortController().signal); this.assert(anchor);
      if (!resolved?.reference || resolved.binding.snapshotId !== binding.snapshotId) throw new Error('Select a component from the connected snapshot.');
      referenceId = resolved.reference.id;
    }
    const evidence = await this.api.evidence(binding.snapshotId); this.assert(anchor);
    const ref = evidence.references.find(r => r.id === referenceId); if (!ref) throw new Error('Source reference is unavailable.');
    const checkpointId = seed?.origin.type === 'checkpoint' ? seed.origin.checkpointId : undefined;
    const saved = checkpointId ? await this.api.checkpoint(binding, checkpointId) : undefined;
    this.assert(anchor);
    if (!this.workspaceId) this.workspaceId = account.workspaces[0]?.id;
    if (!this.workspaceId) throw new Error('Join a handoff workspace first.');
    const workspaceId = this.workspaceId;
    const members = await this.client.request<{ members: { id: string; name: string; role: string }[] }>(`/api/collaboration/workspaces/${teamId(workspaceId)}/members`);
    const reviewer = await vscode.window.showQuickPick(members.members.filter(m => m.id !== account.user.id && ['reviewer','maintainer'].includes(m.role)).map(m => ({ label: m.name, id: m.id })), { title: 'Share context: choose a senior reviewer' });
    if (!reviewer) return;
    const title = await vscode.window.showInputBox({ title: 'Share Context: task title', value: saved?.checkpoint.taskTitle, validateInput: v => v.trim() && v.length <= 160 ? undefined : 'Enter a title up to 160 characters.' }); if (!title) return;
    const question = await vscode.window.showInputBox({ title: 'Question or blocker for your senior', value: saved?.checkpoint.notes.unresolved, validateInput: v => v.trim() && v.length <= 2200 ? undefined : 'Enter a question up to 2200 characters.' }); if (!question) return;
    const completed = await vscode.window.showInputBox({ title: 'Work completed', value: saved?.checkpoint.notes.discovery.slice(0, 1800) || '', validateInput: v => v.length <= 1800 ? undefined : 'Use at most 1800 characters.' }); if (completed === undefined) return;
    const next = await vscode.window.showInputBox({ title: 'Next planned action', value: saved?.checkpoint.notes.nextStep || '', validateInput: v => v.length <= 2000 ? undefined : 'Use at most 2000 characters.' }); if (next === undefined) return;
    this.assert(anchor);
    const endLine = Math.min(ref.endLine, ref.startLine + 299);
    const local = saved?.checkpoint.localContext || this.local();
    const progress = `${completed}\n\nIDE context: branch ${local.branch || 'unknown'}; local HEAD ${local.headCommit || 'unknown'}; local changes ${local.gitStatus}.`;
    const workspace = account.workspaces.find(w => w.id === workspaceId)?.name || workspaceId;
    const approved = await vscode.window.showWarningMessage('Review context before sharing', { modal: true, detail: [
      `Author: ${account.user.name}\nTeam: ${workspace}\nReviewer: ${reviewer.label}`, `Task: ${title}`, `Repository: ${binding.repositoryIdentity}\nPinned commit: ${binding.indexedCommit}\nSource: ${ref.file}:${ref.startLine}-${endLine}`, saved ? `Checkpoint: ${checkpointId}\nSaved branch: ${saved.checkpoint.localContext.branch || 'unknown'}` : '',
      `Question: ${question}`, `Work completed: ${progress}`, `Next action: ${next || '(none supplied)'}`,
      'Includes the existing saved repository snapshot and the selected source range. Unsaved buffers and uncommitted code are not uploaded. Authorized workspace members can access the handoff; the URL alone grants no access.',
    ].filter(Boolean).join('\n\n') }, 'Generate Handoff Link');
    if (approved !== 'Generate Handoff Link') return; this.assert(anchor);
    const requestId = randomUUID();
    let result: Detail;
    try {
      result = await this.client.request<Detail>('/api/handoffs', { workspaceId, snapshotId: binding.snapshotId, referenceId: ref.id, startLine: ref.startLine, endLine, title, question: question + (checkpointId ? `\n\nSaved session: ${checkpointId}` : ''), actualBehavior: progress, expectedBehavior: next, attemptedSolutions: '', assignedTo: teamId(reviewer.id), requestId }, 'POST');
    } catch {
      // The server persists before generating its optional briefing. Recover a
      // completed write after a timeout instead of creating a duplicate session.
      try { result = await this.client.request<Detail>(`/api/handoffs/${requestId}`); }
      catch { throw new Error('Handoff creation was not confirmed. Refresh Saved Handoffs before retrying.'); }
    }
    this.assert(anchor); teamId(result.session.id);
    await this.refresh();
    const link = await this.url(result.session.id); this.assert(anchor);
    const action = await vscode.window.showInformationMessage(`Handoff created: ${link.href}`, 'Copy Link', 'Open in Browser');
    if (action === 'Copy Link') await vscode.env.clipboard.writeText(link.href);
    if (action === 'Open in Browser') await vscode.env.openExternal(vscode.Uri.parse(link.href));
  }
  register(context: vscode.ExtensionContext) {
    for (const [name, action] of Object.entries({ openSharedHandoff: (id: string) => this.open(id), copySharedHandoffLink: (id: string) => this.copy(id), openSharedHandoffBrowser: (id: string) => this.browser(id) })) {
      context.subscriptions.push(vscode.commands.registerCommand(`codebaseMentor.${name}`, async (id?: string) => {
        try { if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace first.'); if (!id) await this.browse(); else await action(id); }
        catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Handoff action failed.'); }
      }));
    }
    const commands: Record<string, () => Promise<unknown>> = {
      selectTeamWorkspace: () => this.workspace(), shareContext: () => this.share(),
      refreshSharedHandoffs: () => this.refresh(), browseSharedHandoffs: () => this.browse(), nextSharedHandoffs: () => this.refresh(this.offset + 30), previousSharedHandoffs: () => this.refresh(Math.max(0,this.offset - 30)),
    };
    for (const [name, action] of Object.entries(commands)) context.subscriptions.push(vscode.commands.registerCommand(`codebaseMentor.${name}`, async () => { try { await action(); } catch (error) { this.message = error instanceof Error ? error.message : 'Team action failed.'; this.emit(); void vscode.window.showErrorMessage(this.message); } }));
  }
  dispose() { this.disposed = true; this.serial++; this.listeners.clear(); }
}
