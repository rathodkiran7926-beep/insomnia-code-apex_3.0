// Test-only harness: seed real snapshots using existing backend services, then
// run the existing server. No production endpoint, database or analyzer added.
import { analyze } from '../../backend/src/analyzer.js';
import { documentGraph, markdown } from '../../backend/src/documentation.js';
import { compareEvidence } from '../../backend/src/prComparison.js';
import { saveSnapshot, db } from '../../backend/src/storage.js';

const inputs = JSON.parse(process.env.MENTOR_FIXTURE_INPUTS ?? '[]');
delete process.env.LLM_API_KEY;
const snapshots = [];
const analyzed = [];
for (const input of inputs) {
  const files = input.files ?? { 'src/index.ts': 'export function greet(name: string) { return `Hello ${name}`; }' };
  const graph = analyze({ repository: input.repository, commit: input.commit, files });
  const docs = await documentGraph(graph, { generateAI: false });
  saveSnapshot(graph, docs, markdown(graph, docs), files);
  analyzed.push({graph,docs,files});
  snapshots.push({ snapshotId: graph.snapshotId, repository: graph.repository, commit: graph.commit });
}
// Existing storage shape and comparison builder, scoped to this isolated DB.
await import('../../backend/src/prRoutes.js');
if (analyzed[4]) {
  const before=analyzed[4], after=analyzed[3];
  const comparison=compareEvidence({url:'https://github.com/sindresorhus/p-limit/pull/999999',number:999999,title:'Controlled local fixture; not a live GitHub PR',state:'closed',baseRepository:before.graph.repository,headRepository:after.graph.repository,baseCommit:before.graph.commit,headCommit:after.graph.commit,targetCommit:after.graph.commit,baseBranch:'controlled-fixture',headBranch:'pinned-public',files:[{path:'index.js',previousPath:null,status:'modified',additions:1,deletions:1,hidden:false,patchLimited:false,envNames:[]}],limited:false,changedFiles:1},before,after);
  comparison.id='3e9b5af6-6ef2-423d-87cd-63e0e4eab777';
  db.prepare('INSERT OR REPLACE INTO pr_comparisons(id,base_snapshot_id,head_snapshot_id,data) VALUES(?,?,?,?)').run(comparison.id,comparison.beforeSnapshotId,comparison.afterSnapshotId,JSON.stringify(comparison));
}
console.log(`MENTOR_FIXTURES:${JSON.stringify(snapshots)}`);
await import('../../backend/src/server.js');
