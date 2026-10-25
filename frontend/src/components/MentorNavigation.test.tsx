import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MentorNavigation } from './MentorNavigation';

const repositoryState = vi.hoisted(() => ({
  snapshot: null as null | { repository: string; branch: string; revision: string; commit: string },
  requestedRevisionLabel: null as string | null,
}));

vi.mock('../state/RepositoryAnalysisContext', () => ({
  useRepositoryAnalysis: () => ({ ...repositoryState, repositoryUrl: '' }),
}));

afterEach(() => {
  repositoryState.snapshot = null;
  repositoryState.requestedRevisionLabel = null;
});

describe('sidebar selection', () => {
  it.each([
    ['/repository', 'Architecture'],
    ['/repository?tab=documentation', 'Documentation'],
    ['/workspace', 'Workspace'],
    ['/workspace?discuss=1', 'Text and Voice'],
    ['/changes?tab=setup', 'PR Changes'],
    ['/learn/journey', 'My Learning Path'],
  ])('highlights only the selected entry at %s', (route, selected) => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={[route]}>
        <MentorNavigation onSettings={() => {}} />
      </MemoryRouter>,
    );
    const links = html.match(/<a\b[^>]*>/g) || [];
    const highlighted = links.filter((link) => /class="[^"]*\bactive\b/.test(link));
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]).toContain(`aria-label="${selected}"`);
    expect(highlighted[0]).toContain('aria-current="page"');
  });
});

it('shows the verified request label without relabeling the immutable snapshot', () => {
  repositoryState.snapshot = { repository: 'https://github.com/example/repo', branch: 'main', revision: 'main', commit: 'abcdef123456' };
  repositoryState.requestedRevisionLabel = 'release';
  const markup = renderToStaticMarkup(
    <MemoryRouter><MentorNavigation onSettings={() => {}} /></MemoryRouter>,
  );
  expect(markup).toContain('release / abcdef12');
  expect(repositoryState.snapshot.branch).toBe('main');
  repositoryState.requestedRevisionLabel = null;
  const legacyMarkup = renderToStaticMarkup(
    <MemoryRouter><MentorNavigation onSettings={() => {}} /></MemoryRouter>,
  );
  expect(legacyMarkup).toContain('main / abcdef12');
});
