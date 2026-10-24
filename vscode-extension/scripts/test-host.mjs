import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { driveWorkbench } from '../test/ui-driver.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const backendRoot = path.resolve(root, '../backend');
const executable = process.env.VSCODE_EXECUTABLE_PATH ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs/Microsoft VS Code/Code.exe');
const portServer = createServer();
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
const port = portServer.address().port;
await new Promise(resolve => portServer.close(resolve));
const base = `http://127.0.0.1:${port}`;
await mkdir(path.join(root, '.host-test'), { recursive: true });
const runRoot = await mkdtemp(path.join(root, '.host-test/phase2-'));
const inputs = [];
const fixtureSource = 'export function greet(name: string) {\n  if (!name) throw new Error("Missing name");\n  return `Hello ${name}`;\n}\n\nexport function farewell(name: string) {\n  return `Goodbye ${name}`;\n}\n';
const fixtureFolders = [];
const emptyHooks = path.join(runRoot, 'empty-hooks'); await mkdir(emptyHooks);
for (const name of ['one', 'two']) {
  const folder = path.join(runRoot, name); fixtureFolders.push(folder);
  await mkdir(path.join(folder, 'src'), { recursive: true });
  await writeFile(path.join(folder, 'src/index.ts'), fixtureSource);
  const git = args => execFileSync('git', ['-c', `core.hooksPath=${emptyHooks}`, '-C', folder, ...args], { windowsHide: true, encoding: 'utf8' }).trim();
  git(['init', '--initial-branch=main', `--template=${emptyHooks}`]); git(['add', '.']);
  git(['-c', 'user.name=Mentor Test', '-c', 'user.email=mentor-test@example.invalid', 'commit', '-m', 'Fixture']);
  const olderCommit = git(['rev-parse', 'HEAD']);
  if (name === 'one') git(['-c', 'user.name=Mentor Test', '-c', 'user.email=mentor-test@example.invalid', 'commit', '--allow-empty', '-m', 'Second fixture revision']);
  git(['remote', 'add', 'origin', `git@github.com:mentor-fixtures/${name}.git`]);
  inputs.push({ repository: `https://github.com/mentor-fixtures/${name}`, commit: git(['rev-parse', 'HEAD']), files: { 'src/index.ts': fixtureSource } });
  if (name === 'one') inputs.push({ repository: `https://github.com/mentor-fixtures/${name}`, commit: olderCommit, files: { 'src/index.ts': fixtureSource } });
}
const workspaceFile = path.join(runRoot, 'multi.code-workspace');
await writeFile(workspaceFile, JSON.stringify({ folders: fixtureFolders.map((folder, index) => ({ path: folder, name: index === 0 ? 'Folder one' : 'Folder two' })) }));
await build({ entryPoints: ['test/host.ts'], outfile: '.host-test/index.js', bundle: true, external: ['vscode'], platform: 'node', format: 'cjs', target: 'node20' });
const harness = path.join(runRoot, 'test-harness');
await mkdir(harness, { recursive: true });
await writeFile(path.join(harness, 'package.json'), JSON.stringify({
  name: 'mentor-phase2-test-harness', publisher: 'mentor-tests', version: '0.0.1',
  engines: { vscode: '^1.100.0' }, main: './index.js', activationEvents: ['onStartupFinished'],
}));
await build({
  stdin: { contents: `import {run} from './test/host'; import {writeFile} from 'node:fs/promises'; import * as vscode from 'vscode'; export function activate() { void run().then(() => writeFile(process.env.MENTOR_TEST_RESULT, JSON.stringify({ok:true}))).catch(error => writeFile(process.env.MENTOR_TEST_RESULT, JSON.stringify({ok:false,error:error.stack ?? String(error)}))).finally(() => vscode.commands.executeCommand('workbench.action.quit')); }`, resolveDir: root },
  outfile: path.join(harness, 'index.js'), bundle: true, external: ['vscode'], platform: 'node', format: 'cjs', target: 'node20',
});
// No .env file, provider calls, existing database writes, or repository analysis.
let snapshots; let backendOutput = '';
const backend = spawn(process.execPath, [path.join(root, 'test/backend-fixture.mjs')], {
  cwd: backendRoot, env: { ...process.env, PORT: String(port), DATABASE_PATH: ':memory:', MENTOR_FIXTURE_INPUTS: JSON.stringify(inputs) },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
backend.stdout.on('data', data => {
  backendOutput += data;
  const match = /MENTOR_FIXTURES:(\[[^\n]+\])/.exec(backendOutput);
  if (match) snapshots = JSON.parse(match[1]);
  process.stdout.write(data);
});
backend.stderr.on('data', data => process.stderr.write(data));
const testWindows = new Set();
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { const response = await fetch(`${base}/api/health`); ready = response.ok && (await response.json()).ok === true; } catch {}
    if (ready) break;
    if (backend.exitCode !== null) throw new Error(`Backend exited: ${backend.exitCode}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Real backend did not become healthy.');
  // Electron's inherited Node mode must be removed for desktop testing.
  delete process.env.ELECTRON_RUN_AS_NODE;
  for (const scenario of ['empty', 'single', 'restart', 'multi']) {
    if (scenario === 'multi') execFileSync('git', ['-c', `core.hooksPath=${emptyHooks}`, '-C', fixtureFolders[0], 'checkout', 'main'], { windowsHide: true });
    const profile = path.join(runRoot, scenario === 'restart' ? 'single' : scenario);
    await mkdir(path.join(profile, 'user-data/User'), { recursive: true });
    // Custom dialogs are driven through the actual isolated workbench UI.
    if (scenario !== 'restart') await writeFile(path.join(profile, 'user-data/User/settings.json'), JSON.stringify({ 'window.dialogStyle': 'custom', 'telemetry.telemetryLevel': 'off', 'chat.disableAIFeatures': true }));
    const stepFile = path.join(profile, `${scenario}-steps.json`);
    const debugServer = createServer(); await new Promise(resolve => debugServer.listen(0, '127.0.0.1', resolve));
    const debugPort = debugServer.address().port; await new Promise(resolve => debugServer.close(resolve));
    const testEnvironment = { MENTOR_TEST_BACKEND: base, MENTOR_TEST_SCENARIO: scenario, MENTOR_TEST_SNAPSHOTS: JSON.stringify(snapshots), MENTOR_UI_STEP: stepFile, MENTOR_TEST_HOOKS: emptyHooks };
    const launchArgs = [
      ...(scenario === 'empty' ? [] : [scenario === 'multi' ? workspaceFile : fixtureFolders[0]]),
      '--user-data-dir', path.join(profile, 'user-data'), '--extensions-dir', path.join(profile, 'extensions'),
      '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
      '--disable-updates', '--disable-telemetry', '--disable-gpu', `--remote-debugging-port=${debugPort}`,
    ];
    const tests = scenario === 'empty' ? runTests({
      vscodeExecutablePath: executable, extensionDevelopmentPath: root,
      extensionTestsPath: path.join(root, '.host-test/index.js'),
      extensionTestsEnv: testEnvironment, launchArgs,
    }) : (async () => {
      // VS Code deliberately refuses modal dialogs with extensionTestsPath set.
      // A generated test-only companion runs the same assertions in a normal
      // Development Host so real user confirmations can be exercised via CDP.
      const resultFile = path.join(profile, `${scenario}-result.json`);
      const child = spawn(executable, [...launchArgs, `--extensionDevelopmentPath=${root}`, `--extensionDevelopmentPath=${harness}`], {
        env: { ...process.env, ...testEnvironment, MENTOR_TEST_RESULT: resultFile }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      testWindows.add(child);
      child.stdout.on('data', data => process.stdout.write(data)); child.stderr.on('data', data => process.stderr.write(data));
      const timeout = setTimeout(() => child.kill(), 55000);
      try {
        const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
        const result = JSON.parse(await readFile(resultFile, 'utf8'));
        if (!result.ok) throw new Error(result.error);
        if (code !== 0) throw new Error(`Development Host exited ${code}`);
        console.log(`MENTOR_DEVELOPMENT_HOST_PASS: ${scenario}`);
      } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill(); testWindows.delete(child); }
    })();
    if (scenario === 'single' || scenario === 'multi') await Promise.all([tests, driveWorkbench(debugPort, stepFile, snapshots, path.join(profile, 'focus.png'))]);
    else await tests;
  }
} finally {
  for (const child of testWindows) child.kill();
  backend.kill();
}
