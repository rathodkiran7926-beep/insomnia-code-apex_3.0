import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { db } from './storage.js';
import { authenticate } from './collaborationAuth.js';
import { seedIdeDemo } from './ideDemoSeed.js';
import { migrateCheckpoints, checkpointId, scopeQuery, listCheckpoints, createCheckpoint, getCheckpoint, deleteCheckpoint, resumeCheckpoint } from './checkpoints.js';

migrateCheckpoints(db);
export const ideTeamRoutes = Router();
// Native IDE convenience only. Never enable anonymous access to web handoffs.
ideTeamRoutes.post('/connect', (req, res, next) => {
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if (process.env.CODEBASE_MENTOR_IDE_DEMO !== '1' || process.env.NODE_ENV === 'production' ||
      !loopback.includes(req.socket.remoteAddress) ||
      !['localhost', '127.0.0.1', '[::1]', '::1'].includes(req.hostname) ||
      req.headers.origin || req.headers['sec-fetch-site'] || req.headers.forwarded || req.headers['x-forwarded-for'] ||
      req.headers['x-codebase-mentor-client'] !== 'vscode') {
    return res.status(403).json({ error: 'Automatic IDE handoffs require a local development backend with CODEBASE_MENTOR_IDE_DEMO=1.' });
  }
  try {
    const demo = seedIdeDemo(db, { enabled: true });
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM collaboration_auth_sessions WHERE expires_at<?').run(Date.now());
    db.prepare('INSERT INTO collaboration_auth_sessions VALUES (?,?,?)').run(
      createHash('sha256').update(token).digest('hex'), demo.users[0].id, Date.now() + 7 * 86400000);
    res.set('Cache-Control', 'no-store');
    res.cookie('mentor_collaboration', token, { httpOnly: true, sameSite: 'strict', maxAge: 7 * 86400000, path: '/api' });
    res.json({ connected: true, mode: 'local-ide', notice: 'Local handoffs use the shared Junior Developer identity.' });
  } catch (error) { next(error); }
});
ideTeamRoutes.use(authenticate);
ideTeamRoutes.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const handle = fn => (req, res, next) => { try { fn(req, res); } catch (error) { next(error); } };
ideTeamRoutes.get('/checkpoints/capabilities', (_req, res) => res.json({ enabled: true, mode: 'authenticated-user', schemaVersion: 1, notice: 'Sessions are owned by the signed-in developer. Sharing uses authenticated workspace handoffs.' }));
ideTeamRoutes.get('/checkpoints', handle((req, res) => res.json(listCheckpoints(db, req.query, req.collaborator.id))));
ideTeamRoutes.post('/checkpoints', handle((req, res) => {
  const result = createCheckpoint(db, req.body, req.collaborator.id);
  res.status(result.created ? 201 : 200).json(result.detail);
}));
ideTeamRoutes.get('/checkpoints/:id', handle((req, res) => res.json(getCheckpoint(db, checkpointId.parse(req.params.id), scopeQuery.parse(req.query).snapshotId, req.collaborator.id))));
ideTeamRoutes.post('/checkpoints/:id/resume', handle((req, res) => res.json(resumeCheckpoint(db, checkpointId.parse(req.params.id), req.body, req.collaborator.id))));
ideTeamRoutes.delete('/checkpoints/:id', handle((req, res) => res.json(deleteCheckpoint(db, checkpointId.parse(req.params.id), scopeQuery.parse(req.query).snapshotId, req.collaborator.id))));
