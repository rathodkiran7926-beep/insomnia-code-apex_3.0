import * as vscode from 'vscode';
import type { MentorController } from '../mentorController';
import type { MentorPanel } from '../views/mentorPanel';
import type { SourceNavigation } from '../vscode-adapters/sourceNavigation';
import type { EditorContext } from '../vscode-adapters/editorContext';

export function registerMentorCommands(context: vscode.ExtensionContext, mentor: MentorController, panel: MentorPanel, source: SourceNavigation, editor: () => EditorContext | undefined): void {
  const register = (id: string, handler: (...args: unknown[]) => Promise<void> | void) => {
    context.subscriptions.push(vscode.commands.registerCommand(id, async (...args: unknown[]) => {
      try { await handler(...args); }
      catch (error) { panel.show(); mentor.reportError(error instanceof Error ? error.message : 'Mentor action failed.'); }
    }));
  };
  register('codebaseMentor.explainSelection', async () => {
    const selection = editor(); panel.show(); await mentor.explain(selection);
  });
  register('codebaseMentor.openMentor', () => panel.show(false));
  register('codebaseMentor.cancelMentor', () => { mentor.cancel(); source.cancel(); });
  register('codebaseMentor.askFollowUp', async () => {
    const result = mentor.state.result;
    if (!result) { panel.show(); mentor.reportError('Explain a component before asking a follow-up.'); return; }
    const question = await vscode.window.showInputBox({ title: 'Codebase Mentor: Ask Follow-up', prompt: `New question scoped to ${result.component.name} in the indexed snapshot.`, ignoreFocusOut: true,
      validateInput: text => text.trim() && text.length <= 1500 ? undefined : 'Enter a question of 1–1500 characters.' });
    if (question !== undefined) { panel.show(); await mentor.ask(question, result.id); }
  });
  register('codebaseMentor.openCitation', async (answerId, referenceId) => {
    const result = typeof answerId === 'string' ? mentor.getResult(answerId) : mentor.state.result;
    if (!result) throw new Error('Explain a component before opening its source evidence.');
    const id = typeof referenceId === 'string' ? referenceId : (await vscode.window.showQuickPick(result.answer.citations.map(reference => ({ label: `${reference.file}:${reference.startLine}–${reference.endLine}`, description: `Indexed commit ${result.snapshot.indexedCommit.slice(0, 12)}`, id: reference.id })), { title: 'Codebase Mentor: Open Source Citation' }))?.id;
    if (id) await source.open(result, id);
  });
}
