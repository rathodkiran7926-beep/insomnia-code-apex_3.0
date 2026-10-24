import { Router } from "express";
import { z } from "zod";
import { authenticate } from "./collaborationAuth.js";
import { containsCredential } from "./handoffSafety.js";
import {
  createMemory,
  getMemory,
  searchMemory,
  memoryHistory,
  changeMemory,
  memoryContent,
} from "./engineeringMemory.js";

export const engineeringMemoryRoutes = Router();
engineeringMemoryRoutes.use(authenticate);
const id = z.string().uuid(),
  snapshot = z.string().min(1).max(150),
  references = z.array(z.string().min(1).max(200)).min(1).max(20);
const reason = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((s) => !containsCredential(s));
const revision = z.number().int().positive();
engineeringMemoryRoutes.get("/records", (req, res) => {
  const query = z
    .object({
      workspaceId: id,
      repository: z.string().max(400).optional(),
      q: z.string().max(160).optional(),
      type: z.enum(["", "decision", "failure_lesson"]).optional(),
      snapshotId: snapshot.optional(),
      referenceId: z.string().max(200).optional(),
      includeDrafts: z.enum(["true", "false"]).optional(),
      status: z
        .enum([
          "",
          "draft",
          "awaiting_review",
          "approved",
          "needs_review",
          "superseded",
          "withdrawn",
        ])
        .optional(),
      offset: z.coerce.number().int().min(0).max(10000).default(0),
    })
    .strict()
    .parse(req.query);
  if (query.referenceId && !query.snapshotId)
    throw Object.assign(
      new Error("A source reference requires its snapshot."),
      { status: 400 },
    );
  res.json(
    searchMemory(req.collaborator.id, {
      ...query,
      query: query.q || "",
      includeDrafts: query.includeDrafts === "true",
    }),
  );
});
engineeringMemoryRoutes.post("/records", (req, res) => {
  const body = z
    .object({
      workspaceId: id,
      type: z.enum(["decision", "failure_lesson"]),
      snapshotId: snapshot,
      referenceIds: references,
      content: memoryContent,
    })
    .strict()
    .parse(req.body);
  res.status(201).json(createMemory(req.collaborator.id, body));
});
engineeringMemoryRoutes.get("/records/:id", (req, res) =>
  res.json(
    getMemory(
      req.collaborator.id,
      id.parse(req.params.id),
      req.query.snapshotId ? snapshot.parse(req.query.snapshotId) : undefined,
    ),
  ),
);
engineeringMemoryRoutes.get("/records/:id/history", (req, res) =>
  res.json(memoryHistory(req.collaborator.id, id.parse(req.params.id))),
);
const actions = {
  revisions: z
    .object({
      expectedRevision: revision,
      content: memoryContent,
      snapshotId: snapshot.optional(),
      referenceIds: references.optional(),
    })
    .strict()
    .refine(
      (b) => Boolean(b.snapshotId) === Boolean(b.referenceIds),
      "A source update needs both snapshot and reference IDs.",
    ),
  submit: z.object({ expectedRevision: revision }).strict(),
  approve: z.object({ expectedRevision: revision }).strict(),
  withdraw: z.object({ expectedRevision: revision, reason }).strict(),
  supersede: z
    .object({ expectedRevision: revision, replacementId: id, reason })
    .strict(),
  "check-applicability": z
    .object({ expectedRevision: revision, snapshotId: snapshot })
    .strict(),
  review: z
    .object({
      expectedRevision: revision,
      outcome: z.enum(["still_applicable", "withdraw"]),
      reason,
    })
    .strict(),
};
for (const [path, schema] of Object.entries(actions))
  engineeringMemoryRoutes.post(`/records/:id/${path}`, (req, res) =>
    res.json(
      changeMemory(
        req.collaborator.id,
        id.parse(req.params.id),
        path === "revisions"
          ? "revise"
          : path === "check-applicability"
            ? "check"
            : path,
        schema.parse(req.body),
      ),
    ),
  );
