import { expect, it } from 'vitest';
import { canonicalRepositoryUrl } from './repositoryUrl';

it('shares a canonical public repository URL, including pasted .git URLs', () => {
  expect(canonicalRepositoryUrl(' https://github.com/example/project.git/ ')).toBe(
    'https://github.com/example/project',
  );
  expect(canonicalRepositoryUrl('https://github.com/example/project')).toBe(
    'https://github.com/example/project',
  );
});
it('rejects partial input, provider lookalikes, credentials, extra paths and traversal', () => {
  for (const url of [
    '',
    'https://github.com/example',
    'https://evil.example/x/y',
    'https://github.com.evil.example/x/y',
    'https://user:pass@github.com/x/y',
    'https://github.com/x/y/pull/1',
    'https://github.com/../repo',
  ])
    expect(canonicalRepositoryUrl(url)).toBe('');
});
