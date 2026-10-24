import * as vscode from 'vscode';
import type { Connection } from '../connection';

export function registerCommands(context: vscode.ExtensionContext, connection: Connection, check = () => connection.check()): void {
  const register = (id: string, handler: () => Promise<unknown>) => {
    context.subscriptions.push(vscode.commands.registerCommand(id, async () => {
      try { await handler(); }
      catch (error) {
        const detail = error instanceof Error ? error.message : 'Unexpected command failure.';
        void vscode.window.showErrorMessage(`Codebase Mentor: ${detail}`);
      }
    }));
  };
  register('codebaseMentor.openWorkspace', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.codebaseMentor');
    await vscode.commands.executeCommand('codebaseMentor.focus.focus');
  });
  register('codebaseMentor.checkConnection', check);
  register('codebaseMentor.openSettings', async () => {
    await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:codebase-mentor-local.codebase-mentor');
  });
}
