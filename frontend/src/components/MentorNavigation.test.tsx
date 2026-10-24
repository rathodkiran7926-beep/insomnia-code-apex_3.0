import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MentorNavigation } from './MentorNavigation';

vi.mock('../state/RepositoryAnalysisContext', () => ({
  useRepositoryAnalysis: () => ({ snapshot: null, repositoryUrl: '' }),
}));

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
