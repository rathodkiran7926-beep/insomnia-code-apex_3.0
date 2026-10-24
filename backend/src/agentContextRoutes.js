import express from "express";
import { z } from "zod";
import {
  checkContextDrift,
  exploreDependencies,
  getTaskContext,
  inspectSymbol,
} from "./agentContextBridge.js";

const snapshotIdSchema = z.string().min(1).max(200);

const taskBody = z
  .object({
    task: z.string().trim().min(1).max(2000),
    targetTokens: z.number().int().min(200).max(12000).optional(),
    maxTokens: z.number().int().min(500).max(16000).optional(),
    maxNodes: z.number().int().min(1).max(50).optional(),
    maxEdges: z.number().int().min(1).max(80).optional(),
    maxFiles: z.number().int().min(1).max(20).optional(),
    depth: z.number().int().min(0).max(3).optional(),
  })
  .strict();

const symbolBody = z
  .object({
    symbol: z.string().trim().min(1).max(300),
  })
  .strict();

const dependenciesBody = z
  .object({
    symbol: z.string().trim().min(1).max(300),
    depth: z.number().int().min(0).max(3).optional(),
    maxNodes: z.number().int().min(1).max(50).optional(),
    maxEdges: z.number().int().min(1).max(80).optional(),
  })
  .strict();

const driftBody = z
  .object({
    referenceIds: z.array(z.string().min(1).max(200)).max(100).optional(),
  })
  .strict();

export const agentContextRouter = express.Router();

function handle(schema, operation) {
  return (req, res, next) => {
    try {
      const id = snapshotIdSchema.parse(req.params.id);
      const body = schema.parse(req.body);
      res.json(operation(id, body));
    } catch (error) {
      next(error);
    }
  };
}

agentContextRouter.post(
  "/:id/agent-context",
  handle(taskBody, (id, body) => getTaskContext(id, body.task, body)),
);

agentContextRouter.post(
  "/:id/agent-context/inspect-symbol",
  handle(symbolBody, (id, body) => inspectSymbol(id, body.symbol)),
);

agentContextRouter.post(
  "/:id/agent-context/explore-dependencies",
  handle(dependenciesBody, (id, body) => exploreDependencies(id, body.symbol, body)),
);

agentContextRouter.post(
  "/:id/agent-context/check-drift",
  handle(driftBody, (id, body) => checkContextDrift(id, body.referenceIds || [])),
);
