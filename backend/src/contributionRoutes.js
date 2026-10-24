import express from "express";
import { z } from "zod";
import {
  analyzeContributions,
  createContributionPlan,
} from "./contributions.js";

export const contributionRoutes = express.Router();

function handler(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error.status && error.status < 500)
        return res.status(error.status).json({ error: error.message });
      if (error.status === 429)
        return res.status(429).json({ error: error.message });
      if (error.status)
        return res.status(error.status).json({ error: error.message });
      next(error);
    }
  };
}

const preferences = z
  .object({
    skills: z.array(z.string().trim().min(1).max(50)).max(12).optional(),
    interests: z.array(z.string().trim().min(1).max(50)).max(12).optional(),
    difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  })
  .strict()
  .default({});
const snapshotId = z.string().trim().min(1).max(150);

contributionRoutes.post(
  "/analyze",
  handler(async (req, res) => {
    const body = z.object({ snapshotId, preferences }).strict().parse(req.body);
    res.json(await analyzeContributions(body.snapshotId, body.preferences));
  }),
);

contributionRoutes.post(
  "/plan",
  handler(async (req, res) => {
    const body = z
      .object({
        snapshotId,
        issueNumber: z.number().int().positive().max(2147483647),
        preferences,
      })
      .strict()
      .parse(req.body);
    res.json(
      await createContributionPlan(
        body.snapshotId,
        body.issueNumber,
        body.preferences,
      ),
    );
  }),
);
