import { Router } from 'express';
import { db } from './storage.js';
import { resolveSelection, selectionRequest } from './ideSelection.js';
import { readNeighborhood, neighborhoodId, neighborhoodQuery } from './ideNeighborhood.js';
import { checkpointRoutes } from './checkpointRoutes.js';
import { handoffRoutes } from './ideHandoffRoutes.js';

export const ideRoutes = Router();
ideRoutes.use('/checkpoints', checkpointRoutes);
ideRoutes.use('/handoffs', handoffRoutes);
ideRoutes.get('/snapshots/:snapshotId/components/:componentId/neighborhood', (req, res, next) => {
  try {
    const snapshotId = neighborhoodId.max(150).parse(req.params.snapshotId);
    const componentId = neighborhoodId.parse(req.params.componentId);
    const query = neighborhoodQuery.parse(req.query);
    res.json(readNeighborhood(db, snapshotId, componentId, query));
  } catch (error) { next(error); }
});
ideRoutes.post('/resolve-selection', (req, res, next) => {
  try {
    const body = selectionRequest.parse(req.body);
    const row = db.prepare('SELECT graph_json FROM snapshots WHERE id=?').get(body.snapshotId);
    if (!row) return res.status(404).json({ error: 'Snapshot not found' });
    res.json(resolveSelection(JSON.parse(row.graph_json), body));
  } catch (error) { next(error); }
});
