import { readFile, writeFile } from 'node:fs/promises';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** CDP controls only the isolated Extension Development Host workbench. */
export async function driveWorkbench(port, stepFile, snapshots, screenshotFile) {
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
  let lastStep = '';
  try {
    while (true) {
      const step = await waitFor(async () => {
        try { const data = JSON.parse(await readFile(stepFile, 'utf8')); return data.step !== lastStep ? data : false; } catch { return false; }
      }, 'next host test UI step', 40000);
      lastStep = step.step;
      if (step.type === 'mentor') {
        await waitFor(() => mentorEvaluate(`document.body.innerText.includes('Facts-only explanation') && document.body.innerText.includes(${JSON.stringify(step.component ?? 'greet')})`), 'grounded Mentor response');
        if (step.expectedAnswer) await waitFor(() => mentorEvaluate(`document.getElementById('follow-up')?.dataset.answer === ${JSON.stringify(step.expectedAnswer)}`), 'current answer rendered');
        if (step.action === 'previous' || step.action === 'latest') await waitFor(() => mentorEvaluate(`document.querySelector('[data-action="${step.action}"]')?.disabled === false`), 'enabled answer history action');
        if (step.action === 'citation') await mentorEvaluate(`document.querySelector('[data-action="citation"][data-reference="${step.referenceId}"]').click()`);
        if (step.action === 'followup') await mentorEvaluate(`document.getElementById('question').value = ${JSON.stringify(step.question)}; document.getElementById('follow-up').requestSubmit()`);
        if (step.action === 'previous' || step.action === 'latest') await mentorEvaluate(`document.querySelector('[data-action="${step.action}"]').click()`);
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
        await waitFor(() => evaluate(`Array.from(document.querySelectorAll('.monaco-dialog-box .monaco-button')).some(el => el.textContent.includes('Explain indexed snapshot'))`), 'indexed-source acknowledgement');
        await evaluate(`Array.from(document.querySelectorAll('.monaco-dialog-box .monaco-button')).find(el => el.textContent.includes('Explain indexed snapshot')).click()`);
        await writeFile(`${stepFile}.${step.step}.complete`, 'done');
        console.log(`MENTOR_PHASE3_UI_PASS: ${step.step}`);
        continue;
      }
      if (step.step === 'done') {
        // Let native tree refresh complete, and collapse unused panes as a user
        // would so virtualized repository rows are visible for the UI assertion.
        await evaluate(`Array.from(document.querySelectorAll('.pane-header')).filter(el => ['Map', 'Changes'].includes(el.innerText.trim()) && el.getAttribute('aria-expanded') !== 'false').forEach(el => el.click())`);
        if (step.expectedSnapshot) await waitFor(() => evaluate(`document.body.innerText.includes(${JSON.stringify(step.expectedSnapshot)})`), 'rendered snapshot ID');
        if (step.expectedText) await waitFor(() => evaluate(`document.body.innerText.includes(${JSON.stringify(step.expectedText)})`), 'rendered revision status');
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
