import { readFile, writeFile } from 'node:fs/promises';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** CDP controls only the isolated Extension Development Host workbench. */
export async function driveWorkbench(port, stepFile, snapshots, screenshotFile, backendControl) {
  let socket; let sequence = 0;
  const pending = new Map();
  const contexts = new Map();
  async function waitFor(fn, label, timeout = 25000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = await fn(); if (result) return result;
      await pause(100);
    }
    throw new Error(`UI timed out: ${label}`);
  }
  await waitFor(async () => {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find(item => item.type === 'page' && item.url.includes('workbench'));
      if (!target) return false;
      socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
      socket.onmessage = event => {
        const response = JSON.parse(event.data);
        if (response.method === 'Target.attachedToTarget') {
          const sessionId = response.params.sessionId;
          void send('Runtime.enable', {}, sessionId).catch(() => {});
          void send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => {});
        }
        if (response.method === 'Runtime.executionContextCreated' && response.params.context.auxData?.isDefault !== false) contexts.set(`${response.sessionId ?? ''}:${response.params.context.id}`, { sessionId: response.sessionId, id: response.params.context.id });
        if (response.method === 'Runtime.executionContextDestroyed') contexts.delete(`${response.sessionId ?? ''}:${response.params.executionContextId}`);
        const request = pending.get(response.id);
        if (request) { pending.delete(response.id); response.error ? request.reject(new Error(response.error.message)) : request.resolve(response.result); }
      };
      return true;
    } catch { return false; }
  }, 'workbench CDP');
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const enter = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  };
  await send('Runtime.enable');
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  const mentorFrame = () => waitFor(async () => {
    for (const context of [...contexts.values()].reverse()) {
      try {
        const result = await send('Runtime.evaluate', { expression: '!!document.getElementById("answer") && document.documentElement.dataset.mentorReady === "true"', returnByValue: true, contextId: context.id }, context.sessionId);
        if (result.result?.value) return context;
      } catch {}
    }
    return false;
  }, 'Mentor webview frame');
  const mentorEvaluate = async expression => {
    const context = await mentorFrame();
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, contextId: context.id }, context.sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const checkpointEvaluate = async expression => {
    const context = await waitFor(async () => {
      for (const context of [...contexts.values()].reverse()) {
        try { const response = await send('Runtime.evaluate', { expression: '!!document.getElementById("checkpoint-root") && document.documentElement.dataset.checkpointReady === "true"', returnByValue: true, contextId: context.id }, context.sessionId); if (response.result?.value) return context; } catch {}
      }
      return false;
    }, 'checkpoint webview frame');
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, contextId: context.id }, context.sessionId);
    if (response.exceptionDetails) throw new Error('Checkpoint UI evaluation failed'); return response.result.value;
  };
  const handoffEvaluate = async expression => {
    const context = await waitFor(async () => {
      for (const context of [...contexts.values()].reverse()) {
        try { const response = await send('Runtime.evaluate', { expression: '!!document.getElementById("handoff-root") && document.documentElement.dataset.handoffReady === "true"', returnByValue: true, contextId: context.id }, context.sessionId); if (response.result?.value) return context; } catch {}
      }
      return false;
    }, 'handoff webview frame');
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, contextId: context.id }, context.sessionId);
    if (response.exceptionDetails) throw new Error('Handoff UI evaluation failed'); return response.result.value;
  };
  const webviewEvaluate = async (rootId, expression) => {
    const context = await waitFor(async () => {
      for (const entry of [...contexts.values()].reverse()) {
        try { const response = await send('Runtime.evaluate', { expression: `!!document.getElementById(${JSON.stringify(rootId)})`, returnByValue: true, contextId: entry.id }, entry.sessionId); if (response.result?.value) return entry; } catch {}
      }
      return false;
    }, `${rootId} webview frame`);
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, contextId: context.id }, context.sessionId);
    if (response.exceptionDetails) throw new Error(`${rootId} UI failed: ${response.exceptionDetails.text}`);
    return response.result.value;
  };
  const changesEvaluate = expression => webviewEvaluate('changes-root', expression);
  const atlasEvaluate = expression => webviewEvaluate('atlas-root', expression);
  const focusEvaluate = async expression => {
    const context = await waitFor(async () => {
      for (const entry of [...contexts.values()].reverse()) {
        try { const response = await send('Runtime.evaluate', { expression: '!!document.getElementById("focus-root")', returnByValue: true, contextId: entry.id }, entry.sessionId); if (response.result?.value) return entry; } catch {}
      }
      return false;
    }, 'Focus webview frame');
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, contextId: context.id }, context.sessionId);
    if (response.exceptionDetails) throw new Error(`Focus UI evaluation failed: ${response.exceptionDetails.text}`);
    return response.result.value;
  };
  let lastStep = '';
  try {
    while (true) {
      const step = await waitFor(async () => {
        try { const data = JSON.parse(await readFile(stepFile, 'utf8')); return data.step !== lastStep ? data : false; } catch { return false; }
      }, 'next host test UI step', 200000);
      lastStep = step.step;
      if (step.type === 'backend') {
        if (!backendControl) throw new Error('Backend test control unavailable');
        await backendControl(step.action); await writeFile(`${stepFile}.${step.step}.complete`, 'done');
        console.log(`MENTOR_BACKEND_RECOVERY_STEP: ${step.action}`); continue;
      }
      if (step.type === 'handoff') {
        if (step.action === 'preserved') {
          const values=await handoffEvaluate(`({question:document.getElementById('handoff-question')?.value,attemptedSteps:document.getElementById('handoff-attemptedSteps')?.value})`);
          if(values.question!==step.question||values.attemptedSteps!==step.attemptedSteps)throw new Error('Same-repository connectivity check discarded the draft');
          await writeFile(`${stepFile}.${step.step}.complete`,'done');continue;
        }
        if (step.action === 'offline-preview') {
          await handoffEvaluate(`document.getElementById('handoff-compose').requestSubmit()`);
          await waitFor(()=>handoffEvaluate(`document.getElementById('status')?.dataset.status==='error'`),'offline preview error');
          await writeFile(`${stepFile}.${step.step}.complete`,'done');continue;
        }

        if (step.action === 'native-open') {
          await evaluate(`Array.from(document.querySelectorAll('.pane-header')).filter(el => ['Map', 'Changes'].includes(el.innerText.trim()) && el.getAttribute('aria-expanded') !== 'false').forEach(el => el.click())`);
          await evaluate(`Array.from(document.querySelectorAll('.pane-header')).filter(el => el.innerText.trim() === 'Focus' && el.getAttribute('aria-expanded') === 'false').forEach(el => el.click())`);
          await focusEvaluate(`Array.from(document.querySelectorAll('.cm-section')).find(el => el.querySelector('summary')?.textContent.includes('Saved Handoffs')).open = true`);
          await waitFor(() => focusEvaluate(`Array.from(document.querySelectorAll('.cm-saved-row')).some(el => el.textContent.includes(${JSON.stringify(step.question)}))`), 'Focus Saved Handoffs entry');
          await focusEvaluate(`Array.from(document.querySelectorAll('.cm-saved-row')).find(el => el.textContent.includes(${JSON.stringify(step.question)})).querySelector('button').click()`);
        } else if (step.action === 'fill') {
          await waitFor(() => handoffEvaluate(`!!document.getElementById('handoff-compose')`), 'handoff compose form');
          if (!await handoffEvaluate(`['question','attemptedSteps','additionalContext'].every(name => document.getElementById('handoff-compose').elements.namedItem(name).value === '')`)) throw new Error('Handoff authored fields must start empty');
          if (!await handoffEvaluate(`document.body.innerText.includes('backend endpoint') && !document.querySelector('[data-action="save"]')`)) throw new Error('Destination must precede Preview and Save');
          await handoffEvaluate(`document.getElementById('handoff-question').value=${JSON.stringify(step.question)};document.getElementById('handoff-attemptedSteps').value=${JSON.stringify(step.attemptedSteps)}`);
        } else if (step.action === 'preview') {
          if (!await handoffEvaluate(`document.getElementById('handoff-question').value===${JSON.stringify(step.question)} && document.getElementById('handoff-attemptedSteps').value===${JSON.stringify(step.attemptedSteps)}`)) throw new Error('Unsent handoff fields were lost');
          await handoffEvaluate(`document.getElementById('handoff-compose').requestSubmit()`);
          await waitFor(() => handoffEvaluate(`!!document.getElementById('handoff-selection') && !!document.querySelector('pre.answer') && document.querySelector('[data-action="save"]')?.disabled===false`), 'backend canonical review');
          if (await handoffEvaluate(`Array.from(document.querySelectorAll('input[name="excerptReferenceIds"],input[name="includeCheckpointNotes"],input[name="includeDocumentation"]')).some(input=>input.checked)`)) throw new Error('Optional source context must default off');
        } else if (step.action === 'refine') {
          await handoffEvaluate(`const input=document.querySelector('input[name="referenceIds"][value="${step.removed}"]');input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));`);
          if (!await handoffEvaluate(`document.querySelector('[data-action="save"]').disabled`)) throw new Error('Dirty selection must disable Save');
          await handoffEvaluate(`document.getElementById('handoff-selection').requestSubmit()`);
          await waitFor(() => handoffEvaluate(`document.querySelector('[data-action="save"]')?.disabled===false && document.querySelector('input[name="referenceIds"][value="${step.removed}"]')?.checked===false`), 'rebuilt selection');
        } else if (step.action === 'cleared') {
          await waitFor(() => handoffEvaluate(`!document.querySelector('pre.answer') && !document.querySelector('[data-action="save"]') && !document.querySelector('[data-action="copy"]') && !document.body.innerText.includes(${JSON.stringify(step.question)})`), 'unconnected repository clears handoff content and actions');
        } else if (step.action === 'canonical') {
          if(step.theme)await waitFor(()=>handoffEvaluate(`document.body.classList.contains(${JSON.stringify(step.theme)})`),'actual high-contrast webview theme');
          if(step.narrow)await send('Emulation.setDeviceMetricsOverride',{width:960,height:900,deviceScaleFactor:1,mobile:false});
          if(!await handoffEvaluate(`!!document.querySelector('main h1') && Array.from(document.querySelectorAll('button')).every(button=>button.textContent.trim()||button.getAttribute('aria-label'))`))throw new Error('Unnamed handoff controls or missing landmark heading');
          if(step.narrow)await waitFor(()=>handoffEvaluate(`document.documentElement.scrollWidth<=window.innerWidth+2`),'narrow handoff avoids horizontal document overflow');

          await waitFor(() => handoffEvaluate(`document.querySelector('pre.answer')?.textContent===${JSON.stringify(step.markdown)}`), 'exact full canonical Markdown');
          const proof = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(screenshotFile.replace('focus.png', `${step.step}.png`), Buffer.from(proof.data, 'base64')); if(step.narrow)await send('Emulation.clearDeviceMetricsOverride');
        } else {
          const selector = `[data-action="${step.action}"]${step.referenceId ? `[data-reference="${step.referenceId}"]` : ''}`;
          await waitFor(() => handoffEvaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled===false`), 'enabled explicit handoff action');
          await handoffEvaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
          if (step.action === 'export') {
            await waitFor(() => evaluate(`!!document.querySelector('.quick-input-widget input') && document.querySelector('.quick-input-widget')?.style.display !== 'none'`), 'native simple Save dialog');
            await evaluate(`document.querySelector('.quick-input-widget input').focus();document.querySelector('.quick-input-widget input').select()`);
            await send('Input.insertText', { text: step.file.replaceAll('\\', '/') });
            await pause(400); await enter(); await pause(400);
            if (await evaluate(`document.querySelector('.quick-input-widget')?.style.display !== 'none'`)) {
              await enter();
            }
          }
          if (step.action === 'delete') {
            await waitFor(() => evaluate(`Array.from(document.querySelectorAll('.monaco-dialog-box .monaco-button')).some(el=>el.textContent.includes('Delete handoff'))`), 'handoff deletion confirmation');
            await evaluate(`Array.from(document.querySelectorAll('.monaco-dialog-box .monaco-button')).find(el=>el.textContent.includes('Delete handoff')).click()`);
          }
        }
        await writeFile(`${stepFile}.${step.step}.complete`, 'done'); console.log(`MENTOR_PHASE7_UI_PASS: ${step.step}`); continue;
      }
      if (step.type === 'checkpoint') {
        if (step.action === 'native-resume') {
          await evaluate(`Array.from(document.querySelectorAll('.pane-header')).filter(el => ['Map', 'Changes'].includes(el.innerText.trim()) && el.getAttribute('aria-expanded') !== 'false').forEach(el => el.click())`);
          await evaluate(`Array.from(document.querySelectorAll('.pane-header')).filter(el => el.innerText.trim() === 'Focus' && el.getAttribute('aria-expanded') === 'false').forEach(el => el.click())`);
          await focusEvaluate(`Array.from(document.querySelectorAll('.cm-section')).find(el => el.querySelector('summary')?.textContent.includes('Saved Tasks')).open = true`);
          await waitFor(() => focusEvaluate(`Array.from(document.querySelectorAll('.cm-saved-row')).some(el => el.textContent.includes(${JSON.stringify(step.title)}))`), 'Focus Saved Tasks entry');
          await focusEvaluate(`Array.from(document.querySelectorAll('.cm-saved-row')).find(el => el.textContent.includes(${JSON.stringify(step.title)})).querySelector('button').click()`);
          await pause(300);
          const nativeProof = await send('Page.captureScreenshot', { format: 'png' });
          await writeFile(stepFile.replace(/-steps\.json$/, '-native-resume.png'), Buffer.from(nativeProof.data, 'base64'));
        } else if (step.action === 'fill') {
          await waitFor(() => checkpointEvaluate(`!!document.getElementById('checkpoint-draft')`), 'checkpoint form');
          const empty = await checkpointEvaluate(`['taskTitle','discovery','unresolved','nextStep'].every(name => document.getElementById('checkpoint-draft').elements.namedItem(name).value === '')`);
          if (!empty) throw new Error('Checkpoint notes must begin empty');
          await checkpointEvaluate(`document.getElementById('checkpoint-taskTitle').value = ${JSON.stringify(step.title)}; document.getElementById('checkpoint-discovery').value = ${JSON.stringify(step.discovery)}; document.getElementById('checkpoint-unresolved').value = ${JSON.stringify(step.unresolved)}; document.getElementById('checkpoint-nextStep').value = ''`);
        } else if (step.action === 'preview') {
          const preserved = await checkpointEvaluate(`document.getElementById('checkpoint-discovery').value === ${JSON.stringify(step.discovery)} && document.getElementById('checkpoint-unresolved').value === ${JSON.stringify(step.unresolved)}`);
          if (!preserved) throw new Error('Refreshing the list erased an unsent checkpoint draft');
          await checkpointEvaluate(`document.getElementById('checkpoint-draft').requestSubmit()`);
          await waitFor(() => checkpointEvaluate(`document.body.innerText.includes('Review your checkpoint') && !!document.querySelector('[data-action="save"]')`), 'explicit checkpoint preview');
        } else if (step.action === 'save') {
          await checkpointEvaluate(`document.querySelector('[data-action="save"]').click()`);
        } else if (step.action === 'changes') {
          await waitFor(() => checkpointEvaluate(`!!document.querySelector('[data-action="changes"]')`), 'checkpoint exact-pair Review Changes');
          await checkpointEvaluate(`document.querySelector('[data-action="changes"]').click()`);
        } else if (['source', 'map', 'mentor'].includes(step.action)) {
          if (step.expectedViewId) await waitFor(() => checkpointEvaluate(`document.querySelector('[data-action="${step.action}"][data-reference="${step.referenceId}"]')?.dataset.view === ${JSON.stringify(step.expectedViewId)}`), 'current checkpoint action rendered');
          await checkpointEvaluate(`document.querySelector('[data-action="${step.action}"][data-reference="${step.referenceId}"]${step.componentId ? '[data-component="' + step.componentId + '"]' : ''}').click()`);
        } else if (step.action === 'delete') {
          if (step.expectedViewId) await waitFor(() => checkpointEvaluate(`document.querySelector('[data-action="delete"]')?.dataset.view === ${JSON.stringify(step.expectedViewId)}`), 'current checkpoint delete rendered');
          await checkpointEvaluate(`document.querySelector('[data-action="delete"]').click()`);
          await waitFor(() => evaluate(`Array.from(document.querySelectorAll('.monaco-dialog-box .monaco-button')).some(el => el.textContent.includes('Delete checkpoint'))`), 'explicit checkpoint deletion confirmation');
          await evaluate(`Array.from(document.querySelectorAll('.monaco-dialog-box .monaco-button')).find(el => el.textContent.includes('Delete checkpoint')).click()`);
        } else if (step.action === 'inspect') {
          await waitFor(() => checkpointEvaluate(`document.body.innerText.includes(${JSON.stringify(step.title)}) && document.body.innerText.includes(${JSON.stringify(step.discovery)}) && document.body.innerText.includes(${JSON.stringify(step.unresolved)})`), 'exact saved notes');
          const proof = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(screenshotFile.replace('focus.png', `${step.step}.png`), Buffer.from(proof.data, 'base64')); if(step.narrow)await send('Emulation.clearDeviceMetricsOverride');
        }
        await writeFile(`${stepFile}.${step.step}.complete`, 'done'); console.log(`MENTOR_PHASE6_UI_PASS: ${step.step}`); continue;
      }
      if (step.type === 'pr') {
        await evaluate(`Array.from(document.querySelectorAll('.pane-header')).filter(el => el.innerText.trim() === 'Changes' && el.getAttribute('aria-expanded') === 'false').forEach(el => el.click())`);
        if (step.action === 'select') {
          await waitFor(() => changesEvaluate(`Array.from(document.querySelectorAll('.cv-item')).some(el => el.textContent.startsWith('#106 '))`), 'remote PR 106 Webview card');
          await changesEvaluate(`Array.from(document.querySelectorAll('.cv-item')).find(el => el.textContent.startsWith('#106 ')).querySelector('button').click()`);
        }
        if (step.action === 'start') {
          await waitFor(() => changesEvaluate(`Array.from(document.querySelectorAll('.cv-actions button')).some(el => el.textContent === 'Analyze')`), 'explicit PR analysis button');
          await changesEvaluate(`Array.from(document.querySelectorAll('.cv-actions button')).find(el => el.textContent === 'Analyze').click()`);
        }
        if (step.action === 'diff-proof') { const proof = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(screenshotFile.replace('focus.png','pr-diff.png'), Buffer.from(proof.data,'base64')); }
        if (step.action === 'inspect') {
          await waitFor(() => changesEvaluate(`document.body.innerText.includes('Changed Files') && document.body.innerText.includes('Potential Impact')`), 'real PR comparison Webview sections');
          const proof = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(screenshotFile.replace('focus.png','pr-changes.png'), Buffer.from(proof.data,'base64'));
        }
        await writeFile(`${stepFile}.${step.step}.complete`, 'done'); console.log(`MENTOR_PHASE5_UI_PASS: ${step.step}`); continue;
      }
      if (step.type === 'atlas') {
        await waitFor(() => atlasEvaluate(`Array.from(document.querySelectorAll('.node title')).some(el => el.textContent===${JSON.stringify(step.component)})`), 'indexed Atlas SVG component');
        if (step.action === 'evidence') {
          await waitFor(() => atlasEvaluate(`document.querySelector('.relationship-evidence [data-action="source"]') !== null`), 'Atlas relationship evidence');
          await atlasEvaluate(`document.querySelector('.relationship-evidence [data-action="source"]').click()`);
        } else if (step.action === 'explore') {
          await waitFor(() => atlasEvaluate(`Array.from(document.querySelectorAll('.node title')).some(el => el.textContent===${JSON.stringify(step.related)})`), 'related Atlas SVG component');
          await atlasEvaluate(`Array.from(document.querySelectorAll('.node title')).find(el => el.textContent===${JSON.stringify(step.related)}).parentElement.dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
        } else {
          const proof = await send('Page.captureScreenshot', { format:'png' });
          await writeFile(screenshotFile.replace('focus.png','atlas.png'), Buffer.from(proof.data,'base64'));
        }
        await writeFile(`${stepFile}.${step.step}.complete`, 'done'); console.log(`MENTOR_PHASE4_UI_PASS: ${step.step}`); continue;
      }
      if (step.type === 'mentor') {
        await waitFor(() => mentorEvaluate(`document.body.innerText.includes('Facts-only explanation') && document.body.innerText.includes(${JSON.stringify(step.component ?? 'greet')})`), 'grounded Mentor response');
        if (step.expectedAnswer) await waitFor(() => mentorEvaluate(`document.getElementById('follow-up')?.dataset.answer === ${JSON.stringify(step.expectedAnswer)}`), 'current answer rendered');
        if (step.action === 'previous' || step.action === 'latest') await waitFor(() => mentorEvaluate(`document.querySelector('[data-action="${step.action}"]')?.disabled === false`), 'enabled answer history action');
        if (step.action === 'citation') await mentorEvaluate(`document.querySelector('[data-action="citation"][data-reference="${step.referenceId}"]').click()`);
        if (step.action === 'followup') await mentorEvaluate(`document.getElementById('question').value = ${JSON.stringify(step.question)}; document.getElementById('follow-up').requestSubmit()`);
        if (step.action === 'previous' || step.action === 'latest') await mentorEvaluate(`document.querySelector('[data-action="${step.action}"]').click()`);
        if (step.action === 'related') await mentorEvaluate(`document.querySelector('[data-action="related"]').click()`);
        if (step.action === 'inspect') {
          await mentorEvaluate(`document.getElementById('evidence-title').scrollIntoView({block:'center'})`);
          const proof = await send('Page.captureScreenshot', { format: 'png' });
          await writeFile(screenshotFile.replace('focus.png', 'mentor-indexed.png'), Buffer.from(proof.data, 'base64'));
        }
        await writeFile(`${stepFile}.${step.step}.complete`, 'done');
        console.log(`MENTOR_PHASE3_UI_PASS: ${step.step}`);
        continue;
      }
      if (step.type === 'indexed-ack') {
        // Explicit Explain Selection already opts into pinned indexed evidence.
        // The scope warning is inline; there is deliberately no blocking modal.
        await writeFile(`${stepFile}.${step.step}.complete`, 'done');
        console.log(`MENTOR_PHASE3_UI_PASS: ${step.step} (no modal)`); continue;
      }
      if (step.type === 'move-source-connect') {
        await waitFor(() => evaluate(`Array.from(document.querySelectorAll('.monaco-dialog-box .monaco-button')).some(button => button.textContent.includes('Connect & open source'))`), 'one-click snapshot connection');
        await evaluate(`Array.from(document.querySelectorAll('.monaco-dialog-box .monaco-button')).find(button => button.textContent.includes('Connect & open source')).click()`);
        console.log('MENTOR_MOVE_SOURCE_CONNECT_PASS: no snapshot input; confirmed existing evidence'); continue;
      }
      if (step.step === 'done') {
        // Let native tree refresh complete, and collapse unused panes as a user
        // would so virtualized repository rows are visible for the UI assertion.
        await evaluate(`Array.from(document.querySelectorAll('.pane-header')).filter(el => ['Map', 'Changes'].includes(el.innerText.trim()) && el.getAttribute('aria-expanded') !== 'false').forEach(el => el.click())`);
        await evaluate(`Array.from(document.querySelectorAll('.pane-header')).filter(el => el.innerText.trim() === 'Focus' && el.getAttribute('aria-expanded') === 'false').forEach(el => el.click())`);
        if (step.expectedSnapshot) await waitFor(async () => await focusEvaluate(`document.getElementById('focus-root').textContent.includes(${JSON.stringify(step.expectedSnapshot)})`), 'Focus snapshot ID');
        if (step.expectedText) await waitFor(async () => await focusEvaluate(`document.getElementById('focus-root').textContent.includes(${JSON.stringify(step.expectedText)})`), 'Focus visible status');
        break;
      }
      if (step.folderName) {
        await waitFor(() => evaluate(`Array.from(document.querySelectorAll('.quick-input-list .monaco-list-row')).some(el => el.innerText.includes(${JSON.stringify(step.folderName)}))`), 'workspace folder picker');
        await evaluate(`Array.from(document.querySelectorAll('.quick-input-list .monaco-list-row')).find(el => el.innerText.includes(${JSON.stringify(step.folderName)})).click()`);
        await enter();
      }
      await waitFor(() => evaluate(`document.querySelector('.quick-input-title')?.textContent.includes('Connect Repository') && !!document.querySelector('.quick-input-widget input')`), 'snapshot input');
      const id = snapshots[step.snapshotIndex].snapshotId;
      await evaluate(`document.querySelector('.quick-input-widget input').focus()`);
      await send('Input.insertText', { text: id });
      console.log(`MENTOR_UI_INPUT: ${step.step}`);
      await enter();
      await waitFor(() => evaluate(`Array.from(document.querySelectorAll('.monaco-dialog-box .monaco-button')).some(el => el.textContent.includes(${JSON.stringify(step.confirm)}))`), 'explicit connection confirmation');
      console.log(`MENTOR_UI_CONFIRM: ${step.step}`);
      await evaluate(`Array.from(document.querySelectorAll('.monaco-dialog-box .monaco-button')).find(el => el.textContent.includes(${JSON.stringify(step.confirm)})).click()`);
      console.log(`MENTOR_UI_PASS: ${step.step}, picker=${Boolean(step.folderName)}, snapshot input and confirmation`);
    }
    await waitFor(() => evaluate(`document.body.innerText.includes('Codebase Mentor')`), 'Mentor sidebar');
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(screenshotFile, Buffer.from(screenshot.data, 'base64'));
    await writeFile(`${stepFile}.complete`, 'done');
  } catch (error) {
    try {
      console.log('MENTOR_UI_FAILURE_DOM:', await evaluate('document.body.innerText.slice(-4000)'));
      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(screenshotFile, Buffer.from(screenshot.data, 'base64'));
    } catch {}
    throw error;
  } finally {
    socket.close();
    for (const request of pending.values()) request.reject(new Error('UI driver closed'));
    pending.clear();
  }
}
