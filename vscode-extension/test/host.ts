import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { MentorApi } from '../src/api-client/client';
import { MentorTree } from '../src/views/mentorTree';
import type { ConnectionState } from '../src/connection';
import type { activate } from '../src/extension';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

export async function run(): Promise<void> {
  const config = vscode.workspace.getConfiguration('codebaseMentor');
  await config.update('apiBaseUrl', process.env.MENTOR_TEST_BACKEND, vscode.ConfigurationTarget.Global);
  const extension = vscode.extensions.getExtension('codebase-mentor-local.codebase-mentor');
  assert.ok(extension, 'Development extension must be installed in the test host');
  const mentor = await extension.activate() as ReturnType<typeof activate>;
  assert.ok(extension.isActive);
  const commands = await vscode.commands.getCommands(true);
  for (const contribution of extension.packageJSON.contributes.commands) {
    assert.ok(commands.includes(contribution.command), `Missing handler: ${contribution.command}`);
  }
  await vscode.commands.executeCommand('codebaseMentor.openWorkspace');
  for (const view of ['focus', 'map', 'changes']) {
    await vscode.commands.executeCommand(`codebaseMentor.${view}.focus`);
  }
  await vscode.commands.executeCommand('codebaseMentor.checkConnection');
  const api = new MentorApi(() => vscode.workspace.getConfiguration('codebaseMentor').get<string>('apiBaseUrl', ''));
  assert.deepEqual(await api.health(), { ok: true }, 'Real backend contract');
  await vscode.commands.executeCommand('codebaseMentor.openSettings');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');

  const state: ConnectionState = { status: 'disconnected', message: 'Backend unavailable' };
  const focus = new MentorTree('focus', () => state);
  try {
    const rows = focus.getChildren();
    assert.ok(rows.some(item => item.label === 'Disconnected'));
    assert.ok(rows.some(item => typeof item.label === 'string' && item.label.startsWith(vscode.workspace.workspaceFolders ? 'Workspace:' : 'No workspace open')));
    assert.ok(rows.some(item => item.command?.command === 'codebaseMentor.checkConnection'));
    for (const status of ['connecting', 'connected', 'server-error', 'invalid-configuration'] as const) {
      state.status = status;
      assert.ok(focus.getChildren().length > 0);
    }
  } finally { focus.dispose(); }
  for (const surface of ['map', 'changes'] as const) {
    const provider = new MentorTree(surface, () => state);
    try { assert.equal(provider.getChildren().length, 2); }
    finally { provider.dispose(); }
  }

  await config.update('apiBaseUrl', 'invalid', vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('codebaseMentor.checkConnection');
  await assert.rejects(api.health(), error => error instanceof Error && error.message.includes('valid backend URL'));
  await config.update('apiBaseUrl', process.env.MENTOR_TEST_BACKEND, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('codebaseMentor.checkConnection');
  assert.deepEqual(await api.health(), { ok: true });
  const scenario = process.env.MENTOR_TEST_SCENARIO;
  const snapshots = JSON.parse(process.env.MENTOR_TEST_SNAPSHOTS ?? '[]') as { snapshotId: string; commit: string }[];
  const folders = vscode.workspace.workspaceFolders ?? [];
  const waitFor = async (condition: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 150; i++) {
      if (await condition()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Host test timed out waiting for repository state.');
  };
  const step = async (value: object) => { await writeFile(process.env.MENTOR_UI_STEP!, JSON.stringify(value)); };
  const stepDone = async (name: string) => waitFor(async () => { try { await readFile(`${process.env.MENTOR_UI_STEP}.${name}.complete`); return true; } catch { return false; } });
  if (scenario !== 'empty') {
    await waitFor(() => Boolean(mentor.getRepositoryContext(folders[0]!.uri.toString())?.local.head));
    assert.equal((await api.snapshot(snapshots[0]!.snapshotId)).indexedCommit, snapshots[0]!.commit);
    if (scenario === 'restart') {
      const restored = mentor.getRepositoryContext(folders[0]!.uri.toString());
      assert.equal(restored?.binding?.snapshotId, snapshots[1]!.snapshotId);
      assert.equal(restored?.comparison?.revision, 'different');
      await vscode.commands.executeCommand('codebaseMentor.refreshRepository', folders[0]!.uri.toString());
      await vscode.commands.executeCommand('codebaseMentor.disconnectRepository', folders[0]!.uri.toString());
      assert.equal(mentor.getRepositoryContext(folders[0]!.uri.toString())?.binding, undefined);
    } else {
      const count = scenario === 'multi' ? 2 : 1;
      for (let index = 0; index < count; index++) {
        const snapshotIndex = index === 0 ? 0 : 2;
        await step({ step: `${scenario}-connect-${index}`, snapshotIndex, confirm: 'Connect repository', folderName: scenario === 'multi' ? folders[index]!.name : undefined });
        await vscode.commands.executeCommand('codebaseMentor.connectRepository');
        const actual = mentor.getRepositoryContext(folders[index]!.uri.toString());
        assert.equal(actual?.status, 'ready', JSON.stringify(actual));
        assert.equal(actual?.binding?.snapshotId, snapshots[snapshotIndex]!.snapshotId);
        assert.equal(actual?.comparison?.identity, 'matched'); assert.equal(actual?.comparison?.revision, 'matched');
      }
      let document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folders[0]!.uri, 'src/index.ts'));
      let active = await vscode.window.showTextDocument(document);
      active.selection = new vscode.Selection(0, 0, 0, 5);
      assert.equal(mentor.getEditorContext()?.file, 'src/index.ts');
      assert.equal(mentor.getEditorContext()?.binding?.snapshotId, snapshots[0]!.snapshotId);
      if (scenario === 'single') {
        await vscode.commands.executeCommand('codebaseMentor.explainSelection');
        const first = mentor.getMentorState().result;
        assert.equal(mentor.getMentorState().status, 'ready', JSON.stringify(mentor.getMentorState()));
        assert.ok(first); assert.equal(first.component.name, 'greet'); assert.equal(first.answer.mode, 'facts'); assert.equal(first.indexedOnly, false);
        const citation = first.answer.citations[0]!;
        await step({ step: 'mentor-local-citation', type: 'mentor', action: 'citation', referenceId: citation.id, expectedAnswer: first.id });
        await stepDone('mentor-local-citation');
        await waitFor(() => vscode.window.activeTextEditor?.document.uri.toString() === document.uri.toString() && vscode.window.activeTextEditor.selection.end.line === citation.endLine - 1);
        assert.equal(vscode.window.activeTextEditor!.selection.start.line, citation.startLine - 1);
        const question = 'Why is this validation necessary?';
        await step({ step: 'mentor-followup', type: 'mentor', action: 'followup', question, expectedAnswer: first.id }); await stepDone('mentor-followup');
        await waitFor(() => mentor.getMentorState().status === 'ready' && mentor.getMentorState().result?.id !== first.id);
        const followup = mentor.getMentorState().result!;
        assert.equal(followup.component.id, first.component.id); assert.equal(followup.answer.snapshotId, first.answer.snapshotId); assert.equal(followup.question, question);
        await step({ step: 'mentor-previous', type: 'mentor', action: 'previous', expectedAnswer: followup.id }); await stepDone('mentor-previous');
        await waitFor(() => mentor.getMentorState().result?.id === first.id);
        await step({ step: 'mentor-latest', type: 'mentor', action: 'latest', expectedAnswer: first.id }); await stepDone('mentor-latest');
        await waitFor(() => mentor.getMentorState().result?.id === followup.id);
        const originalText = document.getText();
        const localEditor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
        await localEditor.edit(builder => builder.insert(new vscode.Position(document.lineCount - 1, 0), '// saved local test change\n'));
        await document.save();
        const builtIn = await vscode.extensions.getExtension<{ getAPI(version: 1): { getRepository(uri: vscode.Uri): { status(): Promise<void> } | null } }>('vscode.git')!.activate();
        await builtIn.getAPI(1).getRepository(folders[0]!.uri)!.status();
        await waitFor(() => mentor.getEditorContext()?.fileModified === true);
        localEditor.selection = new vscode.Selection(1, 0, 1, 5);
        await step({ step: 'mentor-modified-ack', type: 'indexed-ack' });
        await vscode.commands.executeCommand('codebaseMentor.explainSelection');
        assert.equal(mentor.getMentorState().status, 'ready', JSON.stringify(mentor.getMentorState()));
        assert.equal(mentor.getMentorState().result?.indexedOnly, true);
        await step({ step: 'mentor-indexed-citation', type: 'mentor', action: 'citation', referenceId: mentor.getMentorState().result!.answer.citations[0]!.id, expectedAnswer: mentor.getMentorState().result!.id });
        await stepDone('mentor-indexed-citation');
        await waitFor(() => vscode.window.activeTextEditor?.document.uri.scheme === 'codebase-mentor-source');
        assert.equal(vscode.window.activeTextEditor!.document.getText(), originalText);
        assert.equal(vscode.window.activeTextEditor!.document.isDirty, false);
        assert.equal(vscode.window.activeTextEditor!.selection.start.line, mentor.getMentorState().result!.answer.citations[0]!.startLine - 1);
        await step({ step: 'mentor-indexed-proof', type: 'mentor', action: 'inspect', expectedAnswer: mentor.getMentorState().result!.id }); await stepDone('mentor-indexed-proof');
        await vscode.workspace.fs.writeFile(document.uri, Buffer.from(originalText));
        document = await vscode.workspace.openTextDocument(document.uri);
        await waitFor(() => document.getText() === originalText);
        await builtIn.getAPI(1).getRepository(folders[0]!.uri)!.status();
        active = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
        console.log('MENTOR_PHASE3_HOST_PASS: real selection resolver, facts-only Mentor, rendered answer, follow-up/history, exact local citation and modified-file indexed document');
      }
      await active.edit(builder => builder.insert(new vscode.Position(0, 0), '// unsaved test edit\n'));
      assert.equal(mentor.getEditorContext()?.hasUnsavedChanges, true);
      await vscode.commands.executeCommand('undo');
      assert.equal(document.isDirty, false);
      await vscode.commands.executeCommand('codebaseMentor.refreshRepository', folders[0]!.uri.toString());
      if (scenario === 'single') {
        // Mutate only the generated test repository, with hooks disabled. The
        // production extension never shells out or changes Git branches.
        execFileSync('git', ['-c', `core.hooksPath=${process.env.MENTOR_TEST_HOOKS}`, '-C', folders[0]!.uri.fsPath, 'checkout', '-b', 'mentor-test'], { windowsHide: true });
        execFileSync('git', ['-c', `core.hooksPath=${process.env.MENTOR_TEST_HOOKS}`, '-c', 'user.name=Mentor Test', '-c', 'user.email=mentor-test@example.invalid', '-C', folders[0]!.uri.fsPath, 'commit', '--allow-empty', '-m', 'Context update'], { windowsHide: true });
        const builtIn = await vscode.extensions.getExtension<{ getAPI(version: 1): { getRepository(uri: vscode.Uri): { status(): Promise<void> } | null } }>('vscode.git')!.activate();
        await builtIn.getAPI(1).getRepository(folders[0]!.uri)!.status();
        await waitFor(() => mentor.getRepositoryContext(folders[0]!.uri.toString())?.local.branch === 'mentor-test');
        assert.equal(mentor.getRepositoryContext(folders[0]!.uri.toString())?.comparison?.revision, 'different');
        await step({ step: 'single-change', snapshotIndex: 1, confirm: 'Connect different revision' });
        await vscode.commands.executeCommand('codebaseMentor.changeSnapshot');
        assert.equal(mentor.getRepositoryContext(folders[0]!.uri.toString())?.comparison?.revision, 'different');
      } else {
        await vscode.commands.executeCommand('codebaseMentor.disconnectRepository', folders[0]!.uri.toString());
        assert.equal(mentor.getRepositoryContext(folders[0]!.uri.toString())?.binding, undefined);
        assert.equal(mentor.getRepositoryContext(folders[1]!.uri.toString())?.binding?.snapshotId, snapshots[2]!.snapshotId);
      }
      await vscode.commands.executeCommand('codebaseMentor.openWorkspace');
      await step({ step: 'done', expectedSnapshot: snapshots[scenario === 'single' ? 1 : 2]!.snapshotId, expectedText: scenario === 'single' ? 'Different revision' : 'No snapshot connected' });
      await waitFor(async () => { try { await readFile(`${process.env.MENTOR_UI_STEP}.complete`); return true; } catch { return false; } });
    }
  }
  console.log(`MENTOR_PHASE2_HOST_PASS: ${scenario}; snapshot bindings, official Git, editor context and commands verified where applicable`);
  console.log(`MENTOR_HOST_PASS: activation, three views, commands, real backend, configuration recovery; workspace=${Boolean(vscode.workspace.workspaceFolders)}`);
}
