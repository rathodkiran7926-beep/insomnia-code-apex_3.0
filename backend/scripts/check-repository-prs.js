import { listPullRequests } from '../src/prGithub.js';
const repository = process.argv[2];
if (!repository) throw new Error('Pass a public GitHub repository URL.');
try {
  const result = await listPullRequests(repository, 'all', 1);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.message, status: error.remoteStatus || error.status, code: error.code }));
  process.exitCode = 1;
}
