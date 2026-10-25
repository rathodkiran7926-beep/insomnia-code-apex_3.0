import { spawn, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url)),
  run = randomUUID();
const origin = "http://127.0.0.1:3008";
const environment = {
  ...process.env,
  PORT: "3008",
  DATABASE_PATH: `${root}/data/journey-ui-${run}.sqlite`,
  LLM_API_KEY: "",
  ELEVENLABS_API_KEY: "",
};
// Isolated browser-test input, analyzed by the real parser. Never loaded into the user's database or production UI.
const seed = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
  import {analyze} from './src/analyzer.js'; import {db,saveSnapshot} from './src/storage.js';
  const files={
    'project/Account.tsx': "import {useState} from 'react'; export function Account(){const [name]=useState('');return <h1>{name}</h1>;}",
    'project/routes.ts': "import express from 'express'; import {validate,saveOrder} from './services'; const app=express(); app.post('/orders', handleOrder); app.get('/health',(req,res)=>res.json({ok:true})); function handleOrder(req,res) { validate(req.body); return res.json(saveOrder(req.body)); }",
    'project/services.ts': "export function validate(input) { if (!input.id) throw new Error('Missing id'); return true; }\\nexport function saveOrder(input) { return stamp(input); }\\nfunction stamp(input) { return {...input, accepted:true}; }"
  };
  const graph=analyze({repository:'https://github.com/test/checkout-flow',commit:'d'.repeat(40),files});
  // Keep one old-style callback label to verify saved snapshots need no reanalysis.
  for(const c of graph.components) if(c.nameKind==='callback_context') {const ref=graph.references.find(r=>r.id===c.referenceId);c.name='anonymous:'+ref.startLine;delete c.nameKind;}
  saveSnapshot(graph,{snapshotId:graph.snapshotId},'',files);
  db.prepare('INSERT INTO analysis_jobs VALUES (?,?,?,?,?,?)').run('journey-ui','complete',100,'Ready',graph.snapshotId,new Date().toISOString());
  console.log(JSON.stringify({snapshotId:graph.snapshotId}));
`,
  ],
  { cwd: root, windowsHide: true, encoding: "utf8", env: environment },
);
assert.equal(seed.status, 0, seed.stderr);
const { snapshotId } = JSON.parse(seed.stdout.trim());
const browser = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
assert(browser, "Chrome or Edge is required.");
const server = spawn(process.execPath, ["src/server.js"], {
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
    "--remote-debugging-port=9228",
    `--user-data-dir=${root}/data/journey-browser-${run}`,
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
        (await fetch("http://127.0.0.1:9228/json/version")).ok
      )
        break;
    } catch {}
    await pause(100);
  }
  const target = await (
    await fetch(`http://127.0.0.1:9228/json/new?${origin}/%23/journeys`, {
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
  await wait(
    `document.body.innerText.includes('Connect your repository first')`,
    "Missing repository did not show an honest empty state",
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('.codejourney-card').length`),
    0,
  );
  await evaluate(`localStorage.setItem('mentor-analysis-job','journey-ui')`);
  await send("Page.reload");
  await wait(
    `document.querySelectorAll('.codejourney-card').length>0`,
    "Actual analyzed repository journeys missing",
  );
  assert(
    await evaluate(
      `document.body.innerText.includes('test/checkout-flow') && !document.body.innerText.includes('separate from your selected')`,
    ),
  );
  assert(await evaluate("location.hash.startsWith('#/learn')"), 'Old library URL did not redirect');
  assert(await evaluate("!document.querySelector('.mentor-navigation a[href=\"#/journeys\"]')"), 'Separate journey navigation remains');
  await evaluate("location.hash='/learn'");
  await wait("document.body.innerText.includes('Add your skills to get personalized code journeys.')", 'Missing skills state absent');
  assert(await evaluate("document.querySelector('.learning-sections button[aria-pressed=true]').textContent==='For You'"), 'For You must be default');
  await click('Add skills');
  await wait("document.querySelector('input[aria-label=\"Your skills\"]')", 'Existing learner preferences did not open');
  await fill('input[aria-label="Your skills"]', 'express.js, TS');
  await click('Save preferences');
  await wait("document.querySelectorAll('.codejourney-card').length>0 && document.querySelector('.learning-reason')", 'Skills did not update recommendations');
  assert(await evaluate("document.querySelector('.learning-skills-row').innerText.includes('Express') && document.querySelector('.learning-skills-row').innerText.includes('TypeScript')"), 'Skills aliases not normalized');
  const libraryScreenshot = await send('Page.captureScreenshot', {format:'png',captureBeyondViewport:false});
  writeFileSync(root+'/data/learning-path-desktop.png',Buffer.from(libraryScreenshot.data,'base64'));
  await click('Edit');
  await wait("document.querySelector('input[aria-label=\"Your skills\"]')", 'Preferences could not reopen');
  await fill('input[aria-label="Your skills"]', 'Rust');
  await click('Save preferences');
  await wait("document.body.innerText.includes('No strong matches yet')", 'Weak skill matches were invented');
  await click('Edit');
  await wait("document.querySelector('input[aria-label=\"Your skills\"]')", 'Skills editor missing');
  await fill('input[aria-label="Your skills"]', 'React');
  await click('Save preferences');
  await wait("Boolean([...document.querySelectorAll('.codejourney-card')].find(e=>e.innerText.includes('Explore Account') && e.innerText.includes('Skill match')))", 'React did not match real React component source');
  assert(await evaluate("document.querySelector('.codejourney-card .learning-reason').innerText.includes('know React')"), 'React match reason missing');
  await click('Edit');
  await wait("document.querySelector('input[aria-label=\"Your skills\"]')", 'Skills editor missing');
  await fill('input[aria-label="Your skills"]', 'Rust');
  await click('Save preferences');
  await wait("document.body.innerText.includes('No strong matches yet')", 'Unrelated skills were given React recommendations');
  await click('All Journeys');
  await wait("document.querySelectorAll('.codejourney-card').length>0", 'Missing skills blocked browsing');
  await send('Page.reload');
  await wait("document.querySelector('.learning-skills-row')?.innerText.includes('Rust')", 'Skills preference did not persist');
  await fill('input[aria-label="Find a CodeJourney"]', "POST /orders");
  await wait(
    `document.querySelectorAll('.codejourney-card').length===1`,
    "Actual route search failed",
  );
  await click("Start journey");
  await wait(
    `document.querySelector('.journey-theater')`,
    "Theater did not open",
  );
  const newPlayerHash = await evaluate('location.hash');
  assert(newPlayerHash.startsWith('#/learn/'), 'New cards must use Learning Path player URLs');
  await evaluate("location.hash="+JSON.stringify(newPlayerHash.replace('#/learn/','#/journeys/')));
  await wait("location.hash.startsWith('#/learn/') && document.querySelector('.journey-theater')", 'Old player URL did not redirect');
  await wait(
    `document.querySelector('.journey-source-panel .source-focused-line')`,
    "Selected source was not highlighted",
  );
  await wait(
    `document.querySelector('.journey-canvas .react-flow__node')`,
    "Journey canvas did not load",
  );
  await pause(350);
  const cursorBeforePan = await evaluate(
    `document.querySelector('.journey-theater').dataset.eventId`,
  );
  const viewportBeforePan = await evaluate(
    `document.querySelector('.journey-canvas .react-flow__viewport').style.transform`,
  );
  async function dragAt(point, dx, dy) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    for (let step = 1; step <= 6; step++)
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: point.x + (dx * step) / 6,
        y: point.y + (dy * step) / 6,
        button: "left",
        buttons: 1,
      });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x + dx,
      y: point.y + dy,
      button: "left",
      clickCount: 1,
    });
    await pause(150);
  }
  // Bring the actual canvas into the viewport before sending pointer coordinates.
  await evaluate(
    `document.querySelector('.journey-canvas').scrollIntoView({block:'center'})`,
  );
  const visibleCanvasPoint = await evaluate(
    `(()=>{const r=document.querySelector('.journey-canvas').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height-60};})()`,
  );
  await dragAt(visibleCanvasPoint, 75, -30);
  assert.notEqual(
    await evaluate(
      `document.querySelector('.journey-canvas .react-flow__viewport').style.transform`,
    ),
    viewportBeforePan,
    "Dragging the background must pan the canvas",
  );
  const beforeZoom = await evaluate(
    `document.querySelector('.journey-canvas .react-flow__viewport').style.transform`,
  );
  await click("Zoom in journey");
  await pause(300);
  assert.notEqual(
    await evaluate(
      `document.querySelector('.journey-canvas .react-flow__viewport').style.transform`,
    ),
    beforeZoom,
    "Zoom control did not change the viewport",
  );
  await click("Fit journey to view");
  await pause(350);
  const nodeBefore = await evaluate(
    `document.querySelector('.journey-canvas .react-flow__node').style.transform`,
  );
  const nodePoint = await evaluate(
    `(()=>{const r=document.querySelector('.journey-canvas .react-flow__node').getBoundingClientRect();return {x:r.left+30,y:r.top+25};})()`,
  );
  await dragAt(nodePoint, 40, 25);
  assert.notEqual(
    await evaluate(
      `document.querySelector('.journey-canvas .react-flow__node').style.transform`,
    ),
    nodeBefore,
    "Journey nodes must be repositionable",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.journey-theater').dataset.eventId`,
    ),
    cursorBeforePan,
    "Moving the canvas or a node must not move playback",
  );
  await wait(
    `document.querySelector('.journey-question-panel:not([hidden])')`,
    "Desktop mentor should open with the journey",
  );
  await wait(
    `document.querySelector('.journey-chat-heading img')?.naturalWidth > 0`,
    "Mentor image did not load",
  );
  await wait(
    `document.querySelector('.journey-auto-explanation p')`,
    "Automatic explanation missing",
  );
  assert(
    await evaluate(
      `document.querySelectorAll('.journey-explanation-steps li').length>=4 && document.querySelector('.journey-explanation-steps').innerText.includes('Declared inputs')`,
    ),
    "The route walkthrough should include details from its linked handler",
  );
  assert(
    await evaluate(`document.body.innerText.includes('Event 1 of')`),
    "A new journey must select its first component",
  );
  assert(
    await evaluate(
      `(()=>{const p=document.querySelector('.journey-question-panel').getBoundingClientRect(),h=document.querySelector('.topbar').getBoundingClientRect();return Math.abs(p.top-h.bottom)<2&&Math.abs(p.bottom-innerHeight)<2&&Math.abs(p.width-400)<2;})()`,
    ),
    "Drawer must fill the desktop height below the app header",
  );
  assert(
    await evaluate(
      `getComputedStyle(document.querySelector('.journey-chat-scroll')).overflowY==='auto' && !document.querySelector('.journey-learning-panel')`,
    ),
    "Old mentor card should be removed and drawer middle must scroll",
  );
  assert(
    await evaluate(
      `(()=>{const c=document.querySelector('.journey-source-panel').getBoundingClientRect(),t=document.querySelector('.journey-timeline-panel').getBoundingClientRect();return Math.abs(c.width-t.width)<2&&c.top>=t.bottom;})()`,
    ),
    "Code must span the workspace directly below the diagram",
  );
  await evaluate(
    `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
  );
  await wait(
    `document.querySelector('.journey-question-panel[hidden]')`,
    "Close did not collapse the chat",
  );
  await wait(
    `document.activeElement?.getAttribute('aria-label')==='Ask Shishimaru'`,
    "Closing the chat did not restore keyboard focus",
  );
  assert(
    await evaluate(
      `document.querySelector('.journey-theater').dataset.traceId.includes(${JSON.stringify(snapshotId)})`,
    ),
  );
  const first = await evaluate(
    `document.querySelector('.journey-theater').dataset.eventId`,
  );
  await click("Ask Shishimaru");
  await evaluate(`(()=>{
    const original=window.fetch.bind(window);window.summaryRequests=[];
    window.delayNextSummary=true;
    window.fetch=async(...args)=>{
      const url=String(args[0]);
      if(!url.includes('/explanation?'))return original(...args);
      window.summaryRequests.push(url);
      const delay=window.delayNextSummary?1000:0;window.delayNextSummary=false;
      const response=await original(...args);
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      return response;
    };
  })()`);
  await click("Next event");
  const second = await evaluate(
    `document.querySelector('.journey-theater').dataset.eventId`,
  );
  assert.notEqual(second, first);
  await wait(
    `window.summaryRequests.length>0`,
    "Automatic request did not start for the new component",
  );
  assert(
    await evaluate(
      `Boolean(document.querySelector('.journey-summary-skeleton'))`,
    ),
    "Explanation loading skeleton missing",
  );
  await click("Back");
  await click("Next event");
  await click("Restart");
  await pause(1200);
  assert.equal(
    await evaluate(
      `document.querySelector('.journey-question-panel').dataset.eventId`,
    ),
    first,
    "Delayed explanation changed the drawer's active component",
  );
  assert(
    await evaluate(
      `document.querySelector('.journey-auto-explanation p').textContent.includes('POST /orders')`,
    ),
    "A delayed reply overwrote the current component explanation",
  );
  await click("Next event");
  await wait(
    `document.querySelector('.journey-auto-explanation p')?.textContent.includes('handleOrder')`,
    "Cached explanation missing",
  );
  assert.equal(
    await evaluate(`window.summaryRequests.length`),
    1,
    "Revisiting the same source should reuse its cached explanation",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.journey-question-panel').dataset.eventId`,
    ),
    second,
  );
  await evaluate(
    `document.querySelector('.journey-component-details').open=true`,
  );
  await click("advanced");
  assert(
    await evaluate(
      `document.querySelector('.journey-code-explanation').innerText.includes('req, res') && document.querySelector('.journey-code-explanation').innerText.includes('res.json(saveOrder(req.body))')`,
    ),
    "Code explanation must show the selected handler's actual inputs and return expression",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.journey-theater').dataset.eventId`,
    ),
    second,
  );
  // Explained repository questions now support guests; register only if a gate is present.
  if (await evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='New here? Create an account')`)) {
  await click("New here? Create an account");
  await fill("input[name=name]", "Repository learner");
  await fill("input[name=email]", `journey-${run}@test.example`);
  await fill("input[name=password]", "local browser password 123");
  await click("Create account & workspace");
  }
  await wait(
    `document.querySelector('textarea[aria-label="Question about playback event"]')`,
    "Question gate failed",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.journey-theater').dataset.eventId`,
    ),
    second,
    "Account gate moved the cursor",
  );
  await fill(
    'textarea[aria-label="Question about playback event"]',
    "What source connections does this component have?",
  );
  await click("Close question");
  await click("Ask Shishimaru");
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="Question about playback event"]').value`,
    ),
    "What source connections does this component have?",
    "Closing the drawer lost the draft",
  );
  await evaluate(
    `document.querySelector('.journey-question-panel form:has(textarea)').requestSubmit()`,
  );
  await wait(
    `document.querySelector('.journey-anchored-answer')`,
    "Event answer failed",
  );
  assert(
    await evaluate(
      `document.querySelectorAll('.journey-answer-body p').length>=3 && !document.querySelector('.journey-answer-body').innerText.includes('Only this event and its supplied source')`,
    ),
    "Replies should use readable paragraphs without the old generic boilerplate",
  );
  assert(
    await evaluate(
      `(()=>{const reply=document.querySelector('.journey-anchored-answer'),scroll=document.querySelector('.journey-chat-scroll');return reply.scrollWidth<=reply.clientWidth+1&&reply.getBoundingClientRect().top>=scroll.getBoundingClientRect().top-2&&reply.getBoundingClientRect().top<scroll.getBoundingClientRect().bottom;})()`,
    ),
    "The reply should wrap and be revealed inside the drawer",
  );
  const chatScreenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  writeFileSync(
    `${root}/data/shishimaru-chat.png`,
    Buffer.from(chatScreenshot.data, "base64"),
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.journey-theater').dataset.eventId`,
    ),
    second,
  );
  await click("Play");
  await wait(
    `document.querySelector('.journey-theater').dataset.eventId!==${JSON.stringify(second)}`,
    "Playback did not advance with the drawer open",
  );
  await click("Pause");
  assert(
    await evaluate(
      `document.querySelector('.journey-question-panel').dataset.eventId===document.querySelector('.journey-theater').dataset.eventId && document.querySelector('.journey-chat-event h2').textContent==='validate'`,
    ),
    "Playback must synchronize the drawer title with the current component",
  );
  assert(
    await evaluate(
      `!document.querySelector('.journey-anchored-answer') && document.querySelector('textarea[aria-label="Question about playback event"]').value===''`,
    ),
    "A component must not display the previous component's question or answer",
  );
  await click("Back");
  await evaluate(
    `document.querySelector('.journey-canvas .react-flow__node[data-id="'+${JSON.stringify(first)}+'"]')?.click()`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.journey-question-panel').dataset.eventId`,
    ),
    first,
    "Clicking a visited diagram node must update the active drawer context",
  );
  await click("Next event");
  await click("Close question");
  await click("Next event");
  await wait(
    `document.querySelector('.journey-source-panel [aria-label^="Source code: project/services.ts"]') && document.querySelector('.journey-source-panel .source-focused-line')`,
    "Cross-file source synchronization failed",
  );
  const third = await evaluate(
    `document.querySelector('.journey-theater').dataset.eventId`,
  );
  await pause(400);
  await evaluate(
    `(()=>{const url=new URL(location.href),[path,query]=url.hash.slice(1).split('?'),params=new URLSearchParams(query);params.set('resume','1');url.hash=path+'?'+params;history.replaceState(null,'',url);})()`,
  );
  await send("Page.reload");
  await wait(
    `document.querySelector('.journey-theater')?.dataset.eventId===${JSON.stringify(third)}`,
    "Saved cursor did not resume",
  );
  await wait(
    `document.querySelector('.journey-source-panel .source-focused-line')`,
    "Resumed source did not finish loading",
  );
  await click("Zoom to source");
  await wait(
    `document.querySelector('.repository-source-dialog')`,
    "Source expansion failed",
  );
  await evaluate(
    `document.querySelector('.repository-source-dialog button[aria-label="Close dialog"]').click()`,
  );
  for (let i = 0; i < 12; i++) {
    if (await evaluate(`Boolean(document.querySelector('.journey-complete'))`))
      break;
    const last = await evaluate(
      `Boolean([...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Finish journey'&&!e.disabled))`,
    );
    await click(last ? "Finish journey" : "Next event");
    await pause(80);
  }
  await wait(
    `document.querySelector('.journey-complete')`,
    "Completion failed",
  );
  assert(
    !(await evaluate(
      `document.body.innerText.includes('Run approved scenario')`,
    )),
    "Repository must not offer a sample runner",
  );
  await pause(300);
  await evaluate(
    `(()=>{const e=document.querySelector('select[aria-label="Journey scenario"]');e.value=e.options[1].value;e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await wait(
    `document.body.innerText.includes('Event 1 of') && !document.querySelector('.journey-complete')`,
    "Alternate graph path did not reset cursor",
  );
  await wait(
    `document.querySelectorAll('.journey-explanation-steps li').length>=3`,
    "Default panel did not explain the new path",
  );
  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  writeFileSync(
    `${root}/data/codejourney-theater.png`,
    Buffer.from(screenshot.data, "base64"),
  );
  if (
    await evaluate(
      `Boolean(document.querySelector('.journey-question-panel:not([hidden])'))`,
    )
  )
    await click("Close question");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await pause(200);
  assert(
    await evaluate(`document.documentElement.scrollWidth<=innerWidth+2`),
    "Mobile overflow",
  );
  await send("Page.reload");
  await wait(
    `document.querySelector('.journey-question-panel:not([hidden])')`,
    "Mobile journey must open the mentor automatically",
  );
  await wait(
    `document.querySelectorAll('.journey-explanation-steps li').length>=3`,
    "Mobile explanation should appear without a click",
  );
  assert(
    await evaluate(
      `(()=>{const r=document.querySelector('.journey-question-panel').getBoundingClientRect(),h=document.querySelector('.topbar').getBoundingClientRect();return Math.abs(r.left)<1&&Math.abs(r.width-innerWidth)<2&&Math.abs(r.top-h.bottom)<2&&Math.abs(r.bottom-innerHeight)<2;})()`,
    ),
    "Mobile chat does not fit the screen",
  );
  await click("Close question");
  const mobileCursor = await evaluate(
    `document.querySelector('.journey-theater').dataset.eventId`,
  );
  assert(
    await evaluate(
      `document.querySelector('.journey-mentor-launcher').getBoundingClientRect().width<=60`,
    ),
    "Closed panel must use a small mentor icon",
  );
  await click("Ask Shishimaru");
  assert.equal(
    await evaluate(
      `document.querySelector('.journey-theater').dataset.eventId`,
    ),
    mobileCursor,
    "Reopening the mentor must preserve playback",
  );
  const mobileScreenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  writeFileSync(
    `${root}/data/shishimaru-mobile.png`,
    Buffer.from(mobileScreenshot.data, "base64"),
  );
  await click("Close question");
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  assert(
    await evaluate(
      `getComputedStyle(document.querySelector('.journey-chat-heading .journey-brand-mentor img')).animationName==='none'`,
    ),
    "Reduced motion ignored",
  );
  await evaluate(`location.hash='/journeys'`);
  await wait(
    `Boolean([...document.querySelectorAll('.journey-library-tabs button')].find(e=>e.textContent.replace(/\s/g,'')==='Completed1'))`,
    "Main path completion was lost after exploring an alternate path",
  );
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth + 2'), 'Mobile Learning Path overflows');
  const libraryMobile = await send('Page.captureScreenshot', {format:'png',captureBeyondViewport:false});
  writeFileSync(root+'/data/learning-path-mobile.png',Buffer.from(libraryMobile.data,'base64'));
  // A saved unfinished path must not bypass the current skill filter.
  await evaluate("(()=>{const key='mentor-codejourney-progress-v1';const saved=JSON.parse(localStorage.getItem(key)||'{}');const entry=Object.values(saved)[0];if(!entry)throw Error('Expected saved progress');entry.completed=false;entry.completedScenarios=[];localStorage.setItem(key,JSON.stringify(saved));location.hash='/learn';})()");
  await send('Page.reload');
  await wait("document.body.innerText.includes('No strong matches yet')", 'Saved progress bypassed the unmatched Rust skill');
  assert.equal(await evaluate("document.querySelectorAll('.codejourney-card').length"),0,'Unrelated journey recommended');
  await click('All Journeys');
  await wait("Boolean([...document.querySelectorAll('.codejourney-card-actions a')].find(e=>e.textContent.includes('Continue journey')))", 'Unmatched saved journey was lost from All Journeys');
  const presentedSnapshot=await (await fetch(origin+'/api/snapshots/'+snapshotId)).json();
  assert(!presentedSnapshot.components.some(c=>/^anonymous:/.test(c.name)), 'Old snapshot labels were not upgraded for display');
  assert(presentedSnapshot.components.some(c=>c.name==='GET /health handler'), 'Source-derived handler label missing');
  await fill('input[aria-label="Find a CodeJourney"]','GET /health');
  await click('Start journey');
  await wait("document.querySelector('.journey-theater')", 'Saved callback journey did not open');
  await click('Next event');
  await wait("document.querySelector('.journey-canvas').innerText.includes('GET /health handler')", 'Playback node kept anonymous callback label');
  assert(!await evaluate("document.querySelector('.journey-canvas').innerText.includes('anonymous:')"),'Playback shows anonymous placeholder');
  await evaluate("location.hash='/progress'");
  await wait("document.querySelector('.repository-progress-page')", 'Repository progress page failed to render');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Prepared sample activity').click()");
  await wait("document.querySelector('.progress-report-page') && document.querySelectorAll('.progress-skill-row').length===5", 'Merged progress report or skill map failed to render');
  assert(await evaluate("document.querySelector('.mentor-navigation a[href=\"#/progress\"]').textContent.trim()==='My Progress'"), 'Existing My Progress navigation label was lost');
  assert(await evaluate("document.documentElement.scrollWidth<=innerWidth+2"), 'Merged progress report overflows mobile width');
  await send('Emulation.setEmulatedMedia', {media:'print'});
  assert(await evaluate("getComputedStyle(document.querySelector('.progress-print-report')).display!=='none'"), 'Merged print report is unavailable');
  await send('Emulation.setEmulatedMedia', {media:'screen'});
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "Repository CodeJourney browser checks passed: empty state without examples, actual parser/snapshot library, cross-file source highlighting, event questions, cursor resume, completion, alternate paths, mobile and reduced motion. No repository execution or paid provider calls.",
  );
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
