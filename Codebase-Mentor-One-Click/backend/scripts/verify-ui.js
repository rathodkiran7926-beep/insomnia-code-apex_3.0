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
  progressDb
    .prepare("INSERT INTO analysis_jobs VALUES (?,?,?,?,?,?)")
    .run(
      loadingJobId,
      "running",
      60,
      "Parsing sources and resolving compiler symbols",
      null,
      new Date().toISOString(),
    );
  progressDb.close();
  await evaluate(
    `localStorage.setItem('mentor-analysis-job', ${JSON.stringify(loadingJobId)})`,
  );
  await send("Page.reload");
  await waitFor(
    'document.querySelector(".analysis-progress-track")?.getAttribute("aria-valuenow") === "60"',
  );
  assert(
    await evaluate(
      'document.querySelector(".analysis-progress-copy h2").textContent.includes("Connecting the pieces")',
    ),
  );
  assert.equal(
    await evaluate(
      'document.querySelectorAll(".analysis-progress-stages li.complete").length',
    ),
    2,
  );
  assert(
    await evaluate(
      'getComputedStyle(document.querySelector(".analysis-scan-file > span")).animationName !== "none"',
    ),
  );
  await pause(800);
  const loadingScreenshot = await send("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(
    root + "/data/ui-loading-verification.png",
    Buffer.from(loadingScreenshot.data, "base64"),
  );
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector(".analysis-scan-file > span")).animationName',
    ),
    "none",
  );
  await send("Emulation.setEmulatedMedia", { features: [] });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert(
    await evaluate("document.documentElement.scrollWidth <= window.innerWidth"),
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(
    `localStorage.setItem('mentor-analysis-job', ${JSON.stringify(job.id)})`,
  );
  await send("Page.reload");
  await waitFor('document.querySelector(".system-architecture-node")');
  assert(
    await evaluate(
      `document.querySelector('[data-diagram="system"]').getAttribute('aria-pressed')==='true'`,
    ),
  );
  assert(await evaluate(`!document.querySelector('.analysis-details')`));
  await evaluate(
    `document.querySelector('.system-architecture-node').closest('.react-flow__node').dispatchEvent(new MouseEvent('click',{bubbles:true}))`,
  );
  await waitFor('document.querySelector(".system-component-list button")');
  await evaluate(
    `document.querySelector('.system-intro').scrollIntoView({block:'start'})`,
  );
  await pause(400);
  const architectureScreenshot = await send("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(
    root + "/data/ui-system-architecture.png",
    Buffer.from(architectureScreenshot.data, "base64"),
  );
  await evaluate(`document.querySelector('[data-diagram="request"]').click()`);
  await waitFor('document.querySelector(".system-route-selector")');
  assert(
    await evaluate(
      'document.querySelectorAll(".system-architecture-node").length > 0',
    ),
  );
  await evaluate(`document.querySelector('[data-diagram="overview"]').click()`);
  await waitFor(
    'document.querySelectorAll(".react-flow__node-default").length > 0',
  );
  assert(
    await evaluate(
      `document.querySelector('.analysis-snapshot')?.dataset.snapshotId === ${JSON.stringify(job.snapshot_id)}`,
    ),
  );
  const nodeCount = await evaluate(
    'document.querySelectorAll(".react-flow__node-default").length',
  );
  assert(
    await evaluate(
      `!document.querySelector('.global-search') && !document.querySelector('.topbar-actions') && !document.querySelector('.next-step-card') && !document.querySelector('.workspace-switcher')`,
    ),
  );
  assert(
    await evaluate(
      `document.querySelectorAll('nav[aria-label="Main navigation"] a').length > 3`,
    ),
  );
  assert(
    await evaluate(
      `!document.querySelector('.react-flow__minimap') && !document.querySelector('.react-flow__controls-interactive')`,
    ),
  );
  await evaluate(
    `const viewSelect=document.querySelector('.analysis-toolbar select');viewSelect.value='overview';viewSelect.dispatchEvent(new Event('change',{bubbles:true}))`,
  );
  await waitFor('document.querySelector(".analysis-folder-node")');
  await evaluate(
    `document.querySelector('.analysis-folder-node').closest('.react-flow__node').dispatchEvent(new MouseEvent('click',{bubbles:true}))`,
  );
  await waitFor('document.querySelector(".analysis-folder-label")');
  assert.notEqual(
    await evaluate(
      `document.querySelector('[aria-label="Filter by folder"]').value`,
    ),
    "all",
  );
  await evaluate(
    `document.querySelector('.react-flow__node-default').dispatchEvent(new MouseEvent('click',{bubbles:true}))`,
  );
  await waitFor('document.querySelector(".analysis-details pre")');
  assert(
    await evaluate(
      'document.querySelectorAll(".repository-source-number").length > 0',
    ),
  );
  await waitFor(
    "document.querySelector('.analysis-details .repository-source')?.dataset.sourceComplete === 'true'",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.analysis-details .repository-source-number').textContent",
    ),
    "1",
  );
  assert(
    await evaluate(
      "document.querySelectorAll('.analysis-details .repository-source-line:not(.source-focused-line)').length > 0 && document.querySelectorAll('.analysis-details .source-focused-line').length > 0",
    ),
  );
  assert(
    await evaluate(
      "getComputedStyle(document.querySelector('.analysis-details .repository-source')).backgroundColor === 'rgb(252, 251, 255)'",
    ),
  );
  assert(
    await evaluate(
      'document.querySelectorAll(".repository-source .token").length > 0',
    ),
  );
  await evaluate(
    `document.querySelector('[aria-label="Wrap long code lines"]').click()`,
  );
  await waitFor(
    `document.querySelector('.analysis-details .repository-source').classList.contains('source-wrapped')`,
  );
  // Clipboard writes are stubbed only in this isolated browser verification session.
  await evaluate(
    `window.__copiedRepositorySource='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedRepositorySource=text}}});document.querySelector('[aria-label="Copy source code"]').click()`,
  );
  await waitFor(
    `document.querySelector('.repository-source-feedback')?.textContent.includes('copied')`,
  );
  assert(await evaluate("window.__copiedRepositorySource.length > 0"));
  await evaluate(
    `document.querySelector('[aria-label="Expand source code"]').click()`,
  );
  await waitFor(`document.querySelector('[role="dialog"] .source-expanded')`);
  assert(
    await evaluate(
      'document.querySelector(".source-expanded .repository-source-number").textContent === document.querySelector(".analysis-details .repository-source-number").textContent',
    ),
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
  });
  await waitFor(`!document.querySelector('[role="dialog"]')`);
  await evaluate(
    `document.querySelector('.analysis-details').scrollIntoView({block:'start'})`,
  );
  const resizeBefore = await evaluate(
    `({share:Number(document.querySelector('.analysis-panel-divider').getAttribute('aria-valuenow')),width:document.querySelector('.analysis-details').getBoundingClientRect().width})`,
  );
  const dividerPoint = await evaluate(
    `{const r=document.querySelector('.analysis-panel-divider').getBoundingClientRect();({x:r.x+r.width/2,y:Math.max(100,r.top+60)})}`,
  );
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...dividerPoint,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...dividerPoint,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await pause(70);
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: dividerPoint.x + 80,
    y: dividerPoint.y,
    button: "left",
    buttons: 1,
  });
  await pause(70);
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: dividerPoint.x + 80,
    y: dividerPoint.y,
    button: "left",
    clickCount: 1,
  });
  await waitFor(
    `Number(document.querySelector('.analysis-panel-divider').getAttribute('aria-valuenow')) > ${resizeBefore.share}`,
  );
  assert(
    await evaluate(
      `document.querySelector('.analysis-details').getBoundingClientRect().width < ${resizeBefore.width}`,
    ),
  );
  const resizedShare = await evaluate(
    "Number(document.querySelector('.analysis-panel-divider').getAttribute('aria-valuenow'))",
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "ArrowLeft",
    code: "ArrowLeft",
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "ArrowLeft",
    code: "ArrowLeft",
  });
  await waitFor(
    `Number(document.querySelector('.analysis-panel-divider').getAttribute('aria-valuenow')) < ${resizedShare}`,
  );
  assert(
    await evaluate(
      "localStorage.getItem('mentor-analysis-panel-size') !== null",
    ),
  );
  await evaluate(
    "document.querySelector('.analysis-resize-hint button').click()",
  );
  await waitFor(
    "document.querySelector('.analysis-panel-divider').getAttribute('aria-valuenow') === '35'",
  );
  assert(
    await evaluate(
      "document.querySelector('.analysis-details .component-documentation')?.dataset.componentId.length > 0",
    ),
  );
  assert(
    await evaluate(
      "document.querySelector('.analysis-details .component-documentation').innerText.includes('Inputs & output')",
    ),
  );
  assert(
    await evaluate(
      "document.querySelector('.analysis-details .component-doc-source').href.includes('/blob/')",
    ),
  );
  const sourceScreenshot = await send("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(
    root + "/data/ui-source-verification.png",
    Buffer.from(sourceScreenshot.data, "base64"),
  );
  assert(
    await evaluate(
      'document.querySelector(".analysis-details .repository-source-footer a").href.includes("/blob/")',
    ),
  );
  await evaluate(
    `Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent==='documentation').click()`,
  );
  await waitFor(
    `document.querySelector('.repository-docs')?.dataset.snapshotId === ${JSON.stringify(job.snapshot_id)}`,
  );
  assert.equal(
    await evaluate(
      'document.querySelectorAll(".doc-scope-options button").length',
    ),
    3,
  );
  assert.equal(
    await evaluate(
      'document.querySelectorAll(".doc-reader-toolbar button").length',
    ),
    1,
  );
  assert.equal(
    await evaluate(
      'document.querySelectorAll(".doc-reader-footer button").length',
    ),
    0,
  );
  await evaluate(`document.querySelector('[data-scope="backend"]').click()`);
  await waitFor(
    `document.querySelector('[data-scope="backend"]').getAttribute('aria-pressed') === 'true'`,
  );
  assert(
    await evaluate(
      `document.querySelector('#doc-overview').textContent.includes('Backend, at a glance')`,
    ),
  );
  await evaluate(`document.querySelector('[data-scope="frontend"]').click()`);
  await waitFor(
    `document.querySelector('#doc-overview').textContent.includes('No frontend code identified')`,
  );
  await evaluate(`document.querySelector('[data-scope="all"]').click()`);
  await evaluate(
    `document.querySelector('.doc-intro').scrollIntoView({block:'start'})`,
  );
  await pause(400);
  const docsScreenshot = await send("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(
    root + "/data/ui-documentation-verification.png",
    Buffer.from(docsScreenshot.data, "base64"),
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert(
    await evaluate("document.documentElement.scrollWidth <= window.innerWidth"),
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(`document.querySelector('[data-view="report"]').click()`);
  await waitFor('document.querySelector(".analysis-report")');
  await evaluate(
    `Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent==='architecture').click()`,
  );
  await pause(500);
  await evaluate(
    `document.querySelector('.analysis-map-heading').scrollIntoView({block:'start'})`,
  );
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    root + "/data/ui-verification.png",
    Buffer.from(screenshot.data, "base64"),
  );
  assert.deepEqual(errors, []);
  await evaluate(`location.hash='/workspace'`);
  await waitFor(
    'document.querySelector(".code-workspace") && document.querySelector(".mentor-file-tree")',
  );
  assert(
    await evaluate(
      `document.querySelector('.code-workspace').dataset.snapshotId === ${JSON.stringify(job.snapshot_id)}`,
    ),
  );
  assert(
    await evaluate(
      `!document.querySelector('.global-search') && !document.querySelector('.topbar-actions') && !document.querySelector('.ide-journey')`,
    ),
  );
  assert(
    await evaluate(
      `!document.querySelector('main').innerText.includes('relay-api') && !document.querySelector('main').innerText.includes('Sample source')`,
    ),
  );
  assert(
    await evaluate(
      `document.querySelector('.workspace-location').innerText.includes('heroku/node-js-getting-started')`,
    ),
  );
  await evaluate(
    `document.querySelector('.code-workspace-header').scrollIntoView({block:'start'})`,
  );
  await pause(900);

  await waitFor(
    "!document.querySelector('.mentor-edit-toolbar button').disabled",
  );
  assert(
    await evaluate(
      "!document.querySelector('.analysis-connect') && !document.querySelector('.repository-docs')",
    ),
  );
  await evaluate(
    "document.querySelector('.mentor-edit-toolbar button').click()",
  );
  await waitFor("document.querySelector('#local-source-draft')");
  await evaluate(
    "{const el=document.querySelector('#local-source-draft');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,el.value+'\\n// local draft verification');el.dispatchEvent(new Event('input',{bubbles:true}));}",
  );
  await waitFor(
    "document.querySelector('.mentor-source-badge').innerText==='Local draft'",
  );
  assert(
    await evaluate(
      "document.querySelector('.mentor-status').innerText.includes('1 local drafts')",
    ),
  );
  await evaluate(
    "Array.from(document.querySelectorAll('.mentor-edit-toolbar button')).find(b=>b.innerText==='Read source').click()",
  );
  await evaluate(
    "document.querySelector('.mentor-question-suggestions button').click()",
  );
  await waitFor("document.querySelector('.mentor-turn')");
  assert(
    await evaluate(
      "document.querySelector('.mentor-citations a').href.includes('/blob/')",
    ),
  );
  await evaluate(
    "Array.from(document.querySelectorAll('.mentor-edit-toolbar button')).find(b=>b.innerText==='Discard draft').click()",
  );
  await waitFor(
    "document.querySelector('.mentor-status').innerText.includes('0 local drafts')",
  );
  await evaluate(
    "Array.from(document.querySelectorAll('.mentor-view-tabs button')).find(b=>b.innerText==='Connections').click()",
  );
  await waitFor(
    "document.querySelector('.mentor-connection-map .react-flow__node')",
  );
  await evaluate(
    "Array.from(document.querySelectorAll('.mentor-view-tabs button')).find(b=>b.innerText==='Split').click()",
  );
  await waitFor(
    "document.querySelector('.mentor-flow') && document.querySelector('.repository-source')",
  );
  const workspaceScreenshot = await send("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(
    root + "/data/ui-live-workspace.png",
    Buffer.from(workspaceScreenshot.data, "base64"),
  );
  const originalDocumentation = await evaluate(
    "document.querySelector('.real-mentor-panel .component-documentation').dataset.componentId",
  );
  const originalSelection = await evaluate(
    "document.querySelector('.mentor-selection h1').innerText",
  );
  await evaluate(
    "Array.from(document.querySelectorAll('.mentor-tree-components button')).find(b=>!b.classList.contains('active')).click()",
  );
  await waitFor(
    `document.querySelector('.mentor-selection h1').innerText !== ${JSON.stringify(originalSelection)}`,
  );
  assert(await evaluate("!document.querySelector('.mentor-turn')"));
  assert(
    await evaluate(
      `document.querySelector('.real-mentor-panel .component-documentation').dataset.componentId !== ${JSON.stringify(originalDocumentation)}`,
    ),
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await pause(300);
  assert(
    await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"),
    "Workspace should fit a phone screen",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.reload");
  await waitFor(
    `document.querySelector('.code-workspace')?.dataset.snapshotId === ${JSON.stringify(job.snapshot_id)}`,
  );
  // A full reload must render the workspace graph without first loading another route's CSS.
  await evaluate(
    "Array.from(document.querySelectorAll('.mentor-view-tabs button')).find(b=>b.innerText==='Connections').click()",
  );
  await waitFor(
    "document.querySelector('.mentor-connection-map .react-flow__node-default')",
  );
  assert(
    await evaluate(`{
    const nodes=Array.from(document.querySelectorAll('.mentor-connection-map .react-flow__node-default')).filter(n=>getComputedStyle(n).opacity!=='0');
    nodes.length>0 && nodes.every(n=>getComputedStyle(n).position==='absolute' && getComputedStyle(n).borderTopStyle==='solid');
  }`),
    "Cold workspace graph needs positioned, bordered cards",
  );
  assert(
    await evaluate(
      "getComputedStyle(document.querySelector('.mentor-connection-map .react-flow__edgelabel-renderer')).position==='absolute'",
    ),
    "Edge labels need their viewport positioning styles",
  );
  assert(
    await evaluate(
      "document.querySelector('.mentor-connection-map .react-flow__controls').getBoundingClientRect().bottom <= document.querySelector('.mentor-connection-map').getBoundingClientRect().bottom + 1",
    ),
  );
  await evaluate(`location.hash='/demo-workspace'`);
  await waitFor(
    'document.querySelector(".global-search") && document.querySelector(".next-step-card")',
  );
  assert(await evaluate('Boolean(document.querySelector(".topbar-actions"))'));
  await evaluate(
    `localStorage.removeItem('mentor-analysis-job');location.hash='/workspace'`,
  );
  await send("Page.reload");
  await waitFor(
    `document.querySelector('.mentor-empty') && document.querySelector('a[href="#/repository"]')`,
  );
  assert(
    await evaluate(
      `!document.querySelector('.analysis-snapshot') && !document.querySelector('.ide-journey') && !document.querySelector('main').innerText.includes('relay-api')`,
    ),
  );
  await evaluate(
    `localStorage.setItem('mentor-analysis-job','nonexistent-verification-job')`,
  );
  await send("Page.reload");
  await waitFor(`document.querySelector('[role="alert"]')`);
  assert(
    await evaluate(
      `!document.querySelector('.analysis-snapshot') && !document.querySelector('main').innerText.includes('Sample source')`,
    ),
  );
  await evaluate(
    `localStorage.setItem('mentor-analysis-job',${JSON.stringify(job.id)})`,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        nodeCount,
        snapshotId: job.snapshot_id,
        checks: [
          "restored real snapshot",
          "dedicated code workspace: real files, component connections, local drafts, grounded questions, reload",
          "live workspace contains no sample source or dummy journey controls",
          "no-analysis and failed-analysis states never fall back to demo data",
          "full-width horizontal backend system is the initial view",
          "system sections and selected-route diagrams drill down to code",
          "repository-only cleanup keeps navigation and other workspace controls",
          "single documentation download and simplified graph controls",
          "real job progress drives loader stages",
          "animated loading state and reduced motion",
          "mobile loading layout without horizontal overflow",
          "rendered graph nodes",
          "direct workspace reload loads graph card, handle, label and control styles",
          "folder overview opens filtered component details",
          "clickable component details",
          "syntax highlighting and source line numbers",
          "complete file from line one with selected component range highlighted in light purple theme",
          "source wrapping and copy action",
          "draggable panel divider, keyboard resize, saved preference and reset",
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
  const cleanupDb = new DatabaseSync(root + "/data/http-verification.sqlite");
  cleanupDb.prepare("DELETE FROM analysis_jobs WHERE id=?").run(loadingJobId);
  cleanupDb.close();
  socket?.close();
  chrome.kill();
  server.kill();
}
