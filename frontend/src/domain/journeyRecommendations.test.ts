import { describe, it, expect } from 'vitest';
import { normalizeSkills, journeySkills, recommendJourneys } from './journeyRecommendations';
import { learningJourneyLocation } from './learningJourneyLocation';
import type { CodeJourney, JourneyCheckpoint, JourneyEvent } from './codeJourney';
const repo = 'https://github.com/test/repo';
function journey(
  id: string,
  tags: string[] = ['Express'],
  snapshotId = 's1',
  repository = repo,
): CodeJourney {
  return {
    id,
    tags,
    snapshotId,
    repository,
    title: id,
    description: 'Actual source',
    topic: 'HTTP routes',
    difficulty: 'unrated',
    minutes: null,
    source: '',
    sourceHash: 'h',
    events: [{ source: { file: 'src/routes.ts' } } as JourneyEvent],
    scenarios: [
      { id: 'path-1', label: 'main', assumption: 'source', outcome: 'source', path: ['a', 'b'] },
    ],
    related: [],
    visualization: 'flow',
    provenance: 'source',
    coverage: [],
  };
}
const checkpoint = (id: string, completed = false, snapshotId = 's1'): JourneyCheckpoint => ({
  journeyId: id,
  snapshotId,
  traceId: 't',
  scenarioId: 'path-1',
  eventId: 'a',
  level: 'intermediate',
  visited: ['a'],
  predictions: {},
  completed,
  updatedAt: '2026-10-25',
});
describe('Learning Path recommendations', () => {
  it('normalizes aliases without inventing skills or levels', () => {
    expect(normalizeSkills([' Node ', 'Node.js', 'express.js', 'TS', ''])).toEqual([
      'Node.js',
      'Express',
      'TypeScript',
    ]);
  });
  it('reads language from actual event source paths, not title guesses', () => {
    const j = journey('React tutorial', []);
    expect(journeySkills(j)).toContain('TypeScript');
    expect(journeySkills(j)).not.toContain('React');
  });
  it('requires skills and explains exact metadata matches', () => {
    expect(recommendJourneys([journey('a')], [], {}, 's1', repo)).toEqual([]);
    const r = recommendJourneys([journey('a')], ['express.js'], {}, 's1', repo);
    expect(r[0].matches).toEqual(['Express']);
    expect(r[0].reason).toContain('know Express');
  });
  it('prioritizes unfinished progress then relevant new paths before completed paths', () => {
    const items = [journey('completed'), journey('new'), journey('started')];
    expect(
      recommendJourneys(
        items,
        ['Express'],
        { started: checkpoint('started'), completed: checkpoint('completed', true) },
        's1',
        repo,
      ).map((r) => r.journey.id),
    ).toEqual(['started', 'new', 'completed']);
  });
  it('never mixes repositories or snapshots and ignores stale checkpoints', () => {
    const r = recommendJourneys(
      [
        journey('a'),
        journey('other', undefined, 's2'),
        journey('foreign', undefined, 's1', 'other'),
      ],
      ['Express'],
      { a: checkpoint('a', false, 's0') },
      's1',
      repo,
    );
    expect(r.map((v) => v.journey.id)).toEqual(['a']);
    expect(r[0].reason).toContain('know Express');
  });
  it('does not recommend weak substring matches and refreshes from changed skills', () => {
    expect(recommendJourneys([journey('a')], ['Rust'], {}, 's1', repo)).toEqual([]);
    expect(recommendJourneys([journey('a')], ['TypeScript'], {}, 's1', repo)).toHaveLength(1);
  });
  it('does not promote a previously started journey when the skills no longer match', () => {
    const saved = { started: checkpoint('started') };
    const before = structuredClone(saved);
    expect(recommendJourneys([journey('started')], ['ASDFGHJK'], saved, 's1', repo)).toEqual([]);
    expect(recommendJourneys([journey('started')], ['Rust'], saved, 's1', repo)).toEqual([]);
    expect(saved).toEqual(before);
    expect(
      recommendJourneys([journey('started')], ['Express'], saved, 's1', repo)[0].reason,
    ).toContain('know Express');
  });
  it('offers React users a clearly labeled HTTP next step without claiming a React match', () => {
    const result = recommendJourneys([journey('api')], ['React'], {}, 's1', repo);
    expect(result).toHaveLength(1);
    expect(result[0].relation).toBe('related');
    expect(result[0].matches).toEqual([]);
    expect(result[0].relevantTags).toEqual(['HTTP']);
    expect(result[0].reason).toContain('Next step from React');
  });
  it('ranks actual React source above related HTTP paths', () => {
    const react = { ...journey('component', ['React']), topic: 'Components' };
    const results = recommendJourneys(
      [journey('api'), react],
      ['React'],
      { api: checkpoint('api') },
      's1',
      repo,
    );
    expect(results[0].journey.id).toBe('component');
    expect(results[0].relation).toBe('direct');
  });
  it('does not bridge an unrelated helper or a one-event path to React', () => {
    const helper = { ...journey('helper'), topic: 'Components' };
    const one = {
      ...journey('short'),
      scenarios: [{ ...journey('short').scenarios[0], path: ['a'] }],
    };
    expect(recommendJourneys([helper, one], ['React'], {}, 's1', repo)).toEqual([]);
  });
  it('prefers connected paths and avoids listing their nested helpers repeatedly', () => {
    const flow = {
      ...journey('flow'),
      events: [
        { key: 'entry', source: { file: 'src/routes.ts' } },
        { key: 'helper', source: { file: 'src/service.ts' } },
      ] as JourneyEvent[],
    };
    const helper = {
      ...journey('helper'),
      events: [{ key: 'helper', source: { file: 'src/service.ts' } }] as JourneyEvent[],
    };
    expect(
      recommendJourneys([flow, helper], ['Express'], {}, 's1', repo).map((r) => r.journey.id),
    ).toEqual(['flow']);
  });
  it('keeps unknown difficulty unknown and does not gate by assumed proficiency', () => {
    const r = recommendJourneys([journey('a')], ['Express'], {}, 's1', repo);
    expect(r[0].journey.difficulty).toBe('unrated');
  });
});
describe('Legacy journey links', () => {
  it('preserves scenario, trace, resume and topic query parameters', () => {
    const location = learningJourneyLocation(
      '/journeys/repo-1',
      '?scenario=path-2&trace=t&resume=1',
    );
    expect(location).toBe('/learn/repo-1?scenario=path-2&trace=t&resume=1');
    expect(learningJourneyLocation('/journeys', '?topic=HTTP')).toBe(
      '/learn?topic=HTTP&section=all',
    );
  });
});
