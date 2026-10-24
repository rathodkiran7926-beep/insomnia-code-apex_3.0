import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { MentorApi } from '../src/api-client/client';
import { MentorTree } from '../src/views/mentorTree';
import type { ConnectionState } from '../src/connection';
import type { activate } from '../src/extension';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export async function run(): Promise<void> {
  const config = vscode.workspace.getConfiguration('codebaseMentor');
  await config.update('apiBaseUrl', process.env.MENTOR_TEST_BACKEND, vscode.ConfigurationTarget.Global);
  const extension = vscode.extensions.getExtension('codebase-mentor-local.codebase-mentor');
  assert.ok(extension, 'Development extension must be installed in the test host');
  const mentor = await extension.activate() as ReturnType<typeof activate>;
  assert.ok(extension.isActive);
  if (process.env.MENTOR_TEST_INSTALLED_ROOT) {
    assert.equal(path.dirname(extension.extensionPath).toLowerCase(), path.resolve(process.env.MENTOR_TEST_INSTALLED_ROOT).toLowerCase(), 'Run the actual installed VSIX, not development source');
    console.log(`MENTOR_INSTALLED_LOCATION_VERIFIED: ${extension.packageJSON.version}`);
  }
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

  await config.update('apiBaseUrl', 'invalid', vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('codebaseMentor.checkConnection');
  await assert.rejects(api.health(), error => error instanceof Error && error.message.includes('valid backend URL'));
  await config.update('apiBaseUrl', process.env.MENTOR_TEST_BACKEND, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('codebaseMentor.checkConnection');
  assert.deepEqual(await api.health(), { ok: true });
  const scenario = process.env.MENTOR_TEST_SCENARIO;
  const snapshots = JSON.parse(process.env.MENTOR_TEST_SNAPSHOTS ?? '[]') as { snapshotId: string; commit: string }[];
  const folders = vscode.workspace.workspaceFolders ?? [];
  const waitFor = async (condition: () => boolean | Promise<boolean>, attempts = 150) => {
    for (let i = 0; i < attempts; i++) {
      if (await condition()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Host test timed out waiting for repository state.');
  };
  const step = async (value: object) => { await writeFile(process.env.MENTOR_UI_STEP!, JSON.stringify(value)); };
  const stepDone = async (name: string) => waitFor(async () => { try { await readFile(`${process.env.MENTOR_UI_STEP}.${name}.complete`); return true; } catch { return false; } });
  if (scenario === 'multi-handoff') {
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    const document=await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folders[0]!.uri,'src/index.ts'));
    const active=await vscode.window.showTextDocument(document,vscode.ViewColumn.One);active.selection=new vscode.Selection(0,0,0,5);
    await waitFor(()=>Boolean(mentor.getRepositoryContext(folders[0]!.uri.toString())?.local.head));
    await step({step:'multi-handoff-connect',snapshotIndex:0,folderName:folders[0]!.name,confirm:'Connect repository'});
    await vscode.commands.executeCommand('codebaseMentor.connectRepository');
    const anchor=mentor.getRepositoryContext(folders[0]!.uri.toString())!.binding!;
    assert.equal(mentor.getCheckpointState().binding,undefined,'Hidden Focus has not established a checkpoint anchor');
    await vscode.commands.executeCommand('codebaseMentor.askSeniorWithContext');
    const question='How should this indexed validation be reviewed?';const attemptedSteps='Controlled multi-root focus check.';
    await step({step:'multi-handoff-fill',type:'handoff',action:'fill',question,attemptedSteps});await stepDone('multi-handoff-fill');
    await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
    await waitFor(()=>vscode.window.activeTextEditor===undefined);
    assert.deepEqual(mentor.getHandoffState().binding,anchor,'A handoff-only multi-root anchor survives webview focus');
    await vscode.commands.executeCommand('codebaseMentor.checkConnection');
    await step({step:'multi-handoff-preserved',type:'handoff',action:'preserved',question,attemptedSteps});await stepDone('multi-handoff-preserved');
    assert.deepEqual(mentor.getHandoffState().binding,anchor);
    // The scenario hid Focus deliberately; restore it for the final native UI assertion.
    await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
    await step({step:'done',expectedText:'Codebase Mentor'});
    await waitFor(async()=>{try{await readFile(`${process.env.MENTOR_UI_STEP}.complete`);return true}catch{return false}});
    console.log('MENTOR_MULTI_ROOT_HANDOFF_PASS: no active text editor, hidden Focus, draft survives same-binding restoration');return;
  }
  if (scenario === 'offline') {
    await waitFor(() => Boolean(mentor.getRepositoryContext(folders[0]!.uri.toString())?.local.head));
    await step({step:'offline-connect',snapshotIndex:3,confirm:'Connect repository'});
    await vscode.commands.executeCommand('codebaseMentor.connectRepository');
    const anchor=mentor.getRepositoryContext(folders[0]!.uri.toString())!.binding!;
    const document=await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folders[0]!.uri,'index.js'));
    const active=await vscode.window.showTextDocument(document,vscode.ViewColumn.One);
    active.selection=new vscode.Selection(132,0,132,8);
    await vscode.commands.executeCommand('codebaseMentor.askSeniorWithContext');
    const question='Which indexed facts remain available after reconnect?';
    const attemptedSteps='Controlled offline recovery check.';
    await step({step:'offline-fill',type:'handoff',action:'fill',question,attemptedSteps});await stepDone('offline-fill');
    await vscode.commands.executeCommand('codebaseMentor.checkConnection');
    await step({step:'offline-revalidate-preserved',type:'handoff',action:'preserved',question,attemptedSteps});await stepDone('offline-revalidate-preserved');
    await step({step:'offline-stop',type:'backend',action:'stop'});await stepDone('offline-stop');
    await step({step:'offline-preview-fails',type:'handoff',action:'offline-preview'});await stepDone('offline-preview-fails');
    await waitFor(()=>mentor.getHandoffState().status==='error');
    await assert.rejects(api.health());
    await vscode.commands.executeCommand('codebaseMentor.checkConnection');
    assert.equal(mentor.getRepositoryContext(folders[0]!.uri.toString())!.status,'unavailable');
    await step({step:'offline-draft-preserved',type:'handoff',action:'preserved',question,attemptedSteps});await stepDone('offline-draft-preserved');
    await step({step:'offline-start',type:'backend',action:'start'});await stepDone('offline-start');
    await vscode.commands.executeCommand('codebaseMentor.checkConnection');
    assert.equal(mentor.getRepositoryContext(folders[0]!.uri.toString())!.status,'ready');
    assert.deepEqual(mentor.getRepositoryContext(folders[0]!.uri.toString())!.binding,anchor);
    await step({step:'offline-retry-preview',type:'handoff',action:'preview',question,attemptedSteps});await stepDone('offline-retry-preview');
    await waitFor(()=>mentor.getHandoffState().status==='ready'&&!!mentor.getHandoffState().preview);
    assert.equal(mentor.getHandoffState().preview!.input.question,question);
    assert.equal((await api.listHandoffs(anchor)).items.length,0,'No offline/recovery action implicitly saves a handoff');
    await step({step:'done',expectedText:'Codebase Mentor'});
    await waitFor(async()=>{try{await readFile(`${process.env.MENTOR_UI_STEP}.complete`);return true}catch{return false}});
    console.log('MENTOR_OFFLINE_RECOVERY_PASS: real backend stop/restart, draft preservation, explicit preview retry, unchanged binding');
    return;
  }
  if (scenario?.startsWith('handoff-')) {
    const question = 'Why does limitFunction create its own limiter?';
    const attemptedSteps = 'I inspected index.js and followed the options passed to pLimit.';
    await waitFor(() => Boolean(mentor.getRepositoryContext(folders[0]!.uri.toString())?.local.head));
    if (scenario === 'handoff-save') {
      await step({ step: 'handoff-connect', snapshotIndex: 3, confirm: 'Connect repository' });
      await vscode.commands.executeCommand('codebaseMentor.connectRepository');
    } else await waitFor(() => mentor.getRepositoryContext(folders[0]!.uri.toString())?.status === 'ready');
    const anchor = mentor.getRepositoryContext(folders[0]!.uri.toString())!.binding!;
    await vscode.commands.executeCommand('codebaseMentor.refreshHandoffs');
    if (scenario === 'handoff-disabled') {
      assert.equal(mentor.getHandoffState().status, 'disabled');
      assert.equal((await api.handoffCapability()).enabled, false);
      assert.equal((await api.checkpointCapability()).enabled, true, 'Independent checkpoint capability remains enabled');
      await assert.rejects(api.listHandoffs(anchor));
      await step({ step: 'done', expectedText: 'disabled' });
      await waitFor(async () => { try { await readFile(`${process.env.MENTOR_UI_STEP}.complete`); return true; } catch { return false; } });
      return;
    }
    assert.equal(mentor.getHandoffState().capability?.enabled, true);
    const graph = await api.evidence(anchor.snapshotId);
    const component = graph.components.find(c => c.name === 'limitFunction')!; assert.ok(component);
    const reference = graph.references.find(r => r.id === component.referenceId)!;
    assert.equal(reference.file, 'index.js'); assert.equal(reference.startLine, 133);
    const openEditor = async () => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folders[0]!.uri, reference.file));
      const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
      editor.selection = new vscode.Selection(reference.startLine - 1, 0, reference.startLine - 1, 1);
    };
    const sentinel = 'MENTOR_TEST_CLIPBOARD_UNCHANGED'; await vscode.env.clipboard.writeText(sentinel);
    if (scenario === 'handoff-save') {
      await openEditor();
      await vscode.commands.executeCommand('codebaseMentor.askSeniorWithContext');
      await step({ step: 'handoff-fill', type: 'handoff', action: 'fill', question, attemptedSteps }); await stepDone('handoff-fill');
      await openEditor(); await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      await vscode.commands.executeCommand('codebaseMentor.askSeniorWithContext');
      await vscode.commands.executeCommand('codebaseMentor.refreshHandoffs');
      await step({ step: 'handoff-preview', type: 'handoff', action: 'preview', question, attemptedSteps }); await stepDone('handoff-preview');
      await waitFor(() => !!mentor.getHandoffState().preview && mentor.getHandoffState().status === 'ready');
      const initial = mentor.getHandoffState().preview!;
      assert.equal(initial.input.question, question); assert.equal(initial.input.attemptedSteps, attemptedSteps);
      assert.deepEqual(initial.selection.excerptReferenceIds, []); assert.equal(initial.selection.includeCheckpointNotes, false); assert.equal(initial.selection.includeDocumentation, false);
      assert.ok(initial.candidates.references.length > 1, 'Real p-limit neighborhood provides removable candidates');
      assert.equal((await api.listHandoffs(anchor)).items.length, 0, 'Preview must not persist');
      const removed = initial.selection.referenceIds.find(id => id !== reference.id)!; assert.ok(removed);
      await step({ step: 'handoff-refine', type: 'handoff', action: 'refine', removed }); await stepDone('handoff-refine');
      await waitFor(() => mentor.getHandoffState().preview !== initial && mentor.getHandoffState().status === 'ready');
      const approved = mentor.getHandoffState().preview!;
      assert.ok(!approved.selection.referenceIds.includes(removed)); assert.ok(!approved.context.references.some(ref => ref.id === removed));
      await step({ step: 'handoff-canonical', type: 'handoff', action: 'canonical', markdown: approved.markdown }); await stepDone('handoff-canonical');
      assert.equal(await vscode.env.clipboard.readText(), sentinel, 'Compose and preview must not copy');
      await step({ step: 'handoff-save-confirm', type: 'handoff', action: 'save' }); await stepDone('handoff-save-confirm');
      await waitFor(() => mentor.getHandoffState().status === 'ready' && !!mentor.getHandoffState().detail);
      const saved = mentor.getHandoffState().detail!; const persisted = await api.handoff(anchor, saved.id);
      assert.equal(persisted.markdown, approved.markdown); assert.equal(persisted.digest, approved.digest); assert.deepEqual(persisted.context, approved.context);
      assert.equal(await vscode.env.clipboard.readText(), sentinel, 'Save must not copy');
      // Seed only a checkpoint through its supported API; the handoff is composed and approved in the actual webview.
      const checkpoint = await api.createCheckpoint(anchor, { requestId: randomUUID(), snapshotId: anchor.snapshotId, taskTitle: 'Handoff continuity fixture', notes: { discovery: 'Controlled checkpoint fixture note.', unresolved: '', nextStep: '' }, localContext: { gitStatus: 'clean', headCommit: anchor.indexedCommit }, sourceReferenceIds: [reference.id] });
      await writeFile(`${process.env.MENTOR_HANDOFF_METADATA}`, JSON.stringify({ id: saved.id, digest: saved.digest, checkpointId: checkpoint.checkpoint.id, snapshotId: anchor.snapshotId, referenceId: reference.id }));
      for (const origin of ['map', 'checkpoint'] as const) {
        if (origin === 'map') {
          await openEditor(); await vscode.commands.executeCommand('codebaseMentor.showRelatedCode');
          await vscode.commands.executeCommand('codebaseMentor.askSeniorMap');
        } else {
          await vscode.commands.executeCommand('codebaseMentor.refreshCheckpoints');
          await vscode.commands.executeCommand('codebaseMentor.askSeniorTask', { id: checkpoint.checkpoint.id });
        }
        const ownQuestion = `${question} (${origin} entry)`;
        await step({ step: `handoff-${origin}-fill`, type: 'handoff', action: 'fill', question: ownQuestion, attemptedSteps }); await stepDone(`handoff-${origin}-fill`);
        await step({ step: `handoff-${origin}-preview`, type: 'handoff', action: 'preview', question: ownQuestion, attemptedSteps }); await stepDone(`handoff-${origin}-preview`);
        await waitFor(() => mentor.getHandoffState().preview?.input.origin.type === origin);
        const packageToSave = mentor.getHandoffState().preview!;
        if (origin === 'checkpoint') { assert.equal(packageToSave.input.origin.checkpointId, checkpoint.checkpoint.id); assert.equal(packageToSave.context.checkpointNotes, undefined); }
        await step({ step: `handoff-${origin}-save`, type: 'handoff', action: 'save' }); await stepDone(`handoff-${origin}-save`);
        await waitFor(() => mentor.getHandoffState().detail?.context.origin.type === origin);
        assert.equal((await api.handoff(anchor, mentor.getHandoffState().detail!.id)).markdown, packageToSave.markdown);
        assert.deepEqual(mentor.getRepositoryContext(folders[0]!.uri.toString())!.binding, anchor);
      }
      const controlledBinding = { ...anchor, snapshotId: snapshots[4]!.snapshotId, indexedCommit: snapshots[4]!.commit };
      const controlledGraph = await api.evidence(controlledBinding.snapshotId);
      const controlledComponent = controlledGraph.components.find(c => c.name === 'limitFunction')!;
      const controlledCheckpoint = await api.createCheckpoint(controlledBinding, { requestId: randomUUID(), snapshotId: controlledBinding.snapshotId, taskTitle: 'Controlled comparison checkpoint', notes: { discovery: '', unresolved: '', nextStep: '' }, localContext: { gitStatus: 'clean', headCommit: controlledBinding.indexedCommit }, sourceReferenceIds: [controlledComponent.referenceId] });
      await vscode.commands.executeCommand('codebaseMentor.refreshCheckpoints');
      await vscode.commands.executeCommand('codebaseMentor.resumeTask', { id: controlledCheckpoint.checkpoint.id });
      assert.equal(mentor.getCheckpointState().resume?.comparison?.id, '3e9b5af6-6ef2-423d-87cd-63e0e4eab777');
      await step({ step: 'handoff-controlled-review-changes', type: 'checkpoint', action: 'changes' }); await stepDone('handoff-controlled-review-changes');
      await waitFor(() => !!mentor.getPrState().comparison);
      const comparison = mentor.getPrState().comparison!;
      assert.match(comparison.pr.title, /Controlled local fixture/);
      for (const side of ['before', 'after'] as const) {
        const target = comparison.components.find(c => c[side]?.name === 'limitFunction')![side]!;
        await vscode.commands.executeCommand('codebaseMentor.askSeniorChange', { viewId: mentor.getPrState().viewId, side, componentId: target.id, referenceId: target.reference.id });
        await step({ step: `handoff-pr-${side}-fill`, type: 'handoff', action: 'fill', question: `${question} (controlled PR ${side})`, attemptedSteps }); await stepDone(`handoff-pr-${side}-fill`);
        await step({ step: `handoff-pr-${side}-preview`, type: 'handoff', action: 'preview', question: `${question} (controlled PR ${side})`, attemptedSteps }); await stepDone(`handoff-pr-${side}-preview`);
        await waitFor(() => mentor.getHandoffState().preview?.input.origin.comparisonSide === side);
        const approved = mentor.getHandoffState().preview!;
        assert.equal(approved.input.origin.comparisonId, comparison.id); assert.equal(approved.context.snapshotId, target.reference.snapshotId);
        await step({ step: `handoff-pr-${side}-save`, type: 'handoff', action: 'save' }); await stepDone(`handoff-pr-${side}-save`);
        await waitFor(() => mentor.getHandoffState().detail?.context.origin.comparisonSide === side);
        assert.equal((await api.handoff(anchor, mentor.getHandoffState().detail!.id)).markdown, approved.markdown);
        assert.deepEqual(mentor.getRepositoryContext(folders[0]!.uri.toString())!.binding, anchor);
      }
    } else {
      const metadata = JSON.parse(await readFile(process.env.MENTOR_HANDOFF_METADATA!, 'utf8')) as { id: string; digest: string; checkpointId: string };
      assert.ok(mentor.getHandoffState().page?.items.some(item => item.id === metadata.id), 'Backend and desktop restarts retain saved row');
      await step({ step: 'handoff-native-open', type: 'handoff', action: 'native-open', question }); await stepDone('handoff-native-open');
      await waitFor(() => mentor.getHandoffState().detail?.id === metadata.id);
      const saved = mentor.getHandoffState().detail!; assert.equal(saved.digest, metadata.digest);
      await step({ step: 'handoff-reopened-canonical', type: 'handoff', action: 'canonical', markdown: saved.markdown }); await stepDone('handoff-reopened-canonical');
      assert.equal(await vscode.env.clipboard.readText(), sentinel, 'Opening saved row must not copy');
      if (scenario === 'handoff-reopen') {
        await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Light Modern', vscode.ConfigurationTarget.Global);
        await step({ step: 'handoff-light-canonical', type: 'handoff', action: 'canonical', markdown: saved.markdown }); await stepDone('handoff-light-canonical');
        await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default High Contrast', vscode.ConfigurationTarget.Global);
        await step({step:'handoff-high-contrast-canonical',type:'handoff',action:'canonical',markdown:saved.markdown,theme:'vscode-high-contrast'});await stepDone('handoff-high-contrast-canonical');
        await step({step:'handoff-narrow-canonical',type:'handoff',action:'canonical',markdown:saved.markdown,narrow:true});await stepDone('handoff-narrow-canonical');
        await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
        await step({ step: 'handoff-copy', type: 'handoff', action: 'copy' }); await stepDone('handoff-copy');
        await waitFor(async () => await vscode.env.clipboard.readText() === saved.markdown);
        assert.deepEqual(Buffer.from(await vscode.env.clipboard.readText(), 'utf8'), Buffer.from((await api.exportHandoff(anchor, saved.id)).markdown, 'utf8'));
        const exportFile = `${process.env.MENTOR_HANDOFF_METADATA}.md`;
        await step({ step: 'handoff-export-file', type: 'handoff', action: 'export', file: exportFile }); await stepDone('handoff-export-file');
        await waitFor(async () => { try { return (await readFile(exportFile, 'utf8')) === saved.markdown; } catch { return false; } });
        assert.deepEqual(await readFile(exportFile), Buffer.from(saved.markdown, 'utf8'), 'Actual exported file matches exact canonical bytes');
        const ref = saved.context.references.find(ref => ref.id === reference.id)!; assert.ok(ref);
        await step({ step: 'handoff-source', type: 'handoff', action: 'source', referenceId: ref.id }); await stepDone('handoff-source');
        await waitFor(() => ['file', 'codebase-mentor-source'].includes(vscode.window.activeTextEditor?.document.uri.scheme ?? '') && vscode.window.activeTextEditor!.selection.start.line === ref.startLine - 1);
        const opened = vscode.window.activeTextEditor!.document.uri;
        if (opened.scheme === 'codebase-mentor-source') assert.ok(opened.query.includes(anchor.indexedCommit));
        else assert.equal(opened.toString(), vscode.Uri.joinPath(folders[0]!.uri, ref.file).toString(), 'Verified matching checkout uses existing local adapter');
        // The other real Git fixture is deliberately outside this single-root
        // workspace. Its editor must not inherit the connected repository's data.
        const otherDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(process.env.MENTOR_OTHER_REPOSITORY_FILE!));
        await vscode.window.showTextDocument(otherDocument, vscode.ViewColumn.One);
        await waitFor(() => mentor.getHandoffState().binding === undefined);
        const cleared = mentor.getHandoffState();
        assert.equal(cleared.preview, undefined); assert.equal(cleared.detail, undefined); assert.equal(cleared.page, undefined);
        assert.equal(mentor.getEditorContext(), undefined, 'Unconnected external Git repository has no supported editor binding');
        assert.deepEqual(mentor.getRepositoryContext(folders[0]!.uri.toString())!.binding, anchor, 'Switching editors retains the persisted public repository binding');
        await step({ step: 'handoff-unconnected-repository-clear', type: 'handoff', action: 'cleared', question }); await stepDone('handoff-unconnected-repository-clear');
        await openEditor(); await vscode.commands.executeCommand('codebaseMentor.refreshHandoffs');
        assert.ok(mentor.getHandoffState().page?.items.some(item => item.id === metadata.id), 'Returning to connected public repository restores its saved records');
        await step({ step: 'handoff-return-native-open', type: 'handoff', action: 'native-open', question }); await stepDone('handoff-return-native-open');
        await waitFor(() => mentor.getHandoffState().detail?.id === metadata.id);
        assert.equal(mentor.getHandoffState().detail!.markdown, saved.markdown);
        await step({ step: 'handoff-return-canonical', type: 'handoff', action: 'canonical', markdown: saved.markdown }); await stepDone('handoff-return-canonical');
      } else {
        await step({ step: 'handoff-delete-confirm', type: 'handoff', action: 'delete' }); await stepDone('handoff-delete-confirm');
        await waitFor(() => mentor.getHandoffState().status === 'ready' && !mentor.getHandoffState().page?.items.some(item => item.id === metadata.id));
        await assert.rejects(api.handoff(anchor, metadata.id), error => (error as { status?: number }).status === 404);
        assert.equal((await api.checkpoint(anchor, metadata.checkpointId)).checkpoint.id, metadata.checkpointId);
        assert.equal((await api.snapshot(anchor.snapshotId)).snapshotId, anchor.snapshotId);
      }
    }
    await vscode.commands.executeCommand('codebaseMentor.openWorkspace');
    await step({ step: 'done', expectedText: 'Saved Handoffs' });
    await waitFor(async () => { try { await readFile(`${process.env.MENTOR_UI_STEP}.complete`); return true; } catch { return false; } });
    return;
  }
  if (scenario?.startsWith('checkpoint-')) {
    const title = 'Investigate component behavior';
    const discovery = 'Verification note entered explicitly in the checkpoint form.';
    const unresolved = 'Which source-backed component should be inspected next?';
    await waitFor(() => Boolean(mentor.getRepositoryContext(folders[0]!.uri.toString())?.local.head));
    if (scenario === 'checkpoint-save') {
      await step({ step: 'checkpoint-connect', snapshotIndex: 3, confirm: 'Connect repository' });
      await vscode.commands.executeCommand('codebaseMentor.connectRepository');
    } else await waitFor(() => mentor.getRepositoryContext(folders[0]!.uri.toString())?.status === 'ready');
    const anchor = mentor.getRepositoryContext(folders[0]!.uri.toString())!.binding!;
    await vscode.commands.executeCommand('codebaseMentor.refreshCheckpoints');
    assert.equal(mentor.getCheckpointState().capability?.enabled, true);
    if (scenario === 'checkpoint-save') {
      const graph = await api.evidence(anchor.snapshotId); const component = graph.components.find(c => c.name === 'limitFunction')!;
      const ref = graph.references.find(r => r.id === component.referenceId)!;
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folders[0]!.uri, ref.file));
      const active = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
      active.selection = new vscode.Selection(ref.startLine - 1, 0, ref.startLine - 1, 1);
      await vscode.commands.executeCommand('codebaseMentor.saveTaskCheckpoint');
      await step({ step: 'checkpoint-fill', type: 'checkpoint', action: 'fill', title, discovery, unresolved }); await stepDone('checkpoint-fill');
      await vscode.commands.executeCommand('codebaseMentor.refreshCheckpoints');
      await step({ step: 'checkpoint-preview', type: 'checkpoint', action: 'preview', title, discovery, unresolved }); await stepDone('checkpoint-preview');
      assert.equal((await api.listCheckpoints(anchor)).items.length, 0, 'Preview must not write a checkpoint');
      await step({ step: 'checkpoint-confirm', type: 'checkpoint', action: 'save' }); await stepDone('checkpoint-confirm');
      await waitFor(() => mentor.getCheckpointState().status === 'ready' && !!mentor.getCheckpointState().detail && !!mentor.getCheckpointState().page?.items.some(item => item.taskTitle === title));
      const saved = mentor.getCheckpointState().detail!.checkpoint;
      assert.equal(saved.taskTitle, title); assert.equal(saved.notes.discovery, discovery); assert.equal(saved.notes.unresolved, unresolved); assert.equal(saved.notes.nextStep, '');
      assert.ok(saved.sourceReferenceIds.includes(ref.id));
      await writeFile(`${process.env.MENTOR_UI_STEP}.saved.json`, JSON.stringify({ id: saved.id, componentId: component.id, referenceId: ref.id, snapshotId: saved.snapshotId }));
      await step({ step: 'checkpoint-saved-proof', type: 'checkpoint', action: 'inspect', title, discovery, unresolved }); await stepDone('checkpoint-saved-proof');
    } else {
      const page = mentor.getCheckpointState().page!; const saved = page.items.find(c => c.taskTitle === title)!; assert.ok(saved, 'Checkpoint must survive process restarts');
      await step({ step: 'checkpoint-native-resume', type: 'checkpoint', action: 'native-resume', title, expectedViewId: mentor.getCheckpointState().viewId }); await stepDone('checkpoint-native-resume');
      try { await waitFor(() => mentor.getCheckpointState().resume?.detail.checkpoint.id === saved.id); }
      catch { const state = mentor.getCheckpointState(); throw new Error(`Native resume did not complete: ${JSON.stringify({ status: state.status, message: state.message, viewId: state.viewId, pageCount: state.page?.items.length, detailId: state.detail?.checkpoint.id, resumeId: state.resume?.detail.checkpoint.id })}`); }
      const state = mentor.getCheckpointState(); const result = state.resume!; const detail = result.detail;
      assert.equal(detail.checkpoint.notes.discovery, discovery); assert.equal(detail.checkpoint.notes.unresolved, unresolved); assert.equal(detail.checkpoint.notes.nextStep, '');
      assert.equal(result.versions.localHead, 'different'); assert.equal(result.versions.indexed, 'same');
      assert.equal(detail.checkpoint.snapshotId, snapshots[3]!.snapshotId);
      if (scenario === 'checkpoint-resume') {
        const reference = detail.references[0]!, component = detail.components.find(c => c.referenceId === reference.id)!;
        await step({ step: 'checkpoint-source', type: 'checkpoint', action: 'source', expectedViewId: mentor.getCheckpointState().viewId, referenceId: reference.id }); await stepDone('checkpoint-source');
        await waitFor(() => vscode.window.activeTextEditor?.document.uri.scheme === 'codebase-mentor-source' && vscode.window.activeTextEditor.selection.start.line === reference.startLine - 1);
        assert.equal(vscode.window.activeTextEditor!.selection.start.line, reference.startLine - 1);
        await vscode.commands.executeCommand('codebaseMentor.resumeTask', { id: saved.id });
        await step({ step: 'checkpoint-map', type: 'checkpoint', action: 'map', expectedViewId: mentor.getCheckpointState().viewId, referenceId: reference.id, componentId: component.id }); await stepDone('checkpoint-map');
        await waitFor(() => mentor.getAtlasState().result?.target.component.id === component.id);
        assert.equal(mentor.getAtlasState().result!.target.binding.snapshotId, saved.snapshotId);
        await vscode.commands.executeCommand('codebaseMentor.resumeTask', { id: saved.id });
        await step({ step: 'checkpoint-mentor', type: 'checkpoint', action: 'mentor', expectedViewId: mentor.getCheckpointState().viewId, referenceId: reference.id, componentId: component.id }); await stepDone('checkpoint-mentor');
        await step({ step: 'checkpoint-indexed-ack', type: 'indexed-ack' }); await stepDone('checkpoint-indexed-ack');
        await waitFor(() => mentor.getMentorState().status === 'ready');
        assert.equal(mentor.getMentorState().result!.component.id, component.id); assert.equal(mentor.getMentorState().result!.snapshot.snapshotId, saved.snapshotId);
        assert.deepEqual(mentor.getRepositoryContext(folders[0]!.uri.toString())!.binding, anchor);
        assert.match(result.changes.notice, /local.*not|local.*unverified/i);
        await vscode.commands.executeCommand('codebaseMentor.resumeTask', { id: saved.id });
        assert.equal(mentor.getMentorState().status, 'ready', 'Same-checkpoint refresh must retain valid Mentor context');
        assert.equal(mentor.getAtlasState().result?.target.component.id, component.id, 'Same-checkpoint refresh must retain Map context');
        await step({ step: 'checkpoint-resume-proof', type: 'checkpoint', action: 'inspect', title, discovery, unresolved }); await stepDone('checkpoint-resume-proof');
      } else {
        await step({ step: 'checkpoint-delete-confirm', type: 'checkpoint', action: 'delete', expectedViewId: mentor.getCheckpointState().viewId }); await stepDone('checkpoint-delete-confirm');
        await waitFor(() => mentor.getCheckpointState().status === 'ready' && !mentor.getCheckpointState().page?.items.some(c => c.id === saved.id));
        await assert.rejects(api.checkpoint(anchor, saved.id), error => (error as { status?: number }).status === 404);
        assert.equal((await api.snapshot(anchor.snapshotId)).snapshotId, anchor.snapshotId);
        assert.deepEqual(mentor.getRepositoryContext(folders[0]!.uri.toString())!.binding, anchor);
      }
    }
    await vscode.commands.executeCommand('codebaseMentor.openWorkspace');
    await step({ step: 'done', expectedText: scenario === 'checkpoint-delete' ? 'No saved task checkpoints yet.' : title });
    await waitFor(async () => { try { await readFile(`${process.env.MENTOR_UI_STEP}.complete`); return true; } catch { return false; } });
    return;
  }
  if (scenario === 'pr') {
    await waitFor(() => Boolean(mentor.getRepositoryContext(folders[0]!.uri.toString())?.local.head));
    await step({ step: 'pr-connect', snapshotIndex: 3, confirm: 'Connect repository' });
    await vscode.commands.executeCommand('codebaseMentor.connectRepository');
    const anchor = mentor.getRepositoryContext(folders[0]!.uri.toString())!.binding!;
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folders[0]!.uri, 'index.js'));
    await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    await vscode.commands.executeCommand('codebaseMentor.openChanges');
    await waitFor(() => !!mentor.getPrState().page || mentor.getPrState().status === 'error', 600);
    assert.ok(mentor.getPrState().page, JSON.stringify(mentor.getPrState()));
    assert.ok(mentor.getPrState().page!.pullRequests.some(p => p.number === 106));
    await step({ step: 'pr-select-live', type: 'pr', action: 'select' }); await stepDone('pr-select-live');
    await waitFor(() => mentor.getPrState().selected?.number === 106);
    const observed: { status: string; progress: number; message: string }[] = [];
    const sample = setInterval(() => { const s = mentor.getPrState(); if (s.job) observed.push({ status: s.job.status, progress: s.job.progress, message: s.job.message }); }, 100);
    try {
      await step({ step: 'pr-start-live', type: 'pr', action: 'start' }); await stepDone('pr-start-live');
      await waitFor(() => ['ready', 'error', 'cancelled'].includes(mentor.getPrState().status), 1800);
    } finally { clearInterval(sample); }
    assert.equal(mentor.getPrState().status, 'ready', JSON.stringify(mentor.getPrState()));
    const state = mentor.getPrState(); const result = state.comparison!; const viewId = state.viewId;
    assert.equal(result.pr.number, 106); assert.equal(result.pr.baseRepository, anchor.repositoryIdentity);
    assert.notEqual(result.pr.headRepository, result.pr.baseRepository, 'Real fork PR exercises distinct repositories');
    assert.ok(result.pr.files.length > 0); assert.ok(result.components.length > 0); assert.ok(observed.some(s => s.status === 'running'));
    const before = result.components.find(c => c.before?.reference.file === 'index.js' && c.after?.reference.file === 'index.js')!;
    assert.ok(before); const beforeComponent = before.before!, afterComponent = before.after!;
    assert.equal(beforeComponent.reference.snapshotId, result.beforeSnapshotId); assert.equal(afterComponent.reference.snapshotId, result.afterSnapshotId);
    await step({ step: 'pr-results-live', type: 'pr', action: 'inspect' }); await stepDone('pr-results-live');
    const fileIndex = result.pr.files.findIndex(f => f.path === 'index.js');
    await vscode.commands.executeCommand('codebaseMentor.openPrDiff', { viewId, fileIndex });
    await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff);
    const diff = vscode.window.tabGroups.activeTabGroup.activeTab!.input as vscode.TabInputTextDiff;
    assert.equal(diff.original.scheme, 'codebase-mentor-source'); assert.equal(diff.modified.scheme, 'codebase-mentor-source');
    assert.ok(diff.original.query.includes(result.pr.baseCommit)); assert.ok(diff.modified.query.includes(result.pr.headCommit));
    assert.ok((await vscode.workspace.openTextDocument(diff.original)).getText().length > 100);
    assert.ok((await vscode.workspace.openTextDocument(diff.modified)).getText().length > 100);
    await step({ step: 'pr-diff-live', type: 'pr', action: 'diff-proof' }); await stepDone('pr-diff-live');
    await vscode.commands.executeCommand('codebaseMentor.openPrSource', { viewId, side: 'before', componentId: beforeComponent.id, referenceId: beforeComponent.reference.id });
    assert.equal(vscode.window.activeTextEditor!.document.uri.scheme, 'codebase-mentor-source');
    assert.equal(vscode.window.activeTextEditor!.selection.start.line, beforeComponent.reference.startLine - 1);
    await vscode.commands.executeCommand('codebaseMentor.prExploreMap', { viewId, side: 'after', componentId: afterComponent.id, referenceId: afterComponent.reference.id });
    assert.equal(mentor.getAtlasState().result!.target.binding.snapshotId, result.afterSnapshotId);
    assert.equal(mentor.getAtlasState().result!.target.component.id, afterComponent.id);
    await step({ step: 'pr-mentor-indexed', type: 'indexed-ack' });
    await vscode.commands.executeCommand('codebaseMentor.prExplainComponent', { viewId, side: 'after', componentId: afterComponent.id, referenceId: afterComponent.reference.id });
    assert.equal(mentor.getMentorState().status, 'ready', JSON.stringify(mentor.getMentorState()));
    assert.equal(mentor.getMentorState().result!.component.id, afterComponent.id);
    assert.equal(mentor.getMentorState().result!.snapshot.snapshotId, result.afterSnapshotId);
    await step({ step: 'pr-mentor-live', type: 'mentor', action: 'inspect', component: afterComponent.name, expectedAnswer: mentor.getMentorState().result!.id }); await stepDone('pr-mentor-live');
    assert.deepEqual(mentor.getRepositoryContext(folders[0]!.uri.toString())!.binding, anchor);
    await writeFile(`${process.env.MENTOR_UI_STEP}.evidence.json`, JSON.stringify({ comparisonId: result.id, pr: result.pr.url, baseRepository: result.pr.baseRepository, headRepository: result.pr.headRepository, mergeBase: result.pr.baseCommit, head: result.pr.headCommit, target: result.pr.targetCommit, beforeSnapshotId: result.beforeSnapshotId, afterSnapshotId: result.afterSnapshotId, files: result.pr.files.map(f => ({ path: f.path, status: f.status })), components: result.components.length, addedEdges: result.edges.added.length, removedEdges: result.edges.removed.length, impactBefore: result.impact.before.length, impactAfter: result.impact.after.length, setupCounts: { dependencies: result.setup.dependencies.length, scripts: result.setup.scripts.length, environment: result.setup.environment.length }, observed, unchangedWorkspaceSnapshot: anchor.snapshotId }, null, 2));
    await vscode.commands.executeCommand('codebaseMentor.disconnectRepository', folders[0]!.uri.toString());
    assert.equal(mentor.getPrState().comparison, undefined); assert.equal(mentor.getAtlasState().result, undefined);
    await vscode.commands.executeCommand('codebaseMentor.openWorkspace');
    await step({ step: 'done', expectedText: 'No snapshot connected' });
    await waitFor(async () => { try { await readFile(`${process.env.MENTOR_UI_STEP}.complete`); return true; } catch { return false; } });
    return;
  }
  if (scenario === 'public') {
    const snapshot = snapshots[3]!;
    await waitFor(() => Boolean(mentor.getRepositoryContext(folders[0]!.uri.toString())?.local.head));
    await step({ step: 'public-connect', snapshotIndex: 3, confirm: 'Connect repository' });
    await vscode.commands.executeCommand('codebaseMentor.connectRepository');
    assert.equal(mentor.getRepositoryContext(folders[0]!.uri.toString())?.binding?.snapshotId, snapshot.snapshotId);
    const graph = await api.get<{ components: { id: string; name: string; referenceId: string }[]; relationships: { id: string; source: string; target: string; type: string; referenceId: string }[]; references: { id: string; file: string; startLine: number; endLine: number }[] }>(`/api/snapshots/${snapshot.snapshotId}`);
    const component = graph.components.find(c => c.name === 'limitFunction')!; assert.ok(component);
    const reference = graph.references.find(r => r.id === component.referenceId)!;
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folders[0]!.uri, reference.file));
    const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    editor.selection = new vscode.Selection(reference.startLine - 1, 0, reference.startLine - 1, 5);
    await vscode.commands.executeCommand('codebaseMentor.showRelatedCode');
    let result = mentor.getAtlasState().result;
    assert.equal(mentor.getAtlasState().status, 'ready', JSON.stringify(mentor.getAtlasState()));
    assert.equal(result!.target.component.id, component.id); assert.equal(mentor.getMentorState().result, undefined);
    const supported = graph.relationships.filter(e => e.source === component.id || e.target === component.id);
    assert.deepEqual(new Set([...result!.neighborhood.incoming, ...result!.neighborhood.outgoing].map(e => e.id)), new Set(supported.map(e => e.id)));
    const edge = result!.neighborhood.outgoing.find(e => e.source !== e.target)!; assert.ok(edge);
    const related = result!.neighborhood.components.find(c => c.id === edge.target)!;
    const evidence = result!.neighborhood.references.find(r => r.id === edge.referenceId)!;
    await step({ step: 'atlas-public-edge', type: 'atlas', action: 'evidence', component: component.name, related: related.name });
    await stepDone('atlas-public-edge');
    await waitFor(() => vscode.window.activeTextEditor?.selection.start.line === evidence.startLine - 1);
    assert.equal(vscode.window.activeTextEditor!.document.uri.fsPath, vscode.Uri.joinPath(folders[0]!.uri, evidence.file).fsPath);
    assert.equal(vscode.window.activeTextEditor!.selection.start.line, evidence.startLine - 1);
    await step({ step: 'atlas-public-explore', type: 'atlas', action: 'explore', component: component.name, related: related.name });
    await stepDone('atlas-public-explore'); await waitFor(() => mentor.getAtlasState().result?.target.component.id === related.id);
    result = mentor.getAtlasState().result!;
    await vscode.commands.executeCommand('codebaseMentor.openAtlasSource', { viewId: result.id, referenceId: related.referenceId });
    const relatedRef = result.neighborhood.references.find(r => r.id === related.referenceId)!;
    assert.equal(vscode.window.activeTextEditor!.selection.start.line, relatedRef.startLine - 1);
    await vscode.commands.executeCommand('codebaseMentor.explainAtlasComponent', { viewId: result.id, componentId: related.id });
    assert.equal(mentor.getMentorState().status, 'ready', JSON.stringify(mentor.getMentorState()));
    assert.equal(mentor.getMentorState().result!.component.id, related.id);
    assert.equal(mentor.getMentorState().result!.snapshot.snapshotId, snapshot.snapshotId);
    await step({ step: 'atlas-public-mentor', type: 'mentor', action: 'inspect', component: related.name, expectedAnswer: mentor.getMentorState().result!.id }); await stepDone('atlas-public-mentor');
    await vscode.commands.executeCommand('codebaseMentor.mapBack');
    assert.equal(mentor.getAtlasState().result!.target.component.id, component.id);
    await step({ step: 'atlas-public-mentor-related', type: 'mentor', action: 'related', component: related.name, expectedAnswer: mentor.getMentorState().result!.id });
    await stepDone('atlas-public-mentor-related'); await waitFor(() => mentor.getAtlasState().result?.target.component.id === related.id);
    await vscode.commands.executeCommand('codebaseMentor.mapBack');
    assert.equal(mentor.getAtlasState().result!.target.component.id, component.id);
    await vscode.commands.executeCommand('codebaseMentor.map.focus');
    await step({ step: 'atlas-public-proof', type: 'atlas', action: 'inspect', component: component.name }); await stepDone('atlas-public-proof');
    // Public source has dynamic/external unresolved calls. Test a genuinely empty
    // supported neighborhood from the same graph, without manufacturing edges.
    const connected = new Set(graph.relationships.flatMap(e => [e.source, e.target]));
    const isolated = graph.components.find(c => !connected.has(c.id))!; assert.ok(isolated, 'Public graph must offer an isolated component');
    const isolatedRef = graph.references.find(r => r.id === isolated.referenceId)!;
    const isolatedDoc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folders[0]!.uri, isolatedRef.file));
    const isolatedEditor = await vscode.window.showTextDocument(isolatedDoc, vscode.ViewColumn.One);
    isolatedEditor.selection = new vscode.Selection(isolatedRef.startLine - 1, 0, isolatedRef.startLine - 1, 1);
    await vscode.commands.executeCommand('codebaseMentor.showRelatedCode');
    assert.equal(mentor.getAtlasState().result!.target.component.id, isolated.id);
    assert.equal(mentor.getAtlasState().result!.neighborhood.incoming.length + mentor.getAtlasState().result!.neighborhood.outgoing.length, 0);
    execFileSync('git', ['-c', `core.hooksPath=${process.env.MENTOR_TEST_HOOKS}`, '-c', 'user.name=Mentor Test', '-c', 'user.email=mentor-test@example.invalid', '-C', folders[0]!.uri.fsPath, 'commit', '--allow-empty', '-m', 'Version mismatch test'], { windowsHide: true });
    const git = await vscode.extensions.getExtension<{ getAPI(version: 1): { getRepository(uri: vscode.Uri): { status(): Promise<void> } | null } }>('vscode.git')!.activate();
    await git.getAPI(1).getRepository(folders[0]!.uri)!.status();
    await waitFor(() => mentor.getRepositoryContext(folders[0]!.uri.toString())?.comparison?.revision === 'different');
    const historical = mentor.getAtlasState().result!;
    await vscode.commands.executeCommand('codebaseMentor.openAtlasSource', { viewId: historical.id, referenceId: historical.target.component.referenceId });
    assert.equal(vscode.window.activeTextEditor!.document.uri.scheme, 'codebase-mentor-source');
    await vscode.commands.executeCommand('codebaseMentor.disconnectRepository', folders[0]!.uri.toString());
    assert.equal(mentor.getAtlasState().result, undefined);
    await vscode.commands.executeCommand('codebaseMentor.openWorkspace');
    await step({ step: 'done', expectedText: 'No snapshot connected' });
    await waitFor(async () => { try { await readFile(`${process.env.MENTOR_UI_STEP}.complete`); return true; } catch { return false; } });
    console.log(`MENTOR_PHASE4_HOST_PASS: public p-limit @ ${snapshot.commit}; real selection, exact graph edges, edge evidence, native exploration, related source/Mentor, back, empty, changed HEAD indexed source, disconnect`);
    return;
  }
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
