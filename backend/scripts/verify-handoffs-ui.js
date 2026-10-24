import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
const runId = randomUUID(),
  base = "http://127.0.0.1:3007";
const browser = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
assert(browser, "Chrome or Edge is required for this optional browser check.");
const env = {
  ...process.env,
  PORT: "3007",
  DATABASE_PATH: `${root}/data/handoffs-check-${runId}.sqlite`,
  LLM_API_KEY: "",
  ELEVENLABS_API_KEY: "",
};
const launchServer = () =>
  spawn(process.execPath, ["scripts/handoff-test-server.js"], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: "ignore",
  });
let server = launchServer();
const chrome = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-port=9227",
    `--user-data-dir=${root}/data/handoff-browser-${runId}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket,
  inspect,
  browserErrors = [];
async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await pause(100);
  }
  throw new Error("Test backend did not start.");
}
try {
  await waitForServer();
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:9227/json/version")).ok) break;
    } catch {}
    await pause(100);
  }
  const target = await (
    await fetch(`http://127.0.0.1:9227/json/new?${base}/%23/handoffs`, {
      method: "PUT",
    })
  ).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const pending = new Map(),
    errors = browserErrors;
  let sequence = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown")
      errors.push(
        message.params.exceptionDetails.exception?.description ||
          message.params.exceptionDetails.text,
      );
    const task = pending.get(message.id);
    if (task) {
      pending.delete(message.id);
      message.error
        ? task.reject(new Error(message.error.message))
        : task.resolve(message.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout ${method}`));
      }, 15000);
      pending.set(id, {
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
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  inspect = evaluate;
  const wait = async (expression, message) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await pause(100);
    }
    throw new Error(message);
  };
  const click = async (label) => {
    assert(
      await evaluate(
        `(() => { const button = [...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === ${JSON.stringify(label)}); if(!button || button.disabled) return false; button.click(); return true; })()`,
      ),
      `Missing button: ${label}`,
    );
  };
  const fill = async (selector, text) => {
    assert(
      await evaluate(
        `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return false; const setter=Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set; setter.call(e,${JSON.stringify(text)}); e.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`,
      ),
      `Missing input ${selector}`,
    );
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(
    `document.body.innerText.includes('Sign in to collaborate')`,
    "Sign-in screen missing",
  );
  await click("New here? Create an account");
  await fill("input[name=name]", "Developer check");
  await fill("input[name=email]", `junior-${runId}@test.example`);
  await fill("input[name=password]", "browser check password 123");
  await click("Create account & workspace");
  await wait(
    `document.body.innerText.includes('A question, with the code attached.')`,
    "Account registration failed",
  );
  const team = await evaluate(
    `fetch('/api/collaboration/me').then(r=>r.json())`,
  );
  const invite = await evaluate(
    `fetch('/api/collaboration/workspaces/${team.workspaces[0].id}/invites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'reviewer'})}).then(r=>r.json())`,
  );
  // A second real account accepts the invite. Its cookie is not inserted into the browser.
  const seniorResponse = await fetch(`${base}/api/collaboration/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Senior check",
      email: `senior-${runId}@test.example`,
      password: "browser check password 123",
      inviteToken: invite.token,
    }),
  });
  assert.equal(seniorResponse.status, 201);
  const snapshot = await evaluate(
    `fetch('/api/analyses/handoff-browser-analysis').then(r=>r.json()).then(j=>fetch('/api/snapshots/'+j.snapshot_id)).then(r=>r.json())`,
  );
  const component = snapshot.components.find(
    (c) => c.name === "createUser" && c.role !== "module",
  );
  await evaluate(
    `localStorage.setItem('mentor-analysis-job','handoff-browser-analysis'); location.href='${base}/#/workspace?component=${component.id}'; location.reload();`,
  );
  await wait(
    `document.body.innerText.includes('Create Handoff Snapshot')`,
    "Workspace handoff action missing",
  );
  await click("Code Focus");
  await wait(
    `document.querySelector('button[aria-label="Select line 4"]')`,
    "Source line selection missing",
  );
  await evaluate(
    `document.querySelector('button[aria-label="Select line 4"]').click()`,
  );
  await click("Create Handoff Snapshot");
  await wait(
    `document.querySelector('input[name=title]')`,
    "Creation modal missing",
  );
  await fill("input[name=title]", "Why reject the existing account?");
  await fill(
    "textarea[name=question]",
    "Should this update the account instead of throwing?",
  );
  await click("Create handoff");
  await wait(
    `document.body.innerText.includes('Your handoff is ready')`,
    "Handoff creation failed",
  );
  await click("Open session");
  await wait(
    `document.body.innerText.includes('Developer & senior discussion')`,
    "Review screen missing",
  );
  const sessionId = await evaluate(`location.hash.split('/').pop()`);
  await send("Page.reload");
  await wait(
    `document.body.innerText.includes('Why reject the existing account?') && document.body.innerText.includes('Shared code workspace')`,
    "Direct handoff reload failed",
  );
  await wait(
    `document.querySelector('.handoff-repository [data-source-complete="true"]') && document.querySelector('.handoff-repository [data-line="8"]')`,
    "Complete shared file missing",
  );
  assert(
    await evaluate(
      `document.querySelector('.handoff-repository [data-line="4"]').classList.contains('source-focused-line') && !document.querySelector('.handoff-repository [data-line="8"]').classList.contains('source-focused-line')`,
    ),
    "Original selection is not highlighted inside the full file",
  );
  await click("findUserByEmail");
  assert(
    await evaluate(
      `document.querySelector('.handoff-repository [data-line="4"]').classList.contains('source-focused-line')`,
    ),
    "Browsing another component erased the original shared highlight",
  );
  await click("Split");
  await wait(
    `document.querySelector('.handoff-shared-diagram .react-flow__node')`,
    "Shared architecture nodes missing",
  );
  const otherFile = await evaluate(
    `(() => {const e=[...document.querySelectorAll('.handoff-tree-file')].find(e=>e.textContent.includes('app.ts')); if(!e)return false; e.click();return true})()`,
  );
  assert(
    otherFile,
    "Shared file explorer does not expose the second analyzed file",
  );
  await wait(
    `document.querySelector('.handoff-shared-source .repository-source-file')?.innerText.includes('app.ts') && document.querySelector('.handoff-shared-source [data-source-complete="true"]')`,
    "Second complete file could not open",
  );
  await evaluate(
    `(() => {const e=document.querySelector('select[aria-label="Shared architecture diagram type"]'); e.value='system';e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await wait(
    `document.querySelector('.handoff-shared-diagram .system-architecture-canvas .react-flow__node')`,
    "Backend architecture is unavailable to the reviewer",
  );
  await evaluate(
    `document.querySelector('.handoff-repository-meta button').click()`,
  );
  await wait(
    `document.querySelector('.handoff-shared-source .repository-source-file')?.innerText.includes('users.ts')`,
    "Original shared selection could not be restored",
  );
  assert(
    await evaluate(
      `(() => {const main=document.querySelector('.handoff-main-column'); const discussion=main.children[1]; const before=discussion.getBoundingClientRect().top; const side=document.querySelector('.handoff-context'); side.style.minHeight='1500px'; const after=discussion.getBoundingClientRect().top; side.style.minHeight=''; return Math.abs(before-after)<2 && discussion.getBoundingClientRect().top-main.children[0].getBoundingClientRect().bottom<25;})()`,
    ),
    "Long AI context adds empty space above the discussion",
  );
  await evaluate(
    `fetch('/api/collaboration/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(()=>location.reload())`,
  );
  await wait(
    `document.body.innerText.includes('Sign in to collaborate')`,
    "Logout failed",
  );
  await fill("input[name=email]", `senior-${runId}@test.example`);
  await fill("input[name=password]", "browser check password 123");
  await click("Sign in");
  await wait(
    `document.body.innerText.includes('Propose a solution')`,
    "Reviewer controls missing",
  );
  await evaluate(
    `document.querySelector('button[aria-label="Select line 4"]').click()`,
  );
  await fill(
    "#handoff-comment",
    "This condition rejects an existing account. Check the create-only contract.",
  );
  await click("Post reply");
  await wait(
    `document.body.innerText.includes('1 replies')`,
    "Senior reply not saved",
  );
  await click("Propose a solution");
  await fill(
    "textarea[name=solution]",
    "Keep the conflict response for an existing account.",
  );
  await fill(
    "textarea[name=explanation]",
    "The API is create-only; updating accounts is a separate operation.",
  );
  await click("Send solution for confirmation");
  await wait(
    `document.body.innerText.includes('Proposed solution')`,
    "Solution not saved",
  );
  await evaluate("window.scrollTo(0,0); document.activeElement?.blur();");
  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  writeFileSync(
    `${root}/data/handoffs-review.png`,
    Buffer.from(screenshot.data, "base64"),
  );
  await evaluate(
    `fetch('/api/collaboration/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(()=>location.reload())`,
  );
  await wait(
    `document.body.innerText.includes('Sign in to collaborate')`,
    "Second logout failed",
  );
  await fill("input[name=email]", `junior-${runId}@test.example`);
  await fill("input[name=password]", "browser check password 123");
  await click("Sign in");
  await wait(
    `document.body.innerText.includes('This solved my question')`,
    "Author confirmation missing",
  );
  await click("This solved my question");
  await wait(
    `document.body.innerText.includes('Approve for Team Knowledge')`,
    "Maintainer approval missing",
  );
  await click("Approve for Team Knowledge");
  await wait(
    `document.body.innerText.includes('Published in Team Knowledge')`,
    "Knowledge approval failed",
  );
  // Restart the backend using the same SQLite file, then open the direct link again.
  server.kill();
  await new Promise((resolve) => server.once("exit", resolve));
  server = launchServer();
  await waitForServer();
  await send("Page.reload");
  await wait(
    `document.body.innerText.includes('Accepted solution')`,
    "Session or authentication did not survive backend restart",
  );
  await evaluate(`location.hash='/knowledge'`);
  await wait(
    `document.querySelector('.memory-toolbar') && document.body.innerText.includes('The API is create-only; updating accounts is a separate operation.')`,
    "Approved knowledge is missing",
  );
  await click("Capture knowledge");
  await wait(
    `document.querySelector('.memory-editor')`,
    "Standalone knowledge editor did not open",
  );
  await evaluate(
    `(()=>{const e=document.querySelector('select[aria-label="Knowledge type"]');e.value='failure_lesson';e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await fill(
    "input[name=memoryTitle]",
    "Remember the duplicate-account failure",
  );
  await fill(
    "textarea[name=observedFailure]",
    "The signup request rejected an already registered account.",
  );
  await fill(
    "textarea[name=resolution]",
    "Use the update endpoint when changing an existing account.",
  );
  await fill(
    "textarea[name=prevention]",
    "Keep create and update behavior separate.",
  );
  await evaluate(
    `(()=>{const e=document.querySelector('select[aria-label="Knowledge source component"]');e.value=${JSON.stringify(component.referenceId)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await click("Save knowledge draft");
  await wait(
    `document.querySelector('.memory-detail')?.innerText.includes('Remember the duplicate-account failure')`,
    "Standalone draft did not open",
  );
  await wait(
    `document.querySelector('.memory-detail')?.innerText.includes('Cause: unknown')`,
    "Failure cause was invented",
  );
  await click("Submit for review");
  await wait(
    `document.body.innerText.includes('Approve this revision')`,
    "Draft did not reach review",
  );
  await click("Approve this revision");
  await wait(
    `document.querySelector('.memory-detail')?.innerText.includes('This revision was approved by a maintainer.')`,
    "Exact revision approval failed",
  );
  await click("Revise knowledge");
  await wait(
    `document.querySelector('.memory-editor')`,
    "Revision editor missing",
  );
  await fill(
    "textarea[name=prevention]",
    "Review the account contract and preserve separate create and update endpoints.",
  );
  await click("Save new draft revision");
  await wait(
    `document.querySelector('.memory-detail')?.innerText.includes('Revision 2')`,
    "Correction did not create a new revision",
  );
  await evaluate(
    `(()=>{const e=[...document.querySelectorAll('summary')].find(e=>e.textContent.includes('Revision history & audit trail'));e.click();})()`,
  );
  await wait(
    `document.querySelector('.memory-history')?.parentElement.innerText.includes('Revision 1 · Approved by')`,
    "Approved history was overwritten",
  );
  await click("Submit for review");
  await wait(
    `document.body.innerText.includes('Approve this revision')`,
    "Corrected draft review missing",
  );
  await click("Approve this revision");
  await wait(
    `document.querySelector('.memory-detail')?.innerText.includes('This revision was approved by a maintainer.')`,
    "Corrected revision was not approved",
  );
  const memoryScreenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  writeFileSync(
    `${root}/data/engineering-memory.png`,
    Buffer.from(memoryScreenshot.data, "base64"),
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await pause(200);
  assert(
    await evaluate(`document.documentElement.scrollWidth<=innerWidth+2`),
    "Knowledge page overflows mobile width",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(`location.hash='/workspace?component=${component.id}'`);
  await wait(
    `document.querySelector('.related-team-knowledge')?.innerText.includes('Remember the duplicate-account failure')`,
    "Approved memory did not surface for its workspace component",
  );
  await evaluate("document.querySelector('.impact-toggle input').click()");
  await wait("document.querySelector('#impact-proposed-code')?.value.includes('createUser')", 'Merged Impact tab did not load pinned source');
  const beforeImpact=await evaluate("document.querySelector('#impact-proposed-code').value");
  await fill('#impact-proposed-code',beforeImpact+'\n// proposed review draft');
  await click('Analyze proposed code');
  await wait("document.querySelector('.impact-code-analysis')?.innerText.includes('Source facts')", 'Merged impact analysis did not preserve source-only fallback');
  await evaluate("[...document.querySelectorAll('.workspace-right-panel-tabs button')].find(e=>e.textContent.trim()==='Mentor').click()");
  await wait("document.querySelector('.workspace-mentor-content .related-team-knowledge')?.innerText.includes('Remember the duplicate-account failure')", 'Impact tab lost existing mentor knowledge');
  await evaluate(
    `location.hash='/journeys/repo-${snapshot.snapshotId}-${component.id}'`,
  );
  await wait(`document.querySelector('.journey-component-details summary')`, 'Journey details missing');
  await evaluate(`document.querySelector('.journey-component-details').open=true`);
  await wait(
    `document.querySelector('.journey-component-details .related-team-knowledge')?.innerText.includes('Remember the duplicate-account failure')`,
    "Approved memory did not surface for its CodeJourney event",
  );
  await evaluate(`location.hash='/handoffs/${sessionId}'`);
  await wait(
    `document.body.innerText.includes('Accepted solution')`,
    "Return to saved review failed",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await pause(300);
  assert(
    await evaluate(`document.documentElement.scrollWidth <= innerWidth + 2`),
    "Mobile page overflows horizontally",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  writeFileSync(
    `${root}/data/handoffs-verification.json`,
    JSON.stringify(
      {
        passed: true,
        checks: [
          "account creation",
          "workspace line selection",
          "pinned snapshot creation",
          "direct URL reload",
          "complete shared files and original highlighted range",
          "file/component explorer and other-file navigation",
          "saved component and backend architecture diagrams",
          "independent columns without blank space below code",
          "senior answer and annotation",
          "solution proposal",
          "author confirmation",
          "maintainer approval",
          "backend restart persistence",
          "team knowledge",
          "standalone failure lesson and unknown cause",
          "draft review and exact revision approval",
          "immutable approved revision history",
          "relevant knowledge in the code workspace",
          "relevant knowledge in CodeJourney details",
          "mobile layout",
        ],
        sessionId,
      },
      null,
      2,
    ),
  );
  console.log(
    "Collaboration browser checks passed: handoff → senior review → accepted answer → linked knowledge; standalone failure lesson, exact revision approval/history, workspace retrieval, persistence and mobile layout verified.",
  );
} catch (error) {
  if (inspect)
    console.error(
      await inspect("document.body.innerText.slice(0,4000)").catch(
        () => "Browser unavailable",
      ),
    );
  console.error(browserErrors.join("\n"));
  throw error;
} finally {
  socket?.close();
  chrome.kill();
  server.kill();
}
