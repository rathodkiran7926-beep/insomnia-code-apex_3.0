import { db } from "./storage.js";
import { boundedFetch, parseRepository } from "./github.js";
import { deriveSetupPlan, isSetupPath } from "./setupRequirements.js";

export async function snapshotSetupPlan(snapshotId, signal) {
  const row = db
    .prepare("SELECT graph_json FROM snapshots WHERE id=?")
    .get(snapshotId);
  if (!row)
    throw Object.assign(new Error("Setup source snapshot not found"), {
      status: 404,
    });
  const graph = JSON.parse(row.graph_json);
  let metadataRow = db
    .prepare("SELECT data FROM snapshot_setup_metadata WHERE snapshot_id=?")
    .get(snapshotId);
  let metadata = metadataRow ? JSON.parse(metadataRow.data) : null;
  let discoveryWarning = "";
  if (!metadata) {
    try {
      const repo = parseRepository(graph.repository);
      if (!/^[a-f0-9]{40}$/i.test(graph.commit))
        throw new Error("Invalid snapshot commit");
      const response = JSON.parse(
        await boundedFetch(
          `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/${graph.commit}?recursive=1`,
          {
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
              : AbortSignal.timeout(10000),
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
      if (!Array.isArray(response.tree))
        throw new Error("Tree metadata unavailable");
      metadata = {
        paths: response.tree
          .filter(
            (e) =>
              e.type === "blob" && e.mode !== "120000" && isSetupPath(e.path),
          )
          .map((e) => e.path),
        limited: !!response.truncated,
      };
      db.prepare(
        "INSERT OR REPLACE INTO snapshot_setup_metadata VALUES (?,?)",
      ).run(snapshotId, JSON.stringify(metadata));
    } catch (error) {
      if (signal?.aborted) throw error;
      metadata = { paths: [], limited: true };
      discoveryWarning =
        "Pinned lockfile/configuration paths could not be loaded. Package-manager and template discovery may be incomplete; Retry setup scan to try again.";
    }
  }
  const files = Object.fromEntries(
    db
      .prepare("SELECT path,content FROM source_files WHERE snapshot_id=?")
      .all(snapshotId)
      .map((row) => [row.path, row.content]),
  );
  const plan = deriveSetupPlan({ graph, files, metadata });
  if (discoveryWarning) plan.warnings.unshift(discoveryWarning);
  return plan;
}
export async function comparisonSetupPlan(comparison, signal) {
  const [before, after] = await Promise.all([
    snapshotSetupPlan(comparison.beforeSnapshotId, signal),
    snapshotSetupPlan(comparison.afterSnapshotId, signal),
  ]);
  const key = (e) => e.directory + "\0" + e.name;
  return {
    comparisonId: comparison.id,
    before,
    after,
    changes: {
      addedEnvironment: after.environment.filter(
        (e) => !before.environment.some((x) => key(e) === key(x)),
      ),
      removedEnvironment: before.environment.filter(
        (e) => !after.environment.some((x) => key(e) === key(x)),
      ),
      addedServices: after.services.filter(
        (e) => !before.services.some((x) => key(e) === key(x)),
      ),
    },
  };
}
