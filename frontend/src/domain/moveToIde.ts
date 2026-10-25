export type IdeTarget = { snapshotId: string; repository: string; commit: string };
export function moveToIdeUri(source: { file: string; url: string; startLine: number; endLine: number }, line: number, target: IdeTarget): string {
  const url = new URL(source.url);
  const parts = url.pathname.split('/').map(decodeURIComponent);
  const repository = `https://github.com/${parts[1]}/${parts[2]}`.toLowerCase();
  if (!target || !/^[\w-]{1,150}$/.test(target.snapshotId) || !/^[a-f0-9]{40}$/i.test(target.commit) ||
      !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(target.repository) ||
      target.repository.toLowerCase() !== repository || target.commit.toLowerCase() !== parts[4]?.toLowerCase() ||
      url.origin !== 'https://github.com' || url.username || url.password || url.search ||
      parts[3] !== 'blob' || !/^[a-f0-9]{40}$/i.test(parts[4] || '') ||
      !parts[1] || !parts[2] || parts.slice(5).join('/') !== source.file ||
      !source.file || source.file.length > 1000 || /[\\:\x00-\x1f\x7f]|%[a-f0-9]{2}/i.test(source.file) ||
      source.file.split('/').some(part => !part || ['.', '..', '.git'].includes(part.toLowerCase())) ||
      !Number.isSafeInteger(line) || line < source.startLine || line > source.endLine || line > 1000000)
    throw new Error('This source does not have a safe, snapshot-pinned IDE location.');
  const query = new URLSearchParams({ snapshotId: target.snapshotId, repository,
    commit: target.commit.toLowerCase(), file: source.file, line: String(line) });
  return `vscode://codebase-mentor-local.codebase-mentor/moveToSource?${query}`;
}
