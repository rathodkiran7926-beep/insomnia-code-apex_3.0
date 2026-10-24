import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Controlled teaching recipe. No repository code or user-supplied inputs run here.
const events: object[] = [];
function event(key: string, fields: object = {}) {
  events.push({ key, timestamp: new Date().toISOString(), fields });
}
const scenario = process.argv[2];
if (!['success', 'invalid'].includes(scenario)) throw new Error('Unapproved scenario');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL)');
const app = express();
app.use(express.json());
app.post('/signup', async (req, res) => {
  // @event receive
  event('receive', { method: req.method, path: '/signup' });
  // @event validate
  const valid = typeof req.body.email === 'string' && req.body.email.includes('@');
  event('validate', { valid });
  if (!valid) {
    // @event invalid
    event('invalid', { status: 400, branch: 'invalid' });
    return res.status(400).json({ error: 'Invalid email' });
  }
  // @event lookup
  event('lookup', { operation: 'SELECT', storage: 'in-memory SQLite' });
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(req.body.email);
  // @event duplicate-check
  event('duplicate-check', { exists: Boolean(existing) });
  if (existing) {
    // @event duplicate
    event('duplicate', { status: 409, branch: 'duplicate' });
    return res.status(409).json({ error: 'Already registered' });
  }
  // @event prepare
  event('prepare', { accountState: 'ready for insertion' });
  try {
    // @event write
    const result = db.prepare('INSERT INTO users(email) VALUES (?)').run(req.body.email);
    event('write', { operation: 'INSERT', changes: Number(result.changes) });
    // @event response
    event('response', { status: 201 });
    return res.status(201).json({ created: true });
  } catch {
    // @event database-error
    event('database-error', { status: 500, branch: 'database-error' });
    return res.status(500).json({ error: 'Storage failed' });
  }
});
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No listening port');
const response = await fetch(`http://127.0.0.1:${address.port}/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(scenario === 'success' ? { email: 'redacted-fixture@example.test' } : {}),
});
await response.arrayBuffer();
server.close(); db.close();
console.log(JSON.stringify({ recipeHash: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'), scenario, status: response.status, events }));
