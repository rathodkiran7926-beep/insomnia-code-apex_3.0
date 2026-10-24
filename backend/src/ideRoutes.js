import { Router } from 'express';
import { db } from './storage.js';
import { resolveSelection, selectionRequest } from './ideSelection.js';

export const ideRoutes = Router();
ideRoutes.post('/resolve-selection', (req, res, next) => {
  try {
    const body = selectionRequest.parse(req.body);
    const row = db.prepare('SELECT graph_json FROM snapshots WHERE id=?').get(body.snapshotId);
    if (!row) return res.status(404).json({ error: 'Snapshot not found' });
    res.json(resolveSelection(JSON.parse(row.graph_json), body));
  } catch (error) { next(error); }
});
