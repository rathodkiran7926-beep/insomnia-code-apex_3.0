import { Router } from 'express';
import { db } from './storage.js';
import { migrateCheckpoints, checkpointId, scopeQuery, listCheckpoints, createCheckpoint, getCheckpoint, deleteCheckpoint, resumeCheckpoint } from './checkpoints.js';

migrateCheckpoints(db);
export const checkpointRoutes = Router();
import { safeRequest } from './localSingleUser.js';
const enabled = req => process.env.CODEBASE_MENTOR_LOCAL_CHECKPOINTS === '1' && safeRequest(req);
checkpointRoutes.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
checkpointRoutes.get('/capabilities', (req, res) => res.json({ enabled: enabled(req), mode: 'local-single-user', schemaVersion: 1, notice: 'Explicit local single-user mode only. No production authentication, user isolation, secure sharing or cross-device synchronization.' }));
checkpointRoutes.use((req, res, next) => enabled(req) ? next() : res.status(403).json({ error: 'Checkpoints require explicitly enabled local single-user mode and a direct safe loopback request.' }));
const handle = fn => (req, res, next) => { try { fn(req, res); } catch (e) { next(e); } };
checkpointRoutes.get('/', handle((req, res) => res.json(listCheckpoints(db, req.query))));
checkpointRoutes.post('/', handle((req, res) => { const result = createCheckpoint(db, req.body); res.status(result.created ? 201 : 200).json(result.detail); }));
checkpointRoutes.get('/:id', handle((req, res) => res.json(getCheckpoint(db, checkpointId.parse(req.params.id), scopeQuery.parse(req.query).snapshotId))));
checkpointRoutes.post('/:id/resume', handle((req, res) => res.json(resumeCheckpoint(db, checkpointId.parse(req.params.id), req.body))));
checkpointRoutes.delete('/:id', handle((req, res) => res.json(deleteCheckpoint(db, checkpointId.parse(req.params.id), scopeQuery.parse(req.query).snapshotId))));
