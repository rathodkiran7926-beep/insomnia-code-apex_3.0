// Optional live verification helper. All GitHub access goes through existing backend services.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const folder = path.join(root, '.host-test/public-p-limit');
const commit = execFileSync('git', ['-C', folder, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
const files = Object.fromEntries(await Promise.all(['index.js', 'index.d.ts', 'package.json', 'readme.md'].map(async p => [p, await readFile(path.join(folder, p), 'utf8')])));
const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
let output = '', snapshot;
const child = spawn(process.execPath, ['test/backend-fixture.mjs'], { cwd: root, windowsHide: true,
  env: { ...process.env, PORT: String(port), DATABASE_PATH: ':memory:', MENTOR_FIXTURE_INPUTS: JSON.stringify([{ repository: 'https://github.com/sindresorhus/p-limit', commit, files }]) }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', chunk => { output += chunk; const match = /MENTOR_FIXTURES:(\[[^\n]+\])/.exec(output); if (match) snapshot = JSON.parse(match[1])[0]; });
child.stderr.on('data', chunk => { output += chunk; });
const request = async (route, options) => { const res = await fetch(`http://127.0.0.1:${port}${route}`, options); const value = await res.json(); if (!res.ok) throw new Error(`${res.status}: ${value.error}`); return value; };
try {
  for (let i = 0; i < 100 && !snapshot; i++) { if (child.exitCode !== null) throw new Error('Backend exited'); await new Promise(r => setTimeout(r, 100)); }
  for (let i = 0; i < 100; i++) { try { await request('/api/health'); break; } catch { if (i === 99) throw new Error('Backend did not become ready'); await new Promise(r => setTimeout(r, 100)); } }
  const list = await request(`/api/pr/pulls?snapshotId=${snapshot.snapshotId}&state=all&page=1`);
  await mkdir('.host-test', { recursive: true }); await writeFile('.host-test/live-pr-list.json', JSON.stringify(list, null, 2));
  console.log(JSON.stringify(list.pullRequests.map(p => ({ number: p.number, title: p.title, state: p.state, draft: p.draft, head: p.head })), null, 2));
  if (process.argv.includes('--inspect')) {
    const { fetchPullRequest } = await import('../../backend/src/prGithub.js');
    const metadata = await fetchPullRequest('https://github.com/sindresorhus/p-limit/pull/106');
    console.log(JSON.stringify({ number: metadata.number, title: metadata.title, baseRepository: metadata.baseRepository, headRepository: metadata.headRepository, baseCommit: metadata.baseCommit, headCommit: metadata.headCommit, targetCommit: metadata.targetCommit, files: metadata.files.map(f => ({ path: f.path, status: f.status })) }, null, 2));
  }
} finally { child.kill(); }
