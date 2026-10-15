import { describe, expect, it } from 'vitest';
import {
  resolveSource,
  getRoute,
  canAdvance,
  recordPrediction,
  transitionDecision,
  affectedConcepts,
  getJourneySteps,
  reachableStep,
  conceptsNeedingReview,
} from './model';
import { files, journeys, graphNodes } from '../data/fixtures';

describe('versioned source navigation', () => {
  it('rejects missing files and invalid inclusive ranges rather than fabricating citations', () => {
    expect(resolveSource('base', { path: 'missing.ts', start: 1, end: 2 })).toBeNull();
    expect(
      resolveSource('base', { path: 'src/services/user.service.ts', start: 0, end: 2 }),
    ).toBeNull();
    expect(
      resolveSource('base', { path: 'src/services/user.service.ts', start: 2, end: 999 }),
    ).toBeNull();
  });
  it('resolves the selected revision and does not mix head behavior into base citations', () => {
    const ref = { path: 'src/services/user.service.ts', start: 1, end: 30 };
    expect(resolveSource('base', ref)?.content).not.toContain('verification.send');
    expect(resolveSource('head', ref)?.content).toContain('verification.send');
  });
  it('keeps every graph and journey citation within its sample source file', () => {
    for (const snapshot of ['base', 'head'] as const) {
      expect(Object.keys(files[snapshot]).length).toBeGreaterThan(5);
      for (const node of graphNodes)
        if (node.source) expect(resolveSource(snapshot, node.source)).not.toBeNull();
      for (const journey of journeys)
        for (const step of journey.steps)
          expect(resolveSource(snapshot, step.source)).not.toBeNull();
    }
  });
});

describe('learning rules', () => {
  it('requires a prediction before advancing past a decision', () => {
    expect(canAdvance(true, undefined)).toBe(false);
    expect(canAdvance(false, undefined)).toBe(true);
    expect(canAdvance(true, { first: 'stop', latest: 'stop', attempts: 1 })).toBe(true);
  });
  it('retains the first answer when a learner retries', () => {
    const first = recordPrediction(undefined, 'continue');
    expect(recordPrediction(first, 'stop')).toEqual({
      first: 'continue',
      latest: 'stop',
      attempts: 2,
    });
  });
  it('offers different prerequisites to new and experienced developers', () => {
    expect(getRoute('beginner', 'contribute').map((x) => x.id)).toContain('routing');
    expect(getRoute('experienced', 'contribute').map((x) => x.id)).not.toContain('routing');
    expect(getRoute('experienced', 'testing').map((x) => x.id)).toContain('edge-tests');
    expect(getRoute('experienced', 'understand').map((x) => x.id)).not.toContain('edge-tests');
  });
  it('marks only previously studied changed concepts for relearning', () => {
    expect(affectedConcepts(['routing', 'signup', 'login'], ['signup', 'setup'])).toEqual([
      'signup',
    ]);
  });
  it('does not permit a timeline jump past an unanswered prediction', () => {
    const steps = getJourneySteps('signup', 'success', 'base');
    expect(reachableStep(steps, 5, {}, 'signup:success:base')).toBe(1);
    expect(
      reachableStep(
        steps,
        5,
        { 'signup:success:base:validate': { first: 'no', latest: 'no', attempts: 1 } },
        'signup:success:base',
      ),
    ).toBe(3);
  });
  it('does not invalidate a concept already revisited at the target version', () => {
    expect(
      conceptsNeedingReview(
        { signup: ['base'], login: ['base', 'head'], routing: ['base'] },
        ['signup', 'login'],
        'head',
      ),
    ).toEqual(['signup']);
  });
  it('keeps all scenario and head-version source spans resolvable', () => {
    for (const id of ['signup', 'login'] as const)
      for (const scenario of ['success', 'duplicate', 'invalid'] as const)
        for (const snapshot of ['base', 'head'] as const) {
          for (const step of getJourneySteps(id, scenario, snapshot))
            expect(resolveSource(snapshot, step.source)).not.toBeNull();
        }
  });
});

describe('maintainer publication boundary', () => {
  it('cannot publish an open question or a draft', () => {
    expect(() => transitionDecision('open', 'publish')).toThrow();
    expect(() => transitionDecision('draft', 'publish')).toThrow();
  });
  it('requires explicit review and approval before publication', () => {
    expect(transitionDecision('open', 'draft')).toBe('draft');
    expect(transitionDecision('draft', 'review')).toBe('awaiting_review');
    expect(transitionDecision('awaiting_review', 'approve')).toBe('approved');
    expect(transitionDecision('approved', 'publish')).toBe('published');
    expect(transitionDecision('published', 'invalidate')).toBe('needs_review');
  });
});
