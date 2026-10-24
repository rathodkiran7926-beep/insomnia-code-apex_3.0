import { boundedFetch, parseRepository } from "./github.js";

export async function listPullRequests(
  repository,
  state = "all",
  page = 1,
  signal,
) {
  const repo = parseRepository(repository);
  if (
    !["open", "closed", "all"].includes(state) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 100
  )
    throw Object.assign(new Error("Invalid PR list filters"), { status: 400 });
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Codebase-Mentor",
    ...(process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {}),
  };
  const get = async (path) => {
    try {
      return JSON.parse(await boundedFetch(
        `https://api.github.com/repos/${repo.owner}/${repo.name}${path}`,
        { headers, signal },
      ));
    } catch (error) {
      const messages = {
        401: 'GitHub rejected GITHUB_TOKEN. Update it in backend/.env and restart the backend, or remove it for public access.',
        403: 'GitHub denied access or its API quota was reached. Check token permissions and GitHub API usage, then retry.',
        404: 'Repository not found or unavailable. Select an accessible public GitHub repository.',
        429: 'GitHub rate limit reached. Wait before refreshing pull requests.',
      };
      if (messages[error.remoteStatus]) error.message = messages[error.remoteStatus];
      throw error;
    }
  };
  const metadata = await get("");
  if (metadata.private)
    throw Object.assign(new Error("Only public repositories are supported"), {
      status: 400,
    });
  const rows = await get(
    `/pulls?state=${state}&sort=updated&direction=desc&per_page=30&page=${page}`,
  );
  if (!Array.isArray(rows))
    throw new Error("GitHub returned an invalid pull request list");
  return {
    repository: repo.url,
    state,
    page,
    fetchedAt: new Date().toISOString(),
    hasMore: rows.length === 30,
    pullRequests: rows.map((p) => ({
      number: p.number,
      title: String(p.title).slice(0, 500),
      url: `${repo.url}/pull/${p.number}`,
      state: p.state,
      draft: !!p.draft,
      merged: !!p.merged_at,
      head: p.head?.ref || "",
      base: p.base?.ref || "",
      updatedAt: p.updated_at,
      author: String(p.user?.login || '').slice(0, 100),
    })),
  };
}

export function parsePullRequest(url) {
  const match =
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)\/?$/.exec(
      url,
    );
  if (!match)
    throw Object.assign(
      new Error(
        "Enter a public GitHub PR URL: https://github.com/owner/repo/pull/123",
      ),
      { status: 400 },
    );
  const repository = parseRepository(
    `https://github.com/${match[1]}/${match[2]}`,
  );
  return { ...repository, number: Number(match[3]) };
}
export async function fetchPullRequest(url) {
  const repo = parsePullRequest(url);
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Codebase-Mentor",
    ...(process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {}),
  };
  const get = async (path) =>
    JSON.parse(
      await boundedFetch(
        `https://api.github.com/repos/${repo.owner}/${repo.name}${path}`,
        { headers },
      ),
    );
  const pr = await get(`/pulls/${repo.number}`);
  if (
    !pr.base?.repo ||
    !pr.head?.repo ||
    pr.base.repo.private ||
    pr.head.repo.private
  )
    throw new Error(
      "Only PRs with available public base and head repositories are supported.",
    );
  for (const value of [pr.base.sha, pr.head.sha])
    if (!/^[a-f0-9]{40}$/i.test(value))
      throw new Error("GitHub returned an invalid commit.");
  const baseRepository = parseRepository(
    `https://github.com/${pr.base.repo.full_name}`,
  ).url;
  const headRepository = parseRepository(
    `https://github.com/${pr.head.repo.full_name}`,
  ).url;
  const comparison = await get(
    `/compare/${pr.base.sha}...${encodeURIComponent(pr.head.repo.owner.login + ":" + pr.head.sha)}`,
  );
  const baseCommit = comparison.merge_base_commit?.sha;
  if (!/^[a-f0-9]{40}$/i.test(baseCommit))
    throw new Error("Could not resolve the common ancestor of this PR.");
  // A final check rejects a PR which moved while the metadata was read.
  const current = await get(`/pulls/${repo.number}`);
  if (current.head.sha !== pr.head.sha || current.base.sha !== pr.base.sha)
    throw new Error(
      "This PR changed during analysis. Retry to analyze its latest commits.",
    );
  return {
    url: repo.url + "/pull/" + repo.number,
    number: repo.number,
    title: String(pr.title).slice(0, 500),
    state: pr.state,
    baseRepository,
    headRepository,
    baseCommit,
    headCommit: pr.head.sha,
    targetCommit: pr.base.sha,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    changedFiles: pr.changed_files,
    files: (comparison.files || []).map((f) => {
      const hidden =
        /(^|\/)(\.env[^/]*|[^/]*(?:secret|credential|private.?key)[^/]*)$/i.test(
          f.filename,
        );
      const template = /(^|\/)\.env\.(example|sample|template)$/i.test(
        f.filename,
      );
      const envNames = template
        ? (f.patch || "").split("\n").flatMap((line) => {
            const m = /^([+-])(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(
              line,
            );
            return m
              ? [{ name: m[2], change: m[1] === "+" ? "added" : "removed" }]
              : [];
          })
        : [];
      return {
        path: f.filename,
        previousPath: f.previous_filename || null,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: hidden ? null : f.patch?.slice(0, 100000) || null,
        hidden,
        envNames,
        patchLimited: !hidden && (!f.patch || f.patch.length > 100000),
      };
    }),
    limited:
      (comparison.files?.length || 0) >= 300 ||
      (comparison.files?.length || 0) < pr.changed_files,
  };
}
