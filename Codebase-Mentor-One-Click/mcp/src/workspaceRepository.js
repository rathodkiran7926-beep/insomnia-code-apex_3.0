import { execFileSync } from "node:child_process";

function normalizeGitHubUrl(value) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  let candidate = input;
  const ssh = /^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(input);
  if (ssh) candidate = `https://github.com/${ssh[1]}`;
  else if (/^ssh:\/\/git@github\.com\//i.test(input))
    candidate = input.replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/");
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || parts.some((part) => part === "." || part === "..")) return null;
    const [owner, repoRaw] = parts;
    const repo = repoRaw.replace(/\.git$/i, "");
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
    return `https://github.com/${owner}/${repo}`;
  } catch {
    return null;
  }
}

export function getWorkspaceRepositoryUrl() {
  const configured = normalizeGitHubUrl(process.env.CODEBASE_MENTOR_REPOSITORY_URL);
  if (configured) return configured;

  const cwd = process.env.CODEBASE_MENTOR_WORKSPACE || process.cwd();
  for (const remoteName of ["origin", "upstream"]) {
    try {
      const remote = execFileSync("git", ["remote", "get-url", remoteName], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1500,
        windowsHide: true,
      }).trim();
      const normalized = normalizeGitHubUrl(remote);
      if (normalized) return normalized;
    } catch {
      // A workspace without this remote is valid; try the next candidate.
    }
  }
  return null;
}
