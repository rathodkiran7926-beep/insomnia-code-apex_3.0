import { gunzipSync } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import tar from "tar-stream";
import { isSetupPath } from "./setupRequirements.js";
const MAX_RESPONSE = 8 * 1024 * 1024;
export async function boundedFetch(
  url,
  { limit = MAX_RESPONSE, binary = false, headers = {}, ...options } = {},
) {
  let response;
  let current = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    try {
      response = await fetch(current, {
        ...options,
        redirect: "manual",
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
        headers,
      });
    } catch (error) {
      const code = error.cause?.code || error.code;
      if (code === "EACCES" || code === "EPERM") {
        throw Object.assign(
          new Error(
            `Network access to ${current.hostname} was denied by the operating system (${code}). Restart the backend from a normal terminal outside the restricted environment: cd backend, then npm.cmd run dev. If access is still denied, check your firewall or proxy settings.${current.hostname === "api.github.com" ? " A GitHub token cannot fix this network permission error." : ""}`,
          ),
          { code },
        );
      }
      throw Object.assign(
        new Error(
          `Cannot reach ${current.hostname}: ${error.cause?.code || error.message}. Check network access and retry.`,
        ),
        { code },
      );
    }
    if (![301, 302, 307, 308].includes(response.status)) break;
    const next = new URL(response.headers.get("location"), current);
    await response.body?.cancel();
    if (redirects === 3 || next.origin !== new URL(url).origin)
      throw new Error(
        "Remote redirect is outside the allowed origin or exceeds limits",
      );
    current = next;
  }
  if (!response.ok)
    throw Object.assign(
      new Error(
        `Remote request failed (${response.status}). Check repository, revision, or API rate limit.`,
      ),
      { remoteStatus: response.status },
    );
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) {
      await response.body.cancel().catch(() => {});
      throw new Error("Remote response exceeds analysis limits");
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  return binary ? body : body.toString("utf8");
}
export function parseRepository(value) {
  const match =
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(value);
  if (!match || match.slice(1).some((x) => x === "." || x === ".."))
    throw new Error("Enter a public https://github.com/owner/repository URL");
  return {
    owner: match[1],
    name: match[2],
    url: `https://github.com/${match[1]}/${match[2]}`,
  };
}
export async function downloadRepository(url, revision, progress) {
  const repo = parseRepository(url);
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Codebase-Mentor",
    ...(process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {}),
  };
  const api = `https://api.github.com/repos/${repo.owner}/${repo.name}`;
  const get = async (endpoint) =>
    JSON.parse(await boundedFetch(`${api}${endpoint}`, { headers }));
  const metadata = await get("");
  if (metadata.private)
    throw new Error("Only public repositories are supported");
  const commit = (
    await get(
      `/commits/${encodeURIComponent(revision || metadata.default_branch)}`,
    )
  ).sha;
  progress(15, `Resolved commit ${commit.slice(0, 12)}`);
  const tree = await get(`/git/trees/${commit}?recursive=1`);
  const exclusions = [];
  const selected = [];
  let total = 0;
  for (const entry of tree.tree) {
    if (entry.type !== "blob") continue;
    const p = entry.path;
    if (
      entry.mode === "120000" ||
      /(^|\/)(node_modules|dist|build|coverage|vendor|generated|\.git)(\/|$)|\.min\.[cm]?js$|\.d\.ts$|(^|\/)\.env|secret|credential|private.?key/i.test(
        p,
      )
    ) {
      exclusions.push({
        path: p,
        reason:
          "Excluded dependency, generated output, symlink, or sensitive path",
      });
      continue;
    }
    if (
      !/\.(?:[cm]?[jt]s|tsx|jsx)$|(^|\/)(package\.json|tsconfig\.json|README\.md)$/i.test(
        p,
      )
    )
      continue;
    if (
      entry.size > 256000 ||
      selected.length >= 200 ||
      total + entry.size > 5 * 1024 * 1024
    ) {
      exclusions.push({ path: p, reason: "File, count, or total byte limit" });
      continue;
    }
    selected.push(entry);
    total += entry.size;
  }
  if (tree.truncated)
    exclusions.push({
      path: "*",
      reason: "GitHub tree was truncated; analysis is incomplete",
    });
  progress(25, "Downloading bounded source archive");
  const compressed = await boundedFetch(
    `https://codeload.github.com/${repo.owner}/${repo.name}/tar.gz/${commit}`,
    { limit: 12 * 1024 * 1024, binary: true },
  );
  const archive = gunzipSync(compressed, { maxOutputLength: 32 * 1024 * 1024 });
  const files = {},
    wanted = new Set(selected.map((e) => e.path));
  const extract = tar.extract();
  extract.on("entry", (header, stream, next) => {
    const p = header.name.split("/").slice(1).join("/");
    if (!wanted.has(p) || header.type !== "file" || header.size > 256000) {
      stream.resume();
      stream.on("end", next);
      return;
    }
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (body.includes("\0"))
        exclusions.push({ path: p, reason: "Binary content" });
      else files[p] = body;
      next();
    });
  });
  await pipeline(Readable.from([archive]), extract);
  for (const entry of selected)
    if (
      !Object.hasOwn(files, entry.path) &&
      !exclusions.some((e) => e.path === entry.path)
    )
      exclusions.push({
        path: entry.path,
        reason: "Not a regular file in archive",
      });
  progress(
    55,
    `Loaded ${Object.keys(files).length} eligible files from commit archive`,
  );
  return {
    repository: repo.url,
    commit,
    branch: revision ? null : metadata.default_branch,
    revision: revision || metadata.default_branch,
    files,
    exclusions,
    setupMetadata: {
      paths: tree.tree
        .filter(
          (e) =>
            e.type === "blob" && e.mode !== "120000" && isSetupPath(e.path),
        )
        .map((e) => e.path),
      limited: !!tree.truncated,
    },
  };
}
