import { Router } from "express";
import { repositoryProgress, repositoryCommits } from "./progressReport.js";
export const progressRoutes = Router();
progressRoutes.get("/report", (req, res, next) => {
  try {
    res.json(repositoryProgress(req.query));
  } catch (error) {
    next(error);
  }
});
progressRoutes.get("/commits", async (req, res, next) => {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    res.json(await repositoryCommits(req.query, controller.signal));
  } catch (error) {
    next(error);
  }
});
