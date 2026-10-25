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

  const snapshot = await (await fetch('http://127.0.0.1:3002/api/snapshots/'+job.snapshot_id)).json();
  const component=snapshot.components.find(c=>snapshot.references.find(r=>r.id===c.referenceId));
  await evaluate(`localStorage.setItem('mentor-analysis-job',${JSON.stringify(job.id)});location.hash=${JSON.stringify('/workspace?component='+encodeURIComponent(component.id))}`);
  await send('Page.reload');
  await waitFor('document.querySelector("button.source-select-line")');
  await evaluate('document.querySelector("button.source-select-line").scrollIntoView({block:"center"})');
  await pause(150);
  const rect=await evaluate('(()=>{const r=document.querySelector("button.source-select-line").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...rect});await pause(200);
  assert.equal(await evaluate('!!document.querySelector(".source-ide-popover")'),false,'No popup before 500ms');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await pause(400);
  assert.equal(await evaluate('!!document.querySelector(".source-ide-popover")'),false,'Leaving early cancels hover');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...rect});await pause(550);await waitFor('!!document.querySelector(".source-ide-popover")');
  assert.equal(await evaluate('document.querySelector(".source-ide-popover").textContent'),'Move to IDE');
  const button=await evaluate('(()=>{const r=document.querySelector(".source-ide-popover button").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...button});await pause(240);
  assert(await evaluate('!!document.querySelector(".source-ide-popover")'),'Moving onto action preserves popup');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await pause(240);
  assert(await evaluate('!!document.querySelector(".source-ide-popover")'),'One-second grace allows reaching the action');
  await pause(900);assert.equal(await evaluate('!!document.querySelector(".source-ide-popover")'),false);
  await evaluate('document.querySelector("button.source-select-line").focus()');await pause(550);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab'});
  assert(await evaluate('document.activeElement===document.querySelector(".source-ide-popover button")'));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});await pause(550);
  assert.equal(await evaluate('!!document.querySelector(".source-ide-popover")'),false,'Escape does not reopen timer');
  await evaluate('document.querySelector("button.source-select-line").click()');
  await pause(150);
  assert(await evaluate('document.querySelector(".source-focus-start")?.dataset.line === document.querySelector("button.source-select-line").closest("[data-line]").dataset.line'));
  await evaluate('document.querySelectorAll("button.source-select-line")[2].dispatchEvent(new MouseEvent("click",{bubbles:true,shiftKey:true}))');await pause(100);
  assert.equal(await evaluate('document.querySelectorAll(".source-focused-line").length'),3,'Shift-click range preserved');
  for(const width of [390,320]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate('document.querySelector("button.source-select-line").blur();document.querySelector("button.source-select-line").scrollIntoView({block:"center"})');await pause(150);await evaluate('document.querySelector("button.source-select-line").focus()');await pause(550);
    const fits=await evaluate('(()=>{const r=document.querySelector(".source-ide-popover").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()');assert(fits);
    await evaluate('document.activeElement.blur()');
  }

  await evaluate('document.querySelector("button.source-select-line").blur();document.querySelector("button.source-select-line").scrollIntoView({block:"center"})');await pause(150);
  await evaluate(`document.querySelectorAll('.code-workspace-toolbar button[aria-controls]').forEach(button=>{if(button.getAttribute('aria-pressed')==='true')button.click()})`);await pause(150);
  const touch=await evaluate('(()=>{const r=document.querySelector("button.source-select-line").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
  await send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await waitFor('!!document.querySelector(".source-ide-popover")');
  assert.equal(await evaluate('document.querySelectorAll(".source-focused-line").length'),1,'Touch preserves selection');
  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:1000,deviceScaleFactor:1,mobile:false});await pause(150);
  assert(await evaluate('!!document.querySelector(".source-ide-popover")'),'Resize repositions without dismissing');
  await evaluate('document.querySelector(".repository-source-scroll").scrollTop += 2');await pause(100);
  assert(await evaluate('!!document.querySelector(".source-ide-popover")'),'Scroll repositions without dismissing');
  await evaluate('document.querySelector(".source-ide-popover button").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await evaluate(`document.querySelector('button[aria-label="Expand source code"]').click()`);await waitFor('document.querySelector(".source-expanded")');
  await evaluate('document.querySelector(".dialog.repository-source-dialog").style.transform="translate(20px,10px)";document.querySelector(".source-expanded .source-select-line").focus()');await pause(550);
  assert(await evaluate('!!document.querySelector(".dialog .source-ide-popover")'),'Expanded reader keeps action inside accessible dialog');
  assert(await evaluate('(()=>{const b=document.querySelector(".source-ide-popover button");const r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b})()'),'Transformed dialog does not clip or cover the action');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab'});
  assert(await evaluate('document.activeElement===document.querySelector(".source-ide-popover button")'));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
  assert(await evaluate('!!document.querySelector(".source-expanded")'),'Escape dismisses action without closing reader');
  await evaluate('document.querySelector(".source-expanded .source-select-line").blur();location.hash="/learn"');await pause(600);
  assert.equal(await evaluate('!!document.querySelector(".source-ide-popover")'),false,'Unmount clears popup and timers');
  console.log('Move to IDE browser checks passed: delayed hover, persistent action, dismiss, keyboard, Escape, line/range selection and mobile viewport.');
  await send('Browser.close').catch(()=>{});
}finally{socket?.close();chrome.kill();server.kill();}
