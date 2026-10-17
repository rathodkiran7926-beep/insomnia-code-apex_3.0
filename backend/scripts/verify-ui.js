// Optional Windows browser smoke check. Run verify:http first to create real snapshot evidence.
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const browser = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
assert(browser, "A local Chrome or Edge installation is required");
const db = new DatabaseSync(root + "/data/http-verification.sqlite", {
  readOnly: true,
});
const job = db
  .prepare(
    "SELECT * FROM analysis_jobs WHERE status='complete' ORDER BY created_at DESC LIMIT 1",
  )
  .get();
db.close();
assert(job, "Run npm run verify:http first");
const server = spawn(process.execPath, ["src/server.js"], {
  cwd: root,
  windowsHide: true,
  env: {
    ...process.env,
    PORT: "3002",
    DATABASE_PATH: root + "/data/http-verification.sqlite",
  },
  stdio: "ignore",
});
const chrome = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-port=9223",
    `--user-data-dir=${root}/data/browser-profile`,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
const loadingJobId = `ui-loading-check-${Date.now()}`;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if (
        (await fetch("http://127.0.0.1:3002/api/health")).ok &&
        (await fetch("http://127.0.0.1:9223/json/version")).ok
      )
        break;
    } catch {}
    await pause(100);
  }
  const target = await (
    await fetch(
      "http://127.0.0.1:9223/json/new?http://127.0.0.1:3002/%23/repository",
      { method: "PUT" },
    )
  ).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let sequence = 0;
  const waiting = new Map(),
    errors = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.text);
    const pending = waiting.get(message.id);
    if (pending) {
      waiting.delete(message.id);
      message.error
        ? pending.reject(new Error(message.error.message))
        : pending.resolve(message.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      waiting.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = (expression) =>
    evaluate(
      `new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(${expression})return resolve(true);if(Date.now()-start>12000)return reject(new Error('UI condition timeout'));setTimeout(tick,100)};tick()})`,
    );
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor('document.readyState === "complete"');
  const progressDb = new DatabaseSync(root + "/data/http-verification.sqlite");
  progressDb.prepare('INSERT INTO analysis_jobs VALUES (?,?,?,?,?,?)').run(loadingJobId, 'running', 60, 'Parsing sources and resolving compiler symbols', null, new Date().toISOString());
  progressDb.close();
  await evaluate(`localStorage.setItem('mentor-analysis-job', ${JSON.stringify(loadingJobId)})`);
  await send('Page.reload');
  await waitFor('document.querySelector(".analysis-progress-track")?.getAttribute("aria-valuenow") === "60"');
  assert(await evaluate('document.querySelector(".analysis-progress-copy h2").textContent.includes("Connecting the pieces")'));
  assert.equal(await evaluate('document.querySelectorAll(".analysis-progress-stages li.complete").length'), 2);
  assert(await evaluate('getComputedStyle(document.querySelector(".analysis-scan-file > span")).animationName !== "none"'));
  await pause(800);
  const loadingScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(root + '/data/ui-loading-verification.png', Buffer.from(loadingScreenshot.data, 'base64'));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".analysis-scan-file > span")).animationName'), 'none');
  await send('Emulation.setEmulatedMedia', { features: [] });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await evaluate(
    `localStorage.setItem('mentor-analysis-job', ${JSON.stringify(job.id)})`,
  );
  await send("Page.reload");
  await waitFor('document.querySelector(".system-architecture-node")');
  assert(await evaluate(`document.querySelector('[data-diagram="system"]').getAttribute('aria-pressed')==='true'`));
  assert(await evaluate(`!document.querySelector('.analysis-details')`));
  await evaluate(`document.querySelector('.system-architecture-node').closest('.react-flow__node').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await waitFor('document.querySelector(".system-component-list button")');
  await evaluate(`document.querySelector('.system-intro').scrollIntoView({block:'start'})`);
  await pause(400);
  const architectureScreenshot=await send('Page.captureScreenshot',{format:'png'});
  writeFileSync(root+'/data/ui-system-architecture.png',Buffer.from(architectureScreenshot.data,'base64'));
  await evaluate(`document.querySelector('[data-diagram="request"]').click()`);
  await waitFor('document.querySelector(".system-route-selector")');
  assert(await evaluate('document.querySelectorAll(".system-architecture-node").length > 0'));
  await evaluate(`document.querySelector('[data-diagram="overview"]').click()`);
  await waitFor('document.querySelectorAll(".react-flow__node-default").length > 0');
  assert(
    await evaluate(
      `document.querySelector('.analysis-snapshot')?.dataset.snapshotId === ${JSON.stringify(job.snapshot_id)}`,
    ),
  );
  const nodeCount = await evaluate(
    'document.querySelectorAll(".react-flow__node-default").length',
  );
  assert(await evaluate(`!document.querySelector('.global-search') && !document.querySelector('.topbar-actions') && !document.querySelector('.next-step-card') && !document.querySelector('.workspace-switcher')`));
  assert(await evaluate(`document.querySelectorAll('nav[aria-label="Main navigation"] a').length > 3`));
  assert(await evaluate(`!document.querySelector('.react-flow__minimap') && !document.querySelector('.react-flow__controls-interactive')`));
  await evaluate(`const viewSelect=document.querySelector('.analysis-toolbar select');viewSelect.value='overview';viewSelect.dispatchEvent(new Event('change',{bubbles:true}))`);
  await waitFor('document.querySelector(".analysis-folder-node")');
  await evaluate(`document.querySelector('.analysis-folder-node').closest('.react-flow__node').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await waitFor('document.querySelector(".analysis-folder-label")');
  assert.notEqual(await evaluate(`document.querySelector('[aria-label="Filter by folder"]').value`), 'all');
  await evaluate(
    `document.querySelector('.react-flow__node-default').dispatchEvent(new MouseEvent('click',{bubbles:true}))`,
  );
  await waitFor('document.querySelector(".analysis-details pre")');
  assert(await evaluate('document.querySelectorAll(".repository-source-number").length > 0'));
  assert(await evaluate('document.querySelectorAll(".repository-source .token").length > 0'));
  await evaluate(`document.querySelector('[aria-label="Wrap long code lines"]').click()`);
  await waitFor(`document.querySelector('.analysis-details .repository-source').classList.contains('source-wrapped')`);
  // Clipboard writes are stubbed only in this isolated browser verification session.
  await evaluate(`window.__copiedRepositorySource='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedRepositorySource=text}}});document.querySelector('[aria-label="Copy source excerpt"]').click()`);
  await waitFor(`document.querySelector('.repository-source-feedback')?.textContent.includes('copied')`);
  assert(await evaluate('window.__copiedRepositorySource.length > 0'));
  await evaluate(`document.querySelector('[aria-label="Expand source code"]').click()`);
  await waitFor(`document.querySelector('[role="dialog"] .source-expanded')`);
  assert(await evaluate('document.querySelector(".source-expanded .repository-source-number").textContent === document.querySelector(".analysis-details .repository-source-number").textContent'));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await waitFor(`!document.querySelector('[role="dialog"]')`);
  await evaluate(`document.querySelector('.analysis-details').scrollIntoView({block:'start'})`);
  const sourceScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(root + '/data/ui-source-verification.png', Buffer.from(sourceScreenshot.data, 'base64'));
  assert(
    await evaluate(
      'document.querySelector(".analysis-details a").href.includes("/blob/")',
    ),
  );
  await evaluate(
    `Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent==='documentation').click()`,
  );
  await waitFor(`document.querySelector('.repository-docs')?.dataset.snapshotId === ${JSON.stringify(job.snapshot_id)}`);
  assert.equal(await evaluate('document.querySelectorAll(".doc-scope-options button").length'), 3);
  assert.equal(await evaluate('document.querySelectorAll(".doc-reader-toolbar button").length'), 1);
  assert.equal(await evaluate('document.querySelectorAll(".doc-reader-footer button").length'), 0);
  await evaluate(`document.querySelector('[data-scope="backend"]').click()`);
  await waitFor(`document.querySelector('[data-scope="backend"]').getAttribute('aria-pressed') === 'true'`);
  assert(await evaluate(`document.querySelector('#doc-overview').textContent.includes('Backend, at a glance')`));
  await evaluate(`document.querySelector('[data-scope="frontend"]').click()`);
  await waitFor(`document.querySelector('#doc-overview').textContent.includes('No frontend code identified')`);
  await evaluate(`document.querySelector('[data-scope="all"]').click()`);
  await evaluate(`document.querySelector('.doc-intro').scrollIntoView({block:'start'})`);
  await pause(400);
  const docsScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(root + '/data/ui-documentation-verification.png', Buffer.from(docsScreenshot.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await evaluate(
    `document.querySelector('[data-view="report"]').click()`,
  );
  await waitFor('document.querySelector(".analysis-report")');
  await evaluate(
    `Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent==='architecture').click()`,
  );
  await pause(500);
  await evaluate(`document.querySelector('.analysis-map-heading').scrollIntoView({block:'start'})`);
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    root + "/data/ui-verification.png",
    Buffer.from(screenshot.data, "base64"),
  );
  assert.deepEqual(errors, []);
  await evaluate(`location.hash='/workspace'`);
  await waitFor('document.querySelector(".global-search") && document.querySelector(".next-step-card")');
  assert(await evaluate('Boolean(document.querySelector(".topbar-actions"))'));
  console.log(
    JSON.stringify(
      {
        nodeCount,
        snapshotId: job.snapshot_id,
        checks: [
          "restored real snapshot",
          "full-width horizontal backend system is the initial view",
          "system sections and selected-route diagrams drill down to code",
          "repository-only cleanup keeps navigation and other workspace controls",
          "single documentation download and simplified graph controls",
          "real job progress drives loader stages",
          "animated loading state and reduced motion",
          "mobile loading layout without horizontal overflow",
          "rendered graph nodes",
          "folder overview opens filtered component details",
          "clickable component details",
          "syntax highlighting and source line numbers",
          "source wrapping and copy action",
          "expanded source dialog and Escape dismissal",
          "commit source link",
          "shared documentation snapshot",
          "frontend/backend documentation selection and honest empty state",
          "mobile documentation layout without horizontal overflow",
          "report tab",
          "no uncaught browser exceptions",
        ],
      },
      null,
      2,
    ),
  );
  await send("Browser.close").catch(() => {});
} finally {
  const cleanupDb = new DatabaseSync(root + '/data/http-verification.sqlite');
  cleanupDb.prepare('DELETE FROM analysis_jobs WHERE id=?').run(loadingJobId);
  cleanupDb.close();
  socket?.close();
  chrome.kill();
  server.kill();
}
