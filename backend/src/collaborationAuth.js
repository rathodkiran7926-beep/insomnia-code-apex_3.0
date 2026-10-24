import { Router } from "express";
import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { db, transaction } from "./handoffStorage.js";

const derive = promisify(scrypt);
const DAY = 86400000;
export const fail = (status, message) =>
  Object.assign(new Error(message), { status });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const cookieName = "mentor_collaboration";
const safeUser = (u) => ({ id: u.id, email: u.email, name: u.name });
export function authenticate(req, _res, next) {
  const cookie = (req.headers.cookie || "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookieName + "="));
  const token = cookie?.slice(cookieName.length + 1);
  const user =
    token &&
    /^[a-f0-9]{64}$/.test(token) &&
    db
      .prepare(
        `SELECT u.* FROM collaboration_auth_sessions s
    JOIN collaboration_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`,
      )
      .get(hash(token), Date.now());
  if (!user) return next(fail(401, "Sign in to open team handoffs."));
  req.collaborator = safeUser(user);
  next();
}
function setSession(res, userId) {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM collaboration_auth_sessions WHERE expires_at<?").run(
    Date.now(),
  );
  db.prepare("INSERT INTO collaboration_auth_sessions VALUES (?,?,?)").run(
    hash(token),
    userId,
    Date.now() + 7 * DAY,
  );
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * DAY,
    path: "/api",
  });
}
export function membership(userId, workspaceId) {
  const member = db
    .prepare(
      "SELECT * FROM collaboration_members WHERE user_id=? AND workspace_id=?",
    )
    .get(userId, workspaceId);
  if (!member) throw fail(404, "Workspace not found or access is unavailable.");
  return member;
}
function invite(token) {
  const row = db
    .prepare(
      "SELECT * FROM collaboration_invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
    )
    .get(hash(token), Date.now());
  if (!row) throw fail(400, "Invitation is invalid, expired, or already used.");
  return row;
}
function join(userId, token) {
  const row = invite(token);
  // An invite never changes an existing member's role.
  db.prepare("INSERT OR IGNORE INTO collaboration_members VALUES (?,?,?)").run(
    row.workspace_id,
    userId,
    row.role,
  );
  db.prepare(
    "UPDATE collaboration_invites SET used_at=? WHERE token_hash=?",
  ).run(new Date().toISOString(), hash(token));
}
export const collaborationRoutes = Router();
const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(12).max(200),
});
const attempts = new Map();
collaborationRoutes.use((req, _res, next) => {
  if (!["/login", "/register"].includes(req.path)) return next();
  const key = req.ip || "local",
    now = Date.now();
  if (attempts.size > 1000)
    for (const [k, v] of attempts)
      if (now - v.start > 900000) attempts.delete(k);
  let entry = attempts.get(key);
  if (!entry || now - entry.start > 900000)
    attempts.set(key, (entry = { start: now, count: 0 }));
  if (++entry.count > 30)
    return next(
      fail(429, "Too many sign-in attempts. Try again in 15 minutes."),
    );
  next();
});
collaborationRoutes.post("/register", async (req, res) => {
  const body = credentials
    .extend({
      name: z.string().trim().min(1).max(80),
      inviteToken: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .strict()
    .parse(req.body);
  if (body.inviteToken) invite(body.inviteToken);
  const salt = randomBytes(16).toString("hex");
  const password = `${salt}:${Buffer.from(await derive(body.password, salt, 64)).toString("hex")}`;
  const user = { id: randomUUID(), name: body.name, email: body.email };
  transaction(() => {
    if (
      db
        .prepare("SELECT id FROM collaboration_users WHERE email=?")
        .get(body.email)
    )
      throw fail(409, "An account already exists. Sign in instead.");
    db.prepare("INSERT INTO collaboration_users VALUES (?,?,?,?,?)").run(
      user.id,
      user.email,
      user.name,
      password,
      new Date().toISOString(),
    );
    if (body.inviteToken) join(user.id, body.inviteToken);
    else {
      const workspaceId = randomUUID();
      db.prepare("INSERT INTO collaboration_workspaces VALUES (?,?,?)").run(
        workspaceId,
        `${user.name}'s team`,
        new Date().toISOString(),
      );
      db.prepare("INSERT INTO collaboration_members VALUES (?,?,?)").run(
        workspaceId,
        user.id,
        "maintainer",
      );
    }
  });
  setSession(res, user.id);
  res.status(201).json({ user });
});
collaborationRoutes.post("/login", async (req, res) => {
  const body = credentials.strict().parse(req.body);
  const user = db
    .prepare("SELECT * FROM collaboration_users WHERE email=?")
    .get(body.email);
  const [salt, saved] = (
    user?.password_hash || "00000000000000000000000000000000:" + "0".repeat(128)
  ).split(":");
  const actual = Buffer.from(await derive(body.password, salt, 64));
  if (!user || !timingSafeEqual(actual, Buffer.from(saved, "hex")))
    throw fail(401, "Email or password is incorrect.");
  setSession(res, user.id);
  res.json({ user: safeUser(user) });
});
collaborationRoutes.use(authenticate);
collaborationRoutes.get("/me", (req, res) => {
  const workspaces = db
    .prepare(
      `SELECT w.*, m.role FROM collaboration_workspaces w JOIN collaboration_members m ON m.workspace_id=w.id WHERE m.user_id=?`,
    )
    .all(req.collaborator.id);
  res.json({ user: req.collaborator, workspaces });
});
collaborationRoutes.post("/logout", (req, res) => {
  const token = (req.headers.cookie || "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  if (token)
    db.prepare(
      "DELETE FROM collaboration_auth_sessions WHERE token_hash=?",
    ).run(hash(token));
  res.clearCookie(cookieName, { path: "/api" });
  res.json({ ok: true });
});
collaborationRoutes.post("/accept-invite", (req, res) => {
  const { token } = z
    .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict()
    .parse(req.body);
  transaction(() => join(req.collaborator.id, token));
  res.json({ ok: true });
});
collaborationRoutes.get("/workspaces/:id/members", (req, res) => {
  membership(req.collaborator.id, req.params.id);
  res.json({
    members: db
      .prepare(
        `SELECT u.id,u.name,u.email,m.role FROM collaboration_members m JOIN collaboration_users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY u.name`,
      )
      .all(req.params.id),
  });
});
collaborationRoutes.post("/workspaces/:id/invites", (req, res) => {
  if (membership(req.collaborator.id, req.params.id).role !== "maintainer")
    throw fail(403, "Only maintainers can invite teammates.");
  const { role } = z
    .object({ role: z.enum(["reviewer", "developer"]) })
    .strict()
    .parse(req.body);
  const token = randomBytes(32).toString("hex"),
    expiresAt = Date.now() + 7 * DAY;
  db.prepare("INSERT INTO collaboration_invites VALUES (?,?,?,?,?,NULL)").run(
    hash(token),
    req.params.id,
    role,
    req.collaborator.id,
    expiresAt,
  );
  res.status(201).json({ token, expiresAt, role });
});
