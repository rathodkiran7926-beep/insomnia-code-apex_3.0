import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { db } from "./storage.js";
import { boundedFetch, parseRepository } from "./github.js";
const run = promisify(execFile);
const root = fileURLToPath(
  new URL("../data/merge-simulations/", import.meta.url),
);
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const LIMIT = 256000;
function text(value) {
  if (Buffer.byteLength(value, "utf8") > LIMIT || value.includes("\0"))
    throw fail("Simulation supports text files up to 256 KB.");
  return value;
}

export async function mergeText(base, target, incoming, signal) {
  for (const value of [base, target, incoming]) if (value !== null) text(value);
  if (signal?.aborted) throw fail("Simulation cancelled", 499);
  if (target === incoming)
    return {
      status: "clean",
      conflicts: 0,
      merged: target,
      reason: "Both versions already have the same file contents.",
    };
  if (base === target)
    return {
      status: "clean",
      conflicts: 0,
      merged: incoming,
      reason:
        incoming === null
          ? "The PR removes a file unchanged on the target."
          : "The target file is unchanged from the common ancestor; the PR version applies directly.",
    };
  if (base === incoming)
    return {
      status: "clean",
      conflicts: 0,
      merged: target,
      reason:
        "The PR leaves this file unchanged; target changes are preserved.",
    };
  if (base === null)
    return {
      status: "conflict",
      conflicts: 1,
      merged: target,
      reason:
        "Both sides added this path with different contents. Review both versions before choosing a result.",
    };
  if (target === null || incoming === null)
    return {
      status: "conflict",
      conflicts: 1,
      merged: target ?? incoming,
      reason:
        "One side deleted this file while the other modified it. A manual keep/delete decision is needed.",
    };
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(resolve(root, "merge-"));
  try {
    const paths = ["target.txt", "ancestor.txt", "incoming.txt"].map((name) =>
      resolve(directory, name),
    );
    await Promise.all(
      paths.map((path, i) =>
        writeFile(path, [target, base, incoming][i], "utf8"),
      ),
    );
    const options = {
      cwd: directory,
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      signal,
      encoding: "utf8",
    };
    const args = [
      "merge-file",
      "--stdout",
      "--diff3",
      "-L",
      "Target branch",
      "-L",
      "Common ancestor",
      "-L",
      "PR changes",
      ...paths,
    ];
    try {
      const result = await run("git", args, options);
      return {
        status: "clean",
        conflicts: 0,
        merged: result.stdout,
        reason: "Git combined the independent text changes without a conflict.",
      };
    } catch (error) {
      if (signal?.aborted) throw fail("Simulation cancelled", 499);
      if (
        Number.isInteger(error.code) &&
        error.code > 0 &&
        error.code <= 127 &&
        typeof error.stdout === "string"
      )
        return {
          status: "conflict",
          conflicts: error.code,
          merged: error.stdout,
          reason:
            "Both sides changed overlapping text. Conflict markers show target, ancestor, and PR alternatives.",
        };
      if (error.code === "ENOENT")
        throw fail(
          "Git is required for three-way simulation. Install Git and restart the backend.",
          503,
        );
      throw fail(
        "Git could not simulate this file within text and time limits.",
        502,
      );
    }
  } finally {
    // Only remove the fixed-name temporary directory created for this request.
    const absolute = resolve(directory);
    if (
      absolute.startsWith(resolve(root) + sep) &&
      absolute.split(sep).at(-1).startsWith("merge-")
    )
      await rm(absolute, { recursive: true, force: true });
  }
}

async function readPinned(repository, commit, path, snapshotId, signal) {
  if (snapshotId) {
    const saved = db
      .prepare(
        "SELECT content FROM source_files WHERE snapshot_id=? AND path=?",
      )
      .get(snapshotId, path);
    if (saved) return text(saved.content);
  }
  const repo = parseRepository(repository);
  if (!/^[a-f0-9]{40}$/i.test(commit)) throw fail("Invalid comparison commit");
  try {
    const payload = JSON.parse(
      await boundedFetch(
        `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${commit}`,
        {
          signal,
          limit: 400000,
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "Codebase-Mentor",
            ...(process.env.GITHUB_TOKEN
              ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
              : {}),
          },
        },
      ),
    );
    if (
      payload.type !== "file" ||
      payload.path !== path ||
      payload.encoding !== "base64" ||
      typeof payload.content !== "string" ||
      payload.size > LIMIT
    )
      throw fail(
        "Complete text is unavailable for this file within simulation limits.",
      );
    const bytes = Buffer.from(payload.content, "base64");
    if (bytes.length > LIMIT || bytes.includes(0))
      throw fail("Binary or oversized files cannot be simulated.");
    return bytes.toString("utf8");
  } catch (error) {
    if (error.remoteStatus === 404) return null;
    throw error;
  }
}
export async function simulateFile(comparison, path, signal) {
  const file = comparison.pr.files.find((f) => f.path === path);
  if (!file) throw fail("Choose a changed file from this comparison.", 404);
  if (
    file.hidden ||
    /(^|\/)(\.env[^/]*|[^/]*(?:secret|credential|private.?key)[^/]*|node_modules|\.git)(\/|$)/i.test(
      path,
    )
  )
    throw fail("Sensitive or dependency paths cannot be simulated.", 403);
  if (path.split("/").some((p) => !p || p === "." || p === ".."))
    throw fail("Invalid file path");
  if (file.previousPath)
    throw fail(
      "File renames need a tree-level merge. This per-file simulator does not simulate renames.",
    );
  const p = comparison.pr;
  const base =
    file.status === "added"
      ? null
      : await readPinned(
          p.baseRepository,
          p.baseCommit,
          path,
          comparison.beforeSnapshotId,
          signal,
        );
  const incoming =
    file.status === "removed"
      ? null
      : await readPinned(
          p.headRepository,
          p.headCommit,
          path,
          comparison.afterSnapshotId,
          signal,
        );
  if (
    (file.status !== "added" && base === null) ||
    (file.status !== "removed" && incoming === null)
  )
    throw fail(
      "Expected source is missing at the pinned PR commits. This file cannot be simulated.",
      422,
    );
  const target =
    p.targetCommit === p.baseCommit
      ? base
      : await readPinned(p.baseRepository, p.targetCommit, path, null, signal);
  const result = await mergeText(base, target, incoming, signal);
  return {
    comparisonId: comparison.id,
    path,
    baseCommit: p.baseCommit,
    targetCommit: p.targetCommit,
    headCommit: p.headCommit,
    base,
    target,
    incoming,
    ...result,
    limitation:
      "Text-only simulation of this file at captured commits. No repository files, branches, or PRs are changed. A clean text merge is not a runtime or whole-PR safety verdict.",
  };
}
