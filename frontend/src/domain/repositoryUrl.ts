export function canonicalRepositoryUrl(value: string): string {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(value.trim());
  if (!match || match.slice(1).some((part) => part === '.' || part === '..')) return '';
  return `https://github.com/${match[1]}/${match[2]}`;
}
