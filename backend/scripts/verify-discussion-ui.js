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
const server = spawn(process.execPath, ["scripts/discussion-test-server.js"], {
  cwd: root,
  windowsHide: true,
  env: {
    ...process.env,
    PORT: "3004",
    DISCUSSION_TEST_PROVIDER: "1",
    DATABASE_PATH: root + "/data/discussion-ui-verification.sqlite",
  },
  stdio: "ignore",
});
// which is remaing to build in 24 hackthon 
const chrome = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "--remote-debugging-port=9224",
    `--user-data-dir=${root}/data/discussion-browser-profile`,
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
        (await fetch("http://127.0.0.1:3004/api/health")).ok &&
        (await fetch("http://127.0.0.1:9224/json/version")).ok
      )
        break;
    } catch {}
    await pause(100);
  }
  const db = new DatabaseSync(
    root + "/data/discussion-ui-verification.sqlite",
    {
      readOnly: true,
    },
  );
  const job = db
    .prepare(
      "SELECT * FROM analysis_jobs WHERE status='complete' ORDER BY created_at DESC LIMIT 1",
    )
    .get();
  db.close();
  assert(job, "Run npm run verify:http first");

  const target = await (
    await fetch(
      "http://127.0.0.1:9224/json/new?http://127.0.0.1:3004/%23/repository",
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
  const graph = await (
    await fetch(`http://127.0.0.1:3004/api/snapshots/${job.snapshot_id}`)
  ).json();
  const component = graph.components.find(
    (c) => c.name === "limit" && c.role !== "module",
  );
  await evaluate(
    `localStorage.setItem('mentor-analysis-job',${JSON.stringify(job.id)});localStorage.setItem('mentor-discussion-voice','test-account-one');sessionStorage.removeItem('mentor-last-discussion');location.hash=${JSON.stringify("/workspace?component=" + encodeURIComponent(component.id) + "&discuss=1")}`,
  );
  await send("Page.reload");
  await waitFor(
    "document.querySelector('.component-discussion') && document.querySelectorAll('[aria-label=\"Discussion reply voice\"] option').length===3",
  );
  const click = (label) =>
    evaluate(
      `Array.from(document.querySelectorAll('.component-discussion button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const enter = (selector, value) =>
    evaluate(
      `{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));}`,
    );
  await evaluate(
    "window.__nativeDiscussionAudio=Audio;window.Audio=function(...args){const player=new window.__nativeDiscussionAudio(...args);window.__lastDiscussionAudio=player;return player;}",
  );
  await evaluate("document.querySelector('.discussion-start button').click()");
  await waitFor(
    "!document.querySelector('.discussion-suggestions button').disabled",
  );
  await evaluate(
    "document.querySelector('.discussion-suggestions button').click()",
  );
  await waitFor("document.querySelector('.discussion-message.assistant')");
  await waitFor("document.querySelector('.discussion-state.speaking')");
  await waitFor(
    "window.__lastDiscussionAudio && !window.__lastDiscussionAudio.paused && window.__lastDiscussionAudio.currentTime > 0",
  );
  await click("Stop playback");
  assert(await evaluate("window.__lastDiscussionAudio.paused"));
  assert(
    await evaluate(
      "document.querySelector('.discussion-citations a').href.includes('/blob/')",
    ),
  );
  await evaluate(
    "document.querySelector('.discussion-voice > summary').click();const el=document.querySelector('[aria-label=\"Discussion reply voice\"]');el.value='test-account-two';el.dispatchEvent(new Event('change',{bubbles:true}));",
  );
  await click("Save voice");
  await click("Preview");
  await waitFor("document.querySelector('.discussion-state.speaking')");
  await click("Stop playback");
  assert.equal(
    await evaluate("localStorage.getItem('mentor-discussion-voice')"),
    "test-account-two",
  );
  await evaluate(
    "window.__originalMicrophone=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError')}",
  );
  await click("Record");
  await waitFor(
    "document.querySelector('.component-discussion [role=alert]')?.textContent.includes('denied')",
  );
  await evaluate(
    "navigator.mediaDevices.getUserMedia=window.__originalMicrophone",
  );
  await click("Record");
  await waitFor("document.querySelector('.discussion-state.listening')");
  await pause(1200);
  await click("Stop recording");
  await waitFor(
    "document.querySelector('#discussion-question').value.includes('multiple backend instances')",
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.discussion-message.assistant').length",
    ),
    1,
    "Transcription must not auto-send",
  );
  await enter(
    "#discussion-question",
    "What happens with multiple instances? Do not choose an option yet.",
  );
  await evaluate(
    "window.__discussionOriginalFetch=fetch.bind(window);window.fetch=async(input,options)=>{if(String(input).endsWith('/speech')){window.fetch=window.__discussionOriginalFetch;return new Response(JSON.stringify({error:'Simulated voice service failure. Text answer remains available.'}),{status:503,headers:{'Content-Type':'application/json'}})}return window.__discussionOriginalFetch(input,options)}",
  );
  await click("Send");
  await waitFor(
    "document.querySelectorAll('.discussion-message.assistant').length===2",
  );
  await waitFor(
    "document.querySelector('.component-discussion [role=alert]')?.textContent.includes('voice service failure')",
  );
  assert(
    await evaluate(
      "document.querySelectorAll('.discussion-message.assistant').length===2",
    ),
  );
  await click("Replay latest answer");
  await waitFor("document.querySelector('.discussion-state.speaking')");
  await click("Stop playback");
  await evaluate(
    "document.querySelector('.discussion-decision > summary').click()",
  );
  // Exercise the real recorder / auto-submit / speech / listen-again loop.
  // Only waveform amplitude is controlled; remote providers remain isolated fixtures.
  const beforeLive = await evaluate("document.querySelectorAll('.discussion-message.assistant').length");
  await evaluate(`window.__originalWaveform=AnalyserNode.prototype.getFloatTimeDomainData;
    window.__liveAnalysers=new WeakMap();window.__voiceBursts=1;
    AnalyserNode.prototype.getFloatTimeDomainData=function(samples){
      let state=window.__liveAnalysers.get(this);
      if(!state){state={allowed:window.__voiceBursts-->0,count:0};window.__liveAnalysers.set(this,state);}
      samples.fill(state.allowed && state.count++<8 ? 0.06 : 0);
    };`);
  await click("Start live voice");
  await waitFor(`document.querySelectorAll('.discussion-message.assistant').length===${beforeLive + 1}`);
  await waitFor("document.querySelector('.discussion-state.speaking')");
  await waitFor("document.querySelector('.discussion-state.listening')");
  assert(await evaluate("Array.from(document.querySelectorAll('.component-discussion button')).some(b=>b.textContent.trim()==='End conversation')"));
  const liveSessionId = await evaluate("sessionStorage.getItem('mentor-last-discussion')");
  await click("Pause microphone");
  await waitFor("document.querySelector('.call-muted')");
  assert(!(await evaluate("!!document.querySelector('.discussion-state.listening')")));
  assert.equal(await evaluate("sessionStorage.getItem('mentor-last-discussion')"), liveSessionId);
  await click("Resume microphone");
  await waitFor("document.querySelector('.discussion-state.listening')");
  assert(await evaluate("!!document.querySelector('.discussion-platform-icon')"));
  assert(await evaluate("(()=>{const r=document.querySelector('.discussion-call-dock.is-active').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight})()"), "Active call controls remain in view");
  assert(await evaluate("document.querySelector('.discussion-microphone.is-call-active').getBoundingClientRect().height<260"), "Side-panel call card stays compact");
  const callImage = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(root + "/data/ui-mentor-active-call.png", Buffer.from(callImage.data, "base64"));

  await evaluate("document.querySelector('[aria-label=\"Open centered conversation\"]').click()");
  await waitFor("document.querySelector('.mentor-voice-dialog')");
  assert(await evaluate("document.querySelector('.mentor-voice-dialog').getBoundingClientRect().width>700"));
  assert(await evaluate("!!document.querySelector('.mentor-voice-dialog .discussion-state.listening')"));
  assert(await evaluate("document.querySelector('.mentor-voice-dialog .discussion-microphone').getBoundingClientRect().height<200"), "Desktop dialog call card stays compact");
  let compactShot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(root + "/data/ui-compact-voice-desktop.png", Buffer.from(compactShot.data, "base64"));
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert(await evaluate("document.querySelector('.mentor-voice-dialog .discussion-microphone').getBoundingClientRect().height<260"), "Mobile call card stays compact");
  assert(await evaluate("(()=>{const dock=document.querySelector('.discussion-call-dock');return dock.scrollHeight<=dock.clientHeight+1})()"), "Call card has no nested scrollbar");
  compactShot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(root + "/data/ui-compact-voice-mobile.png", Buffer.from(compactShot.data, "base64"));
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });

  assert.equal(await evaluate("sessionStorage.getItem('mentor-last-discussion')"), liveSessionId);
  await evaluate("document.querySelector('.mentor-voice-dialog [aria-label=\"Close dialog\"]').click()");
  await waitFor("!document.querySelector('.mentor-voice-dialog')");
  assert(await evaluate("!!document.querySelector('.discussion-state.listening')"));
  await click("End conversation");
  await pause(400);
  assert(!(await evaluate("!!document.querySelector('.discussion-state.listening')")));
  await evaluate("window.__voiceBursts=1");
  await click("Start live voice");
  await waitFor(`document.querySelectorAll('.discussion-message.assistant').length===${beforeLive + 2}`);
  await waitFor("document.querySelector('.discussion-state.speaking') && window.__lastDiscussionAudio && !window.__lastDiscussionAudio.paused");
  await click("Interrupt & speak");
  assert(await evaluate("window.__lastDiscussionAudio.paused"));
  await waitFor("document.querySelector('.discussion-state.listening')");
  await click("End conversation");
  await evaluate("AnalyserNode.prototype.getFloatTimeDomainData=window.__originalWaveform");
  await click("Draft decision");
  await waitFor(
    "document.querySelector('[aria-label=\"Decision draft\"]')?.value.includes('Decision pending')",
  );
  const sessionId = await evaluate(
    "sessionStorage.getItem('mentor-last-discussion')",
  );
  let session = await (
    await fetch(`http://127.0.0.1:3004/api/discussions/${sessionId}`)
  ).json();
  assert.equal(
    session.savedDecisions.length,
    0,
    "Drafting cannot save a decision",
  );
  const draft = await evaluate(
    "document.querySelector('[aria-label=\"Decision draft\"]').value",
  );
  await enter(
    '[aria-label="Decision draft"]',
    draft + "\nReviewed in the isolated browser test.",
  );
  await click("Save decision");
  await waitFor(
    "document.querySelector('.discussion-decision').textContent.includes('Decision saved for')",
  );
  session = await (
    await fetch(`http://127.0.0.1:3004/api/discussions/${sessionId}`)
  ).json();
  assert.equal(session.savedDecisions.length, 1);
  await evaluate(
    "document.querySelector('.mentor-file[title=\"app.ts\"]').click()",
  );
  await waitFor(
    "document.querySelector('.discussion-start')?.textContent.includes('conversation remains attached')",
  );
  assert(
    await evaluate(
      "document.querySelector('.discussion-suggestions button').disabled",
    ),
  );
  await evaluate("document.querySelector('.discussion-start button').click()");
  await waitFor(
    "!document.querySelector('.discussion-suggestions button').disabled",
  );
  const newSessionId = await evaluate(
    "sessionStorage.getItem('mentor-last-discussion')",
  );
  assert.notEqual(newSessionId, sessionId);
  await enter("#discussion-question", "slow verification");
  await click("Send");
  await waitFor("document.querySelector('.discussion-state.thinking')");
  await evaluate(
    "document.querySelector('.mentor-file[title=\"limiter.ts\"]').click()",
  );
  await pause(1600);
  const stale = await (
    await fetch(`http://127.0.0.1:3004/api/discussions/${newSessionId}`)
  ).json();
  assert.equal(
    stale.messages.length,
    0,
    "Cancelled old-selection replies must not persist",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await pause(200);
  await evaluate("document.querySelector('.mentor-voice-launch').click()");
  await waitFor("document.querySelector('button[aria-label=\"Open centered conversation\"]')");
  await evaluate("document.querySelector('button[aria-label=\"Open centered conversation\"]').click()");
  await waitFor("document.querySelector('.mentor-voice-dialog')");
  assert(
    await evaluate("document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('.mentor-voice-dialog').getBoundingClientRect().width<=innerWidth"),
    "Discussion should fit a phone screen",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const image = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    root + "/data/ui-component-discussion.png",
    Buffer.from(image.data, "base64"),
  );
  const { readFileSync } = await import("node:fs");
  const trace = JSON.parse(
    readFileSync(root + "/data/discussion-ui-provider-trace.json", "utf8"),
  );
  assert(
    trace.voiceIds.includes("test-account-one") &&
      trace.voiceIds.includes("test-account-two"),
  );
  assert.equal(trace.transcriptions, 3);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        checks: [
          "component-bound discussion",
          "source citations",
          "voice selection and preference",
          "speech playback and stop",
          "text discussion survives voice-provider failure",
          "microphone denial",
          "browser recording and editable transcription",
          "explicit-send only",
          "hands-free auto-submit and listen again after spoken reply",
          "pause and resume microphone preserves the conversation",
          "end conversation stops microphone",
          "interrupt spoken answer and resume listening",
          "centered conversation preserves active voice and session",
          "workspace voice launcher and mobile conversation layout",
          "draft decision pending",
          "save only on click",
          "component-change banner",
          "stale request cancellation",
          "mobile layout",
        ],
        providers: "isolated test providers; no production mock replies",
      },
      null,
      2,
    ),
  );
  await send("Browser.close").catch(() => {});
} finally {
  socket?.close();
  chrome.kill();
  server.kill();
}
