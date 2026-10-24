import express from "express";
import { z } from "zod";
import {
  approveRecord,
  createQuestion,
  createRecord,
  getQuestion,
  getRecord,
  listQuestions,
  listRecordHistory,
  markNeedsReview,
  resolveQuestion,
  resolveReview,
  respondToQuestion,
  suggestQuestionResponse,
  reviseRecord,
  readQuestionAttachment,
  saveQuestionAttachment,
  searchRecords,
  submitRecord,
  supersedeRecord,
  withdrawRecord,
} from "./decisionMemory.js";

export function createDecisionMemoryRoutes({
  getPrincipal = (req) => req.auth || null,
} = {}) {
  const router = express.Router();
  const handler =
    (fn, statusCode = 200) =>
    (req, res, next) => {
      try {
        res.status(statusCode).json(fn(req, getPrincipal(req)));
      } catch (error) {
        next(error);
      }
    };

  router.get(
    "/records",
    handler((req, principal) =>
      searchRecords(
        {
          repository: req.query.repository,
          query: req.query.q,
          type: req.query.type,
          snapshotId: req.query.snapshotId,
          sourceReferenceId: req.query.sourceReferenceId,
          includeDrafts: req.query.includeDrafts === "true",
          includeHistory: req.query.includeHistory === "true",
          limit: req.query.limit,
          offset: req.query.offset,
        },
        principal,
      ),
    ),
  );
  router.post(
    "/records",
    handler((req, principal) => {
      const body = z
        .object({
          repository: z.string().trim().min(1).max(400),
          type: z.enum(["decision", "failure_lesson"]),
          content: z.record(z.string(), z.unknown()),
          evidence: z
            .array(z.record(z.string(), z.unknown()))
            .max(80)
            .optional(),
        })
        .strict()
        .parse(req.body);
      return createRecord(body, principal);
    }, 201),
  );
  router.get(
    "/records/:id",
    handler((req, principal) =>
      getRecord(req.params.id, req.query.repository, principal),
    ),
  );
  router.get(
    "/records/:id/history",
    handler((req, principal) =>
      listRecordHistory(req.params.id, req.query.repository, principal),
    ),
  );
  router.post(
    "/records/:id/revisions",
    handler((req, principal) => {
      const body = z
        .object({
          expectedRevision: z.number().int().positive(),
          content: z.record(z.string(), z.unknown()),
          evidence: z
            .array(z.record(z.string(), z.unknown()))
            .max(80)
            .optional(),
        })
        .strict()
        .parse(req.body);
      return reviseRecord(req.params.id, body, principal);
    }),
  );
  router.post(
    "/records/:id/submit",
    handler((req, principal) => {
      const body = z
        .object({ expectedRevision: z.number().int().positive() })
        .strict()
        .parse(req.body);
      return submitRecord(req.params.id, body.expectedRevision, principal);
    }),
  );
  router.post(
    "/records/:id/approve",
    handler((req, principal) => {
      const body = z
        .object({ expectedRevision: z.number().int().positive() })
        .strict()
        .parse(req.body);
      return approveRecord(req.params.id, body.expectedRevision, principal);
    }),
  );
  router.post(
    "/records/:id/needs-review",
    handler((req, principal) => {
      const body = z
        .object({
          expectedRevision: z.number().int().positive(),
          reason: z.string().trim().min(1).max(1000),
        })
        .strict()
        .parse(req.body);
      return markNeedsReview(
        req.params.id,
        body.expectedRevision,
        body.reason,
        principal,
      );
    }),
  );
  router.post(
    "/records/:id/review",
    handler((req, principal) => {
      const body = z
        .object({
          expectedRevision: z.number().int().positive(),
          outcome: z.enum(["still_applicable", "withdraw"]),
          reason: z.string().trim().min(1).max(1000),
        })
        .strict()
        .parse(req.body);
      return resolveReview(
        req.params.id,
        body.expectedRevision,
        body.outcome,
        body.reason,
        principal,
      );
    }),
  );
  router.post(
    "/records/:id/withdraw",
    handler((req, principal) => {
      const body = z
        .object({
          expectedRevision: z.number().int().positive(),
          reason: z.string().trim().min(1).max(1000),
        })
        .strict()
        .parse(req.body);
      return withdrawRecord(
        req.params.id,
        body.expectedRevision,
        body.reason,
        principal,
      );
    }),
  );
  router.post(
    "/records/:id/supersede",
    handler((req, principal) => {
      const body = z
        .object({
          expectedRevision: z.number().int().positive(),
          replacementId: z.string().max(150),
        })
        .strict()
        .parse(req.body);
      return supersedeRecord(
        req.params.id,
        body.replacementId,
        body.expectedRevision,
        principal,
      );
    }),
  );
  router.post(
    "/questions",
    handler((req, principal) => {
      const body = z
        .object({
          repository: z.string().trim().min(1).max(400),
          question: z.string().trim().min(1).max(2000),
          evidence: z
            .array(z.record(z.string(), z.unknown()))
            .max(80)
            .optional(),
          origin: z
            .enum([
              "why_question",
              "journey",
              "contribution",
              "pr_analysis",
              "failure",
              "other",
            ])
            .optional(),
        })
        .strict()
        .parse(req.body);
      return createQuestion(body, principal);
    }, 201),
  );
  router.get(
    "/questions",
    handler((req, principal) =>
      listQuestions(
        req.query.repository,
        principal,
        req.query.status || "open",
      ),
    ),
  );
  router.get(
    "/questions/:id",
    handler((req, principal) =>
      getQuestion(req.params.id, req.query.repository, principal),
    ),
  );
  router.post("/questions/:id/suggestion", async (req, res, next) => {
    try {
      const body = z
        .object({
          componentId: z.string().max(200).optional(),
          referenceId: z.string().max(200).optional(),
          snapshotId: z.string().max(150).optional(),
        })
        .strict()
        .refine(
          (value) =>
            Boolean(value.snapshotId) ===
            Boolean(value.referenceId || value.componentId),
          "A selected module or source reference must include its snapshot ID",
        )
        .refine(
          (value) => !(value.referenceId && value.componentId),
          "Select either a module/function or a source reference, not both",
        )
        .parse(req.body);
      res.json(
        await suggestQuestionResponse(req.params.id, body, getPrincipal(req)),
      );
    } catch (error) {
      next(error);
    }
  });
  router.post(
    "/questions/:id/respond",
    handler((req, principal) =>
      respondToQuestion(req.params.id, req.body, principal),
    ),
  );
  router.post(
    "/questions/:id/attachments",
    express.raw({ type: "application/octet-stream", limit: "5mb" }),
    handler(
      (req, principal) =>
        saveQuestionAttachment(
          req.params.id,
          {
            filename: decodeURIComponent(req.headers["x-file-name"] || ""),
            contentType:
              req.headers["x-file-type"] || "application/octet-stream",
            content: req.body,
          },
          principal,
        ),
      201,
    ),
  );
  router.get("/questions/:id/attachments/:attachmentId", (req, res, next) => {
    try {
      const file = readQuestionAttachment(
        req.params.id,
        req.params.attachmentId,
        getPrincipal(req),
      );
      res.type(file.contentType).attachment(file.filename).send(file.content);
    } catch (error) {
      next(error);
    }
  });
  router.post(
    "/questions/:id/resolve",
    handler((req, principal) =>
      resolveQuestion(req.params.id, req.body, principal),
    ),
  );

  return router;
}

export const decisionMemoryRoutes = createDecisionMemoryRoutes();
