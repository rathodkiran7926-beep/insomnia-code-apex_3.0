import { runTests, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { driveWorkbench } from '../test/ui-driver.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const backendRoot = path.resolve(root, '../backend');
const executable = process.env.VSCODE_EXECUTABLE_PATH ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs/Microsoft VS Code/Code.exe');
const packageInfo = JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const vsixInput = process.env.MENTOR_TEST_VSIX ?? (process.argv.includes('--installed') ? `${packageInfo.name}-${packageInfo.version}.vsix` : undefined);
const installedVsix = vsixInput ? path.resolve(root, vsixInput) : undefined;
if (installedVsix && (!installedVsix.endsWith('.vsix') || !existsSync(installedVsix))) throw new Error('MENTOR_TEST_VSIX must identify an existing VSIX.');
const installedProfiles = new Set();
const installVsix = async profile => {
  if (!installedVsix || installedProfiles.has(profile)) return;
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(executable, { reuseMachineInstall: true });
  let command = cli, args = cliArgs;
  const environment = { ...process.env };
  if (process.platform === 'win32') {
    // Read the installed CLI's literal script path, then invoke Electron's Node
    // mode directly. No cmd quoting or shell interpolation of workspace paths.
    const stub = await readFile(cli, 'utf8');
    const script = stub.match(/"%~dp0([^"\r\n]+out\\cli\.js)"/i);
    if (!script) throw new Error('Cannot resolve installed VS Code CLI entry point.');
    command = executable; args = [path.resolve(path.dirname(cli), script[1]), ...cliArgs];
    environment.ELECTRON_RUN_AS_NODE = '1'; environment.VSCODE_DEV = '';
  }
  execFileSync(command, [...args, '--user-data-dir', path.join(profile,'user-data'), '--extensions-dir', path.join(profile,'extensions'), '--install-extension', installedVsix, '--force'], { env: environment, windowsHide: true, stdio:'inherit' });
  installedProfiles.add(profile);
};
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
const publicSeed = path.join(root, '.host-test/public-p-limit');
const publicRevision = 'a8a6fbec4e0e866d6d779b10889bb4f5567e70eb';
if (!existsSync(path.join(publicSeed, '.git'))) {
  await mkdir(publicSeed, { recursive: true });
  const seedGit = args => execFileSync('git', ['-c', `core.hooksPath=${emptyHooks}`, '-C', publicSeed, ...args], { windowsHide: true });
  seedGit(['init', `--template=${emptyHooks}`]);
  seedGit(['remote', 'add', 'origin', 'https://github.com/sindresorhus/p-limit.git']);
  seedGit(['fetch', '--depth=1', 'origin', publicRevision]);
  seedGit(['checkout', '--detach', publicRevision]);
}
const publicFolder = path.join(runRoot, 'public-p-limit');
execFileSync('git', ['-c', `core.hooksPath=${emptyHooks}`, 'clone', '--no-hardlinks', `--template=${emptyHooks}`, publicSeed, publicFolder], { windowsHide: true });
execFileSync('git', ['-C', publicFolder, 'remote', 'set-url', 'origin', 'https://github.com/sindresorhus/p-limit.git'], { windowsHide: true });
const publicCommit = execFileSync('git', ['-C', publicFolder, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
if (publicCommit !== publicRevision) throw new Error('Public test fixture must use pinned p-limit revision ' + publicRevision);
const publicFiles = Object.fromEntries(await Promise.all(['index.js', 'index.d.ts', 'package.json', 'readme.md'].map(async file => [file, await readFile(path.join(publicFolder, file), 'utf8')])));
inputs.push({ repository: 'https://github.com/sindresorhus/p-limit', commit: publicCommit, files: publicFiles });
console.log(`MENTOR_PUBLIC_REPOSITORY: sindresorhus/p-limit @ ${publicCommit}`);
// A real local Git commit supplies a clearly controlled PR version. It is never
// described as a GitHub PR result and never changes the pinned public checkout.
const controlledFiles = { ...publicFiles, 'index.js': publicFiles['index.js'].replace('const limit = pLimit(options);', 'const limit = pLimit({...options});') };
await writeFile(path.join(publicFolder,'index.js'), controlledFiles['index.js']);
execFileSync('git',['-c',`core.hooksPath=${emptyHooks}`,'-C',publicFolder,'add','index.js'],{windowsHide:true});
execFileSync('git',['-c',`core.hooksPath=${emptyHooks}`,'-c','user.name=Mentor Test','-c','user.email=mentor-test@example.invalid','-C',publicFolder,'commit','-m','Controlled handoff comparison fixture'],{windowsHide:true});
const controlledCommit = execFileSync('git',['-C',publicFolder,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
inputs.push({repository:'https://github.com/sindresorhus/p-limit',commit:controlledCommit,files:controlledFiles});
execFileSync('git',['-c',`core.hooksPath=${emptyHooks}`,'-C',publicFolder,'checkout','--detach',publicRevision],{windowsHide:true});

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
// No .env, provider calls or existing database writes. Analysis uses existing backend services on isolated inputs.
let snapshots; let backendOutput = ''; let backend;
const startBackend = async (handoffsEnabled = true) => {
  backendOutput = '';
  backend = spawn(process.execPath, [path.join(root, 'test/backend-fixture.mjs')], {
    cwd: backendRoot, env: { ...process.env, PORT: String(port), DATABASE_PATH: path.join(runRoot, 'mentor.sqlite'), CODEBASE_MENTOR_LOCAL_CHECKPOINTS: '1', CODEBASE_MENTOR_LOCAL_HANDOFFS: handoffsEnabled ? '1' : '0', MENTOR_FIXTURE_INPUTS: JSON.stringify(inputs) },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stdout.on('data', data => { backendOutput += data; const match = /MENTOR_FIXTURES:(\[[^\n]+\])/.exec(backendOutput); if (match) snapshots = JSON.parse(match[1]); process.stdout.write(data); });
  backend.stderr.on('data', data => process.stderr.write(data));
  for (let i = 0; i < 100; i++) {
    try { if (snapshots && (await fetch(`${base}/api/health`)).ok) return; } catch {}
    if (backend.exitCode !== null) throw new Error('Backend exited');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Backend restart did not become healthy');
};
const stopBackend = async () => { if (backend?.exitCode === null) { const stopped = new Promise(resolve => backend.once('exit', resolve)); backend.kill(); await stopped; } };
const testWindows = new Set();
try {
  await startBackend();
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
  for (const scenario of ['empty', 'single', 'restart', 'multi', 'multi-handoff', 'public', 'offline', 'checkpoint-save', 'checkpoint-resume', 'checkpoint-delete', 'handoff-save', 'handoff-reopen', 'handoff-delete', 'handoff-disabled', ...(process.env.MENTOR_TEST_LIVE_PR === '1' ? ['pr'] : [])].filter(name => !process.env.MENTOR_TEST_SCENARIOS || process.env.MENTOR_TEST_SCENARIOS.split(',').includes(name))) {
    if (['handoff-reopen','handoff-delete','handoff-disabled'].includes(scenario)) { await stopBackend(); await startBackend(scenario !== 'handoff-disabled'); console.log(`MENTOR_HANDOFF_BACKEND_RESTART: ${scenario}`); }
    if (scenario === 'multi') execFileSync('git', ['-c', `core.hooksPath=${emptyHooks}`, '-C', fixtureFolders[0], 'checkout', 'main'], { windowsHide: true });
    if (scenario === 'checkpoint-save') execFileSync('git', ['-c', `core.hooksPath=${emptyHooks}`, '-C', publicFolder, 'checkout', '-b', 'checkpoint-initial', publicRevision], { windowsHide: true });
    if (scenario === 'checkpoint-resume') {
      execFileSync('git', ['-c', `core.hooksPath=${emptyHooks}`, '-C', publicFolder, 'checkout', '-b', 'checkpoint-test'], { windowsHide: true });
      execFileSync('git', ['-c', `core.hooksPath=${emptyHooks}`, '-c', 'user.name=Mentor Test', '-c', 'user.email=mentor-test@example.invalid', '-C', publicFolder, 'commit', '--allow-empty', '-m', 'Checkpoint revision mismatch'], { windowsHide: true });
      await stopBackend(); await startBackend(); console.log('MENTOR_CHECKPOINT_BACKEND_RESTART: before resume');
    }
    if (scenario === 'checkpoint-delete') { await stopBackend(); await startBackend(); console.log('MENTOR_CHECKPOINT_BACKEND_RESTART: before delete'); }
    if (['pr', 'handoff-save', 'offline'].includes(scenario)) execFileSync('git', ['-c', `core.hooksPath=${emptyHooks}`, '-C', publicFolder, 'checkout', '--detach', publicRevision], { windowsHide: true });
    const profile = path.join(runRoot, scenario === 'restart' ? 'single' : scenario.startsWith('checkpoint-') ? 'checkpoint' : scenario.startsWith('handoff-') ? 'handoff' : scenario);
    await mkdir(path.join(profile, 'user-data/User'), { recursive: true });
    // Custom dialogs are driven through the actual isolated workbench UI.
    if (!['restart', 'checkpoint-resume', 'checkpoint-delete', 'handoff-reopen', 'handoff-delete', 'handoff-disabled'].includes(scenario)) await writeFile(path.join(profile, 'user-data/User/settings.json'), JSON.stringify({ 'window.dialogStyle': 'custom', 'files.simpleDialog.enable': true, 'telemetry.telemetryLevel': 'off', 'chat.disableAIFeatures': true }));
    await installVsix(profile);
    const stepFile = path.join(profile, `${scenario}-steps.json`);
    const debugServer = createServer(); await new Promise(resolve => debugServer.listen(0, '127.0.0.1', resolve));
    const debugPort = debugServer.address().port; await new Promise(resolve => debugServer.close(resolve));
    const testEnvironment = { MENTOR_TEST_INSTALLED_ROOT: installedVsix ? path.join(profile,'extensions') : '', MENTOR_TEST_BACKEND: base, MENTOR_TEST_SCENARIO: scenario, MENTOR_TEST_SNAPSHOTS: JSON.stringify(snapshots), MENTOR_UI_STEP: stepFile, MENTOR_TEST_HOOKS: emptyHooks, MENTOR_HANDOFF_METADATA: path.join(runRoot,'handoff-metadata.json'), MENTOR_OTHER_REPOSITORY_FILE: path.join(fixtureFolders[1], 'src/index.ts') };
    const launchArgs = [
      ...(scenario === 'empty' ? [] : [['multi','multi-handoff'].includes(scenario) ? workspaceFile : (['public', 'pr', 'offline'].includes(scenario) || scenario.startsWith('checkpoint-') || scenario.startsWith('handoff-')) ? publicFolder : fixtureFolders[0]]),
      '--user-data-dir', path.join(profile, 'user-data'), '--extensions-dir', path.join(profile, 'extensions'),
      ...(!installedVsix ? ['--disable-extensions'] : []), '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
      '--disable-updates', '--disable-telemetry', '--disable-gpu', `--remote-debugging-port=${debugPort}`,
    ];
    const tests = scenario === 'empty' && !installedVsix ? runTests({
      vscodeExecutablePath: executable, extensionDevelopmentPath: root,
      extensionTestsPath: path.join(root, '.host-test/index.js'),
      extensionTestsEnv: testEnvironment, launchArgs,
    }) : (async () => {
      // VS Code deliberately refuses modal dialogs with extensionTestsPath set.
      // A generated test-only companion runs the same assertions in a normal
      // Development Host so real user confirmations can be exercised via CDP.
      const resultFile = path.join(profile, `${scenario}-result.json`);
      const child = spawn(executable, [...launchArgs, ...(!installedVsix ? [`--extensionDevelopmentPath=${root}`] : []), `--extensionDevelopmentPath=${harness}`], {
        env: { ...process.env, ...testEnvironment, MENTOR_TEST_RESULT: resultFile }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      testWindows.add(child);
      child.stdout.on('data', data => process.stdout.write(data)); child.stderr.on('data', data => process.stderr.write(data));
      const timeout = setTimeout(() => child.kill(), scenario === 'pr' ? 240000 : (scenario.startsWith('checkpoint-') || scenario.startsWith('handoff-')) ? 150000 : 55000);
      try {
        const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
        const result = JSON.parse(await readFile(resultFile, 'utf8'));
        if (!result.ok) throw new Error(result.error);
        if (code !== 0) throw new Error(`Development Host exited ${code}`);
        console.log(`${installedVsix ? 'MENTOR_INSTALLED_VSIX_PASS' : 'MENTOR_DEVELOPMENT_HOST_PASS'}: ${scenario}`);
      } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill(); testWindows.delete(child); }
    })();
    if (['single', 'multi', 'multi-handoff', 'public', 'pr', 'offline'].includes(scenario) || scenario.startsWith('checkpoint-') || scenario.startsWith('handoff-')) await Promise.all([tests, driveWorkbench(debugPort, stepFile, snapshots, path.join(profile, 'focus.png'), async action => { if (action === 'stop') await stopBackend(); else if (action === 'start') await startBackend(); else throw new Error('Unknown test backend action'); })]);
    else await tests;
  }
} finally {
  for (const child of testWindows) child.kill();
  await stopBackend();
}
