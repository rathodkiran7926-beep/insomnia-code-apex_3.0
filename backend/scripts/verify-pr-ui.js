import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
const root = fileURLToPath(new URL("../", import.meta.url));
const report = JSON.parse(
  readFileSync(root + "/data/pr-verification.json", "utf8"),
);
const seed = new DatabaseSync(root + "/data/pr-verification.sqlite");
const comparison = JSON.parse(
  seed
    .prepare("SELECT data FROM pr_comparisons WHERE id=?")
    .get(report.comparisonId).data,
);
seed
  .prepare("INSERT OR REPLACE INTO analysis_jobs VALUES (?,?,?,?,?,?)")
  .run(
    "pr-ui-active-repository",
    "complete",
    100,
    "UI verification repository",
    comparison.beforeSnapshotId,
    new Date().toISOString(),
  );
seed.close();
const browser = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
assert(browser, "Chrome/Edge is required");
const server = spawn(process.execPath, ["src/server.js"], {
  cwd: root,
  windowsHide: true,
  env: {
    ...process.env,
    PORT: "3006",
    DATABASE_PATH: root + "/data/pr-verification.sqlite",
    LLM_API_KEY: "",
    ELEVENLABS_API_KEY: "",
  },
  stdio: "ignore",
});
const chrome = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-port=9226",
    `--user-data-dir=${root}/data/pr-browser-profile`,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let socket;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if (
        (await fetch("http://127.0.0.1:3006/api/health")).ok &&
        (await fetch("http://127.0.0.1:9226/json/version")).ok
      )
        break;
    } catch {}
    await pause(100);
  }
  const restartFixture = new DatabaseSync(
    root + "/data/pr-verification.sqlite",
  );
  restartFixture
    .prepare(
      "INSERT OR REPLACE INTO pr_jobs(id,status,progress,message,comparison_id,created_at,url) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      "pr-ui-interrupted",
      "failed",
      0,
      "Server restarted. Retry this comparison.",
      null,
      new Date().toISOString(),
      report.pr,
    );
  restartFixture.close();
  const target = await (
    await fetch("http://127.0.0.1:9226/json/new?http://127.0.0.1:3006/", {
      method: "PUT",
    })
  ).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let sequence = 0;
  const waiting = new Map(),
    errors = [];
  socket.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown")
      errors.push(m.params.exceptionDetails.text);
    const p = waiting.get(m.id);
    if (p) {
      waiting.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(
        () => reject(new Error("CDP timeout: " + method)),
        15000,
      );
      waiting.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = (expression) =>
    evaluate(
      `new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(${expression})return resolve(true);if(Date.now()-start>12000)return reject(new Error('UI timeout: '+${JSON.stringify(expression)}));setTimeout(tick,100)};tick()})`,
    );
  await send("Runtime.enable");
  await send("Page.enable");
  // Reuse captured real PR metadata for listing controls so this regression does
  // not depend on GitHub's current anonymous rate quota. Source/simulation APIs stay real.
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(()=>{const native=window.fetch;window.fetch=(input,options)=>{if(typeof input==='string'&&input.startsWith('/api/pr/pulls?')){const query=new URL(input,location.origin).searchParams;return Promise.resolve(new Response(JSON.stringify({pullRequests:query.get('state')==='open'?[]:[${JSON.stringify({ number: comparison.pr.number, title: comparison.pr.title, url: comparison.pr.url, state: comparison.pr.state, merged: comparison.pr.state === "closed", head: comparison.pr.headBranch, base: comparison.pr.baseBranch })}],hasMore:false}),{headers:{'Content-Type':'application/json'}}));}return native(input,options);};})();`,
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(
    `localStorage.setItem('mentor-analysis-job','pr-ui-active-repository');localStorage.setItem('mentor-pr-job','pr-ui-interrupted');location.hash='/changes';location.reload()`,
  );
  await wait("document.querySelector('.pr-interrupted')");
  assert.equal(
    await evaluate("localStorage.getItem('mentor-pr-job')"),
    null,
    "Interrupted job must not repeatedly restore after reload",
  );
  assert(
    !(await evaluate("!!document.querySelector('.pr-warning[role=alert]')")),
    "Restart should show a recovery prompt rather than a GitHub failure",
  );
  // Route only the retry submission to a known completed test job; verify original PR URL.
  await evaluate(
    `window.__prOriginalFetch=fetch;window.fetch=async(input,options)=>{if(input==='/api/pr/analyses'&&options?.method==='POST'){window.__retriedPR=JSON.parse(options.body).url;return new Response(JSON.stringify({id:${JSON.stringify(report.jobId)}}),{headers:{'Content-Type':'application/json'}});}return window.__prOriginalFetch(input,options);};document.querySelector('.pr-interrupted button').click()`,
  );
  await wait("document.querySelector('.pr-summary-live')");
  assert.equal(
    await evaluate("window.__retriedPR"),
    report.pr,
    "Retry must keep the interrupted PR even when selection differs",
  );
  await evaluate("window.fetch=window.__prOriginalFetch");
  assert(
    await evaluate(
      "document.querySelector('.pr-summary-live').textContent.includes('ejs')",
    ),
  );
  await wait("document.querySelector('.pr-selected-repository')");
  assert(
    await evaluate("!document.querySelector('#pr-url')"),
    "PR URL input must be replaced by repository picker",
  );
  await evaluate(
    "Array.from(document.querySelectorAll('.pr-input button')).find(b=>b.textContent==='Closed / merged').click()",
  );
  await wait(
    "document.querySelector('#pr-select-live')?.querySelectorAll('option').length>1",
  );
  assert(
    await evaluate(
      "(()=>{const select=document.querySelector('#pr-select-live');const style=getComputedStyle(select);return select.getBoundingClientRect().height>=48&&parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)<16;})()",
    ),
    "PR selector should have room for vertically centered text",
  );
  assert(
    await evaluate(
      "Array.from(document.querySelectorAll('#pr-select-live option')).some(o=>o.textContent.includes('#419'))",
    ),
    "Actual repository PR should be selectable",
  );
  const tab = async (label) => {
    await evaluate(
      `Array.from(document.querySelectorAll('.pr-tabs button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`,
    );
    await pause(200);
  };
  await tab("Architecture");
  await wait("document.querySelector('.react-flow')");
  await evaluate("document.querySelector('.pr-version-tabs button').click()");
  await tab("Journey comparison");
  await wait("document.querySelector('.react-flow')");
  await tab("Changed files & diff");
  await evaluate(
    "Array.from(document.querySelectorAll('.pr-file')).find(b=>b.querySelector('span').textContent==='package.json').click()",
  );
  await wait(
    "document.querySelector('.pr-patch')?.textContent.includes('ejs')",
  );
  assert(
    !(await evaluate(
      "document.querySelector('#pr-results').textContent.includes('Sample diff')",
    )),
  );
  assert(
    !(await evaluate(
      "document.querySelector('.topbar').textContent.includes('acme / relay-api')",
    )),
  );
  const image = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    root + "/data/ui-pr-comparison.png",
    Buffer.from(image.data, "base64"),
  );
  await tab("Setup & run guide");
  assert(
    await evaluate(
      "document.querySelector('#pr-results').textContent.includes('ejs')",
    ),
  );
  await tab("Overview");
  await tab("Merge simulator");
  await evaluate(
    "const el=document.querySelector('#merge-file');el.value='package.json';el.dispatchEvent(new Event('change',{bubbles:true}));",
  );
  await evaluate(
    "Array.from(document.querySelectorAll('.pr-simulator button')).find(b=>b.textContent.includes('Simulate integration')).click()",
  );
  await wait("document.querySelector('.pr-merge-status.clean')");
  assert(
    await evaluate(
      "document.querySelector('.pr-merge-code').textContent.includes('7.0.1')",
    ),
  );
  await evaluate(
    "Array.from(document.querySelectorAll('.pr-simulator button')).find(b=>b.textContent==='Target branch / old code').click()",
  );
  assert(
    await evaluate(
      "document.querySelector('.pr-merge-code').textContent.includes('6.0.1')",
    ),
  );
  await evaluate(
    "Array.from(document.querySelectorAll('.pr-simulator button')).find(b=>b.textContent==='Edit local draft').click()",
  );
  assert(
    await evaluate(
      "document.querySelector('[aria-label=\"Integrated code draft\"]').value.includes('7.0.1')",
    ),
  );
  await evaluate("const draft=document.querySelector('[aria-label=\"Integrated code draft\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(draft,draft.value+'\\n// local preview edit');draft.dispatchEvent(new Event('input',{bubbles:true}));");
  await wait("document.querySelector('.pr-simulator').textContent.includes('Local draft only')");
  await tab('Overview');await tab('Merge simulator');
  assert(await evaluate("document.querySelector('[aria-label=\"Integrated code draft\"]')?.value.includes('local preview edit')"),'Local draft should survive switching tabs');
  // Test the real existing mentor against a graph-selected component, without provider calls.
  await tab("Architecture");
  await wait("document.querySelector('.react-flow__node')");
  await evaluate("document.querySelector('.react-flow__node button')?.click()");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await pause(300);
  assert(
    await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
    "PR UI must fit mobile width",
  );
  await send("Page.reload");
  await wait("document.querySelector('.pr-summary-live')");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      checks: [
        "real saved PR restored",
        "five tabs",
        "before/after graphs",
        "real unified diff",
        "dependency setup change",
        "reload persistence",
        "mobile layout",
        "merge simulation from pinned real PR source",
        "old code and integrated result views with local draft",
      ],
      comparisonId: report.comparisonId,
      paidProviderCalls: 0,
      prListing: "captured PR fixture; actual persisted source and merge API",
    }),
  );
  await send("Browser.close").catch(() => {});
} finally {
  socket?.close();
  chrome.kill();
  server.kill();
}
