import { spawn, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url)),
  run = randomUUID();
const origin = "http://127.0.0.1:3010";
const environment = {
  ...process.env,
  PORT: "3010",
  DATABASE_PATH: `${root}/data/practice-ui-${run}.sqlite`,
  LLM_API_KEY: "",
  PRACTICE_TEST_PROVIDER: "1",
  ELEVENLABS_API_KEY: "",
};
const browser = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
assert(browser, "Chrome or Edge is required.");
const server = spawn(process.execPath, ["scripts/practice-test-server.js"], {
  cwd: root,
  windowsHide: true,
  stdio: "ignore",
  env: environment,
});
const chrome = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-port=9230",
    `--user-data-dir=${root}/data/practice-browser-${run}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket, evaluate, send;
const errors = [];
try {
  for (let i = 0; i < 100; i++) {
    try {
      if (
        (await fetch(origin + "/api/health")).ok &&
        (await fetch("http://127.0.0.1:9230/json/version")).ok
      )
        break;
    } catch {}
    await pause(100);
  }
  const target = await (
    await fetch(`http://127.0.0.1:9230/json/new?${origin}/%23/practice`, {
      method: "PUT",
    })
  ).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const waiting = new Map();
  let sequence = 0;
  socket.onmessage = (event) => {
    const m = JSON.parse(event.data);
    if (m.method === "Runtime.exceptionThrown")
      errors.push(
        m.params.exceptionDetails.exception?.description ||
          m.params.exceptionDetails.text,
      );
    const task = waiting.get(m.id);
    if (task) {
      waiting.delete(m.id);
      m.error
        ? task.reject(new Error(m.error.message))
        : task.resolve(m.result);
    }
  };
  send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence,
        timer = setTimeout(
          () => reject(new Error("CDP timeout: " + method)),
          15000,
        );
      waiting.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const wait = async (expression, message) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await pause(100);
    }
    throw new Error(message);
  };
  const click = async (text) =>
    assert(
      await evaluate(
        `(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(text)}||e.getAttribute('aria-label')===${JSON.stringify(text)});if(!e||e.disabled)return false;e.click();return true;})()`,
      ),
      "Missing action: " + text,
    );
  const fill = async (selector, value) =>
    assert(
      await evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
      ),
    );
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await wait(`document.querySelector('.practice-feature-tabs')`, 'Practice tabs missing');
  assert(await evaluate(`Boolean(document.body.innerText.includes('Guided sample') && document.querySelector('.practice-layout:not([hidden])'))`));
  await click('Repository practice');
  await wait(`document.body.innerText.includes('Analyze a repository on the Repository page')`, 'Missing-repository state missing');
  await evaluate("location.hash='/agent-context'");
  await wait("document.querySelector('.agent-vscode-snapshot')", 'VS Code snapshot card missing');
  assert(!await evaluate("Boolean(document.querySelector('#vscode-snapshot-id'))"), 'No repository should not show a fabricated snapshot ID');
  await evaluate("location.hash='/practice'");
  await wait("document.querySelector('.practice-feature-tabs')", 'Practice did not reopen');
  await evaluate(`localStorage.setItem('mentor-analysis-job','practice-ui-job')`);
  await send('Page.reload');
  await wait(`document.querySelector('.practice-feature-tabs')`, 'Practice reload failed');
  await click('Repository practice');
  await wait(`document.querySelectorAll('.practice-roadmap-task').length===3`, 'Source-based roadmap did not load');
  assert(await evaluate(`document.querySelector('.practice-task-citations a').href.includes('/blob/'+ 'd'.repeat(40))`), 'Source citation is not pinned');
  const initialCode=await evaluate(`document.querySelector('#repository-practice-code').value`);
  await fill('#repository-practice-code',initialCode+'\n// learning draft');
  await fill('#repository-practice-reflection','I documented the intended input behavior.');
  await click('Check syntax and save');
  await wait(`document.querySelector('.practice-result.success')`, 'Syntax-only attempt was not saved');
  assert(await evaluate(`document.body.innerText.includes('repository/runtime tests executed: no') && document.querySelectorAll('.practice-attempt-row').length===1`));
  await fill('#repository-practice-code',initialCode+'\nexport function {');
  await click('Check syntax and save');
  await wait(`document.querySelector('.practice-result:not(.success)')`, 'Invalid syntax was not reported');
  await click('Quick quizzes');
  await wait(`document.querySelectorAll('.practice-quiz-option').length===4`, 'Quiz did not load');
  for(let index=0;index<5;index++) {
    await evaluate(`document.querySelector('.practice-quiz-option').click()`);
    await click('Check answer');
    await wait(`document.querySelector('.practice-quiz-question .practice-result')`, 'Quiz feedback missing');
    await click(index===4?'Finish review':'Continue');
  }
  await wait(`document.body.innerText.includes('Review complete')`, 'Quiz completion missing');
  await evaluate(`(()=>{const select=document.querySelector('.practice-difficulty select');select.value='advanced';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelectorAll('.practice-quiz-option').length===4`, 'Advanced questions missing');
  await pause(100);
  await send('Page.reload');
  await wait(`document.querySelector('.practice-difficulty select')?.value==='advanced'`, 'Difficulty preference lost');
  await click('Quick quizzes');
  await wait(`document.querySelectorAll('.practice-quiz-option').length===4`, 'Saved level quiz failed');
  const desktop=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(root+'/data/practice-desktop.png',Buffer.from(desktop.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await pause(200);
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth+2`),'Mobile quiz overflow');
  await click('Repository practice');
  await wait(`document.querySelectorAll('.practice-roadmap-task').length===3`,'Mobile roadmap missing');
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth+2`),'Mobile repository practice overflow');
  const mobile=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(root+'/data/practice-mobile.png',Buffer.from(mobile.data,'base64'));
  const latest = await (await fetch(origin+'/api/snapshots/latest?repository='+encodeURIComponent('https://github.com/test/practice-checkout'))).json();
  assert(latest.snapshotId && latest.commit==='d'.repeat(40), 'Merged latest snapshot endpoint failed');
  await evaluate(`location.hash='/agent-context'`);
  await wait(`document.querySelector('.context-controls textarea')`, 'Merged Agent Context page missing');
  await wait("document.querySelector('#vscode-snapshot-id')", 'Actual VS Code snapshot ID missing');
  assert.equal(await evaluate("document.querySelector('#vscode-snapshot-id').textContent"),latest.snapshotId,'VS Code must use the selected repository snapshot');
  await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedSnapshotId=value;}}})");
  await click('Copy snapshot ID');
  await wait("document.querySelector('.agent-snapshot-copy').textContent.includes('Copied')", 'Copy feedback missing');
  assert.equal(await evaluate('window.__copiedSnapshotId'),latest.snapshotId,'Copy action used the wrong snapshot');
  await evaluate("navigator.clipboard.writeText=async()=>{throw new Error('Clipboard unavailable')}");
  await click('Copy snapshot ID');
  await wait("document.querySelector('.agent-vscode-snapshot [role=alert]')?.textContent.includes('Select and copy')", 'Manual copy fallback missing');
  await fill('.context-controls textarea','normalizeEmail');
  await click('Retrieve relevant context');
  await wait(`document.querySelector('.context-output')?.value.includes('normalizeEmail')`, 'Merged bridge did not retrieve actual source');
  await click('MCP request');
  assert(await evaluate(`document.querySelector('.context-output').value.includes('get_task_context')`), 'MCP export missing');
  await click('Open prepared context demo');
  await wait(`document.querySelector('[aria-label="Context snapshot"]')`, 'Original prepared context feature was lost');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('Browser checks passed: guided sample, repository task generation through shared provider config, pinned citations, syntax-only saved attempts/history, quiz grading/completion, difficulty persistence, mobile layout, latest snapshot lookup, Agent Context Bridge retrieval/MCP export and preserved context demo. Isolated provider responses; no analyzed code executed.');
} catch (error) {
  if (evaluate)
    console.error(
      await evaluate("document.body.innerText.slice(0,4500)").catch(
        () => "Browser unavailable",
      ),
    );
  throw error;
} finally {
  socket?.close();
  chrome.kill();
  server.kill();
}
