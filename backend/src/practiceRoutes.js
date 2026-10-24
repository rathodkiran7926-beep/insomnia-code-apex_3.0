import express from "express";
import { z } from "zod";
import {
  answerQuiz,
  createPracticeAttempt,
  createQuizSession,
  listPracticeAttempts,
  listPracticeTasks,
} from "./practice.js";

export const practiceRoutes = express.Router();

practiceRoutes.post("/tasks", async (req, res, next) => {
  try {
    res.json(await listPracticeTasks(req.body));
  } catch (error) {
    next(error);
  }
});

practiceRoutes.post("/attempts", (req, res, next) => {
  try {
    res.status(201).json(createPracticeAttempt(req.body));
  } catch (error) {
    next(error);
  }
});

practiceRoutes.get("/attempts", (req, res, next) => {
  try {
    res.json(listPracticeAttempts(req.query));
  } catch (error) {
    next(error);
  }
});

practiceRoutes.post("/quizzes/sessions", async (req, res, next) => {
  try {
    res.status(201).json(await createQuizSession(req.body));
  } catch (error) {
    next(error);
  }
});

practiceRoutes.post("/quizzes/sessions/:id/answers", (req, res, next) => {
  try {
    const sessionId = z.string().uuid().parse(req.params.id);
    res.json(answerQuiz({ ...req.body, sessionId }));
  } catch (error) {
    next(error);
  }
});
