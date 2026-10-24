import { Router } from "express";
import { db } from "./storage.js";
import { safeRequest } from "./localSingleUser.js";
import { buildHandoffPreview } from "./ideHandoffContext.js";
import {
  migrateHandoffs,
  handoffId,
  scopeQuery,
  listHandoffs,
  getHandoff,
  deleteHandoff,
  createHandoff,
} from "./handoffs.js";
migrateHandoffs(db);
export const handoffRoutes = Router();
const enabled = (req) =>
  process.env.CODEBASE_MENTOR_LOCAL_HANDOFFS === "1" && safeRequest(req);
handoffRoutes.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
handoffRoutes.get("/capabilities", (req, res) =>
  res.json({
    enabled: enabled(req),
    mode: "local-single-user",
    schemaVersion: 1,
    notice:
      "Explicit local single-user preparation only. No production authentication, repository authorization, secure sharing, delivery or authenticated senior replies.",
  }),
);
handoffRoutes.use((req, res, next) =>
  enabled(req)
    ? next()
    : res
        .status(403)
        .json({
          error:
            "Handoffs require explicitly enabled local single-user mode and a direct safe loopback request.",
        }),
);
const handle = (fn) => (req, res, next) => {
  try {
    fn(req, res);
  } catch (e) {
    next(e);
  }
};
handoffRoutes.post(
  "/preview",
  handle((req, res) => res.json(buildHandoffPreview(db, req.body))),
);
handoffRoutes.post(
  "/",
  handle((req, res) => {
    const result = createHandoff(db, req.body);
    res.status(result.created ? 201 : 200).json(result.handoff);
  }),
);
handoffRoutes.get(
  "/",
  handle((req, res) => res.json(listHandoffs(db, req.query))),
);
handoffRoutes.get(
  "/:id/export",
  handle((req, res) => {
    const saved = getHandoff(
      db,
      handoffId.parse(req.params.id),
      scopeQuery.parse(req.query).snapshotId,
    );
    res.json({ id: saved.id, markdown: saved.markdown, digest: saved.digest });
  }),
);
handoffRoutes.get(
  "/:id",
  handle((req, res) =>
    res.json(
      getHandoff(
        db,
        handoffId.parse(req.params.id),
        scopeQuery.parse(req.query).snapshotId,
      ),
    ),
  ),
);
handoffRoutes.delete(
  "/:id",
  handle((req, res) =>
    res.json(
      deleteHandoff(
        db,
        handoffId.parse(req.params.id),
        scopeQuery.parse(req.query).snapshotId,
      ),
    ),
  ),
);
