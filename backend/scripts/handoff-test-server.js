// Deterministic source fixture for the browser check only. Never imported by production.
import { db, saveSnapshot } from "../src/storage.js";
import { analyze } from "../src/analyzer.js";
import { documentGraph } from "../src/documentation.js";
const files = {
  "src/app.ts": `import express from 'express';
import {createUser} from './users';
export const app = express();
app.post('/signup', async (req, res) => res.json(await createUser(req.body.email)));`,
  "src/users.ts": `export async function createUser(email: string) {
  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    throw new Error('User already exists');
  }
  return { email };
}
export function findUserByEmail(email: string) { return null; }
`,
};
const graph = analyze({
  repository: "https://github.com/example/handoff-check",
  commit: "c".repeat(40),
  branch: "main",
  files,
});
saveSnapshot(
  graph,
  await documentGraph(graph, { generateAI: false }),
  "",
  files,
);
if (
  !db
    .prepare("SELECT id FROM analysis_jobs WHERE id=?")
    .get("handoff-browser-analysis")
)
  db.prepare("INSERT INTO analysis_jobs VALUES (?,?,?,?,?,?)").run(
    "handoff-browser-analysis",
    "complete",
    100,
    "Browser test fixture",
    graph.snapshotId,
    new Date().toISOString(),
  );
await import("../src/server.js");
