// Test-only harness: seed real snapshots using existing backend services, then
// run the existing server. No production endpoint, database or analyzer added.
import { analyze } from '../../backend/src/analyzer.js';
import { documentGraph, markdown } from '../../backend/src/documentation.js';
import { saveSnapshot } from '../../backend/src/storage.js';

const inputs = JSON.parse(process.env.MENTOR_FIXTURE_INPUTS ?? '[]');
delete process.env.LLM_API_KEY;
const snapshots = [];
for (const input of inputs) {
  const files = input.files ?? { 'src/index.ts': 'export function greet(name: string) { return `Hello ${name}`; }' };
  const graph = analyze({ repository: input.repository, commit: input.commit, files });
  const docs = await documentGraph(graph, { generateAI: false });
  saveSnapshot(graph, docs, markdown(graph, docs), files);
  snapshots.push({ snapshotId: graph.snapshotId, repository: graph.repository, commit: graph.commit });
}
console.log(`MENTOR_FIXTURES:${JSON.stringify(snapshots)}`);
await import('../../backend/src/server.js');
