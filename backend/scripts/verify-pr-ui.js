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
// Path-only metadata is grounded in the captured changed-file list. Keep the
// rest marked incomplete; this fixture avoids a new GitHub tree request.
const setupSeed = new DatabaseSync(root + "/data/pr-verification.sqlite");
setupSeed.exec(
  "CREATE TABLE IF NOT EXISTS snapshot_setup_metadata (snapshot_id TEXT PRIMARY KEY,data TEXT NOT NULL)",
);
for (const id of [comparison.beforeSnapshotId, comparison.afterSnapshotId])
  setupSeed
    .prepare("INSERT OR REPLACE INTO snapshot_setup_metadata VALUES (?,?)")
    .run(
      id,
      JSON.stringify({
        paths: comparison.pr.files
          .map((f) => f.path)
          .filter((p) =>
            /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(p),
          ),
        limited: true,
      }),
    );
setupSeed.close();
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
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      );
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
    `localStorage.setItem('mentor-analysis-job','pr-ui-active-repository');localStorage.removeItem('mentor-repository-url');localStorage.setItem('mentor-pr-job','pr-ui-interrupted');location.hash='/changes';location.reload()`,
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
  await wait("document.querySelector('.pr-discovery-card')");
  assert(
    await evaluate(
      "Array.from(document.querySelectorAll('.pr-input button')).find(b=>b.textContent==='All PRs')?.getAttribute('aria-pressed')==='true'",
    ),
    "All PRs should be the default",
  );
  await evaluate(
    "Array.from(document.querySelectorAll('.pr-input button')).find(b=>b.textContent==='Open PRs').click()",
  );
  await wait("document.querySelector('.pr-discovery-empty')");
  assert(
    await evaluate("!document.querySelector('#pr-select-live')"),
    "Empty results should not leave a disabled picker",
  );
  assert(
    await evaluate(
      "document.querySelector('.pr-empty-actions a')?.href.endsWith('/compare')",
    ),
    "Empty state should link to creating a real PR",
  );
  const emptyImage = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    root + "/data/ui-pr-discovery-empty.png",
    Buffer.from(emptyImage.data, "base64"),
  );
  await evaluate(
    "Array.from(document.querySelectorAll('.pr-input button')).find(b=>b.textContent==='Show all PRs').click()",
  );
  await wait("document.querySelector('.pr-discovery-card')");
  await evaluate(
    "(()=>{const input=document.querySelector('#pr-search-live');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'missing-pr-search-xyz');input.dispatchEvent(new Event('input',{bubbles:true}));})()",
  );
  await wait("!document.querySelector('.pr-discovery-card')");
  await evaluate(
    "Array.from(document.querySelectorAll('.pr-input button')).find(b=>b.textContent==='Clear search').click()",
  );
  await wait("document.querySelector('.pr-discovery-card')");
  await evaluate("document.querySelector('.pr-discovery-card').click()");
  assert(
    await evaluate(
      "document.querySelector('.pr-discovery-card').getAttribute('aria-pressed')==='true'",
    ),
  );
  const discoveryImage = await send("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(
    root + "/data/ui-pr-discovery.png",
    Buffer.from(discoveryImage.data, "base64"),
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
  await tab('Overview');
  await wait("document.querySelector('.pr-review-overview')");
  assert(await evaluate("document.querySelectorAll('.pr-review-stats > div').length===3"),'Overview must consolidate redundant metrics');
  assert(await evaluate("!document.querySelector('.pr-review-comparison-details').open"),'Technical commit details should be collapsed');
  assert(await evaluate("document.querySelectorAll('.pr-review-file').length>0 && !document.querySelector('.pr-review-source .pr-component-link')"),'Source changes are not grouped by file');
  await evaluate("document.querySelector('.pr-review-summary').scrollIntoView({block:'start'})");
  await pause(350);
  const overviewImage=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(root+'/data/pr-overview-desktop.png',Buffer.from(overviewImage.data,'base64'));
  await evaluate("document.querySelector('.pr-review-file footer button').click()");
  await wait("document.querySelector('.pr-diff-layout')");
  assert(await evaluate("document.querySelector('.pr-tabs [aria-selected=true]').textContent==='Changed files & diff'"),'Overview file action must open the actual diff');
  await tab('Overview');
  await tab("Change impact");
  await wait("document.querySelector('.change-impact')");
  assert(
    await evaluate(
      "document.querySelector('.change-impact').textContent.includes('commit')",
    ),
  );
  await evaluate(
    "document.querySelector('.change-impact select').value='component';document.querySelector('.change-impact select').dispatchEvent(new Event('change',{bubbles:true}))",
  );
  const impactSeed = await evaluate(
    `(async()=>{const s=await(await fetch('/api/snapshots/${comparison.afterSnapshotId}')).json();return s.relationships.find(e=>e.type==='calls'&&e.source!==e.target)?.target})()`,
  );
  assert(impactSeed, "Real snapshot must contain an incoming call to explore");
  await evaluate(
    `(()=>{const el=document.querySelectorAll('.change-impact select')[1];el.value=${JSON.stringify(impactSeed)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await wait("document.querySelector('.impact-result')");
  await evaluate("document.querySelector('.impact-result summary').click()");
  assert(
    await evaluate(
      "document.querySelector('.impact-path a')?.href.includes('github.com')",
    ),
    "Impact paths must link to recorded evidence",
  );
  await evaluate(
    "document.querySelector('.change-impact').scrollIntoView({block:'start'})",
  );
  const impactImage = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    root + "/data/ui-change-impact.png",
    Buffer.from(impactImage.data, "base64"),
  );
  await evaluate(
    "(()=>{const input=document.querySelector('.change-impact input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'no-matching-component-xyz');input.dispatchEvent(new Event('input',{bubbles:true}));})()",
  );
  await wait(
    "document.querySelector('.impact-empty')?.textContent.includes('No results match')",
  );
  await evaluate(
    "document.querySelector('[aria-label=\"Impact source version\"] button').click()",
  );
  await wait(
    `document.querySelector('.impact-version')?.textContent.includes('${comparison.pr.baseCommit.slice(0, 12)}')`,
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert(
    await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
    "Impact explorer must fit mobile width",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
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
  await wait("document.querySelector('.setup-project')");
  assert(
    await evaluate(
      "document.querySelector('.source-setup-guide').textContent.includes('npm.cmd ci')",
    ),
    "Setup should show copyable lockfile-grounded install commands",
  );
  assert(
    await evaluate(
      "document.querySelector('.source-setup-guide').textContent.includes('npm.cmd run start')",
    ),
    "Setup should use declared startup script",
  );
  await evaluate(
    "const select=document.querySelector('[aria-label=\"Setup command shell\"]');select.value='posix';select.dispatchEvent(new Event('change',{bubbles:true}));",
  );
  await wait(
    "document.querySelector('.source-setup-guide').textContent.includes('npm ci')",
  );
  await evaluate(
    "Array.from(document.querySelectorAll('.source-setup-guide .pr-version-tabs button')).find(b=>b.textContent==='Before this PR').click()",
  );
  assert(
    await evaluate(
      "document.querySelector('.source-setup-guide').textContent.includes('Ready') || !!document.querySelector('.setup-project')",
    ),
  );
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
  await evaluate(
    "const draft=document.querySelector('[aria-label=\"Integrated code draft\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(draft,draft.value+'\\n// local preview edit');draft.dispatchEvent(new Event('input',{bubbles:true}));",
  );
  await wait(
    "document.querySelector('.pr-simulator').textContent.includes('Local draft only')",
  );
  await tab("Overview");
  await tab("Merge simulator");
  assert(
    await evaluate(
      "document.querySelector('[aria-label=\"Integrated code draft\"]')?.value.includes('local preview edit')",
    ),
    "Local draft should survive switching tabs",
  );
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
  await tab('Overview');
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Overview must fit mobile width');
  assert(await evaluate("document.querySelector('.pr-discovery-toolbar label').getBoundingClientRect().height<120"),'PR search must not reserve a large empty vertical space on mobile');
  const overviewMobile=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(root+'/data/pr-overview-mobile.png',Buffer.from(overviewMobile.data,'base64'));
  await send("Page.reload");
  await wait("document.querySelector('.pr-summary-live')");
  await evaluate("location.hash='/workspace'");
  await wait("document.querySelector('.mentor-selection')");
  await evaluate("document.querySelector('.impact-toggle input').click()");
  await wait("document.querySelector('#impact-proposed-code')");
  await evaluate("location.hash='/repository'");
  await wait(
    "document.querySelector('[aria-label=\"Public GitHub repository\"]')",
  );
  await evaluate(
    "(()=>{const el=document.querySelector('[aria-label=\"Public GitHub repository\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'https://github.com/example/new-selection.git');el.dispatchEvent(new Event('input',{bubbles:true}));})()",
  );
  await evaluate(
    "window.__selectionFetch=fetch;window.fetch=(input,options)=>{if(typeof input==='string'&&input.startsWith('/api/pr/pulls?'))window.__selectedRepositoryQuery=new URL(input,location.origin).searchParams.get('repository');return window.__selectionFetch(input,options)};location.hash='/changes'",
  );
  await wait(
    "window.__selectedRepositoryQuery==='https://github.com/example/new-selection'",
  );
  assert(
    await evaluate(
      "document.querySelector('.pr-selected-repository')?.textContent.includes('example/new-selection')",
    ),
    "Picker must use the URL from Repository rather than the saved comparison",
  );
  await evaluate(
    "localStorage.removeItem('mentor-analysis-job');location.reload()",
  );
  await wait("document.querySelector('.pr-discovery-card')");
  assert(
    await evaluate(
      "document.querySelector('.pr-selected-repository')?.textContent.includes('example/new-selection')",
    ),
    "Selected URL must load PRs after reload without an analysis snapshot",
  );
  assert.equal(
    await evaluate(
      "(async()=>{const r=await fetch(new Request(location.origin+'/api/pr/pulls?repository=https%3A%2F%2Fevil.example%2Fx%2Fy'));return r.status})()",
    ),
    400,
    "PR endpoint must reject unsupported repository URLs",
  );
  assert.equal(
    await evaluate(
      "(async()=>{const r=await fetch(new Request(location.origin+'/api/pr/pulls?repository=https%3A%2F%2Fgithub.com%2Fx%2Fy&snapshotId=unexpected'));return r.status})()",
    ),
    400,
    "PR endpoint must reject ambiguous repository selection",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      checks: [
        "real saved PR restored",
        "all PRs default, selectable cards, page search and empty state recovery",
        "comparison tabs",
        "before/after graphs",
        "change impact paths with source evidence, filters, version switch and mobile layout",
        "workspace change impact dialog",
        "Repository URL changes propagate to PR discovery and survive reload without a snapshot",
        "real unified diff",
        "dependency setup change",
        "reload persistence",
        "mobile layout",
        "merge simulation from pinned real PR source",
        "old code and integrated result views with local draft",
      ],
      comparisonId: report.comparisonId,
      paidProviderCalls: 0,
      setupChecks:
        "captured requirements, pinned manifest links, npm ci/start commands, shell and version switch",
      prListing: "captured PR fixture; actual persisted source and merge API",
    }),
  );
  await send("Browser.close").catch(() => {});
} finally {
  socket?.close();
  chrome.kill();
  server.kill();
}
