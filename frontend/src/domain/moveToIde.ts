export function moveToIdeUri(source: { file: string; url: string; startLine: number; endLine: number }, line: number): string {
  const url = new URL(source.url);
  const parts = url.pathname.split('/').map(decodeURIComponent);
  if (url.origin !== 'https://github.com' || url.username || url.password || url.search ||
      parts[3] !== 'blob' || !/^[a-f0-9]{40}$/i.test(parts[4] || '') ||
      !parts[1] || !parts[2] || parts.slice(5).join('/') !== source.file ||
      !source.file || source.file.length > 1000 || /[\\:\x00-\x1f\x7f]|%[a-f0-9]{2}/i.test(source.file) ||
      source.file.split('/').some(part => !part || ['.', '..', '.git'].includes(part.toLowerCase())) ||
      !Number.isSafeInteger(line) || line < source.startLine || line > source.endLine || line > 1000000)
    throw new Error('This source does not have a safe, commit-pinned IDE location.');
  const query = new URLSearchParams({ repository: `https://github.com/${parts[1]}/${parts[2]}`.toLowerCase(),
    commit: parts[4].toLowerCase(), file: source.file, line: String(line) });
  return `vscode://codebase-mentor-local.codebase-mentor/open-source?${query}`;
}
