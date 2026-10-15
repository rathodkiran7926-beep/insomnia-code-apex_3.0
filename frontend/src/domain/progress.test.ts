import { describe, expect, it } from 'vitest';
import { finishScenario, applyPracticeOutcome } from './progress';

const progress = {
  completed: ['signup'],
  studied: { signup: ['base' as const] },
  review: ['signup'],
  completedRuns: [],
};

describe('scenario-scoped learning updates', () => {
  it('does not clear verification relearning after an invalid-input scenario', () => {
    const next = finishScenario(progress, 'signup', 'invalid', 'head');
    expect(next.review).toEqual(['signup']);
    expect(next.studied.signup).toEqual(['base']);
    expect(next.completedRuns).toContain('signup:invalid:head');
  });
  it('retains head relearning when the learner revisits base', () => {
    expect(finishScenario(progress, 'signup', 'success', 'base').review).toEqual(['signup']);
  });
  it('records the originating routing lesson and the completed head journey', () => {
    const next = finishScenario(progress, 'signup', 'success', 'head', 'routing');
    expect(next.completed).toEqual(['signup', 'routing']);
    expect(next.studied.signup).toEqual(['base', 'head']);
    expect(next.review).toEqual([]);
  });
  it('cannot complete an unrelated test lesson by finishing a code journey', () => {
    expect(
      finishScenario(progress, 'signup', 'success', 'base', 'edge-tests').completed,
    ).not.toContain('edge-tests');
  });
});

describe('practice request identity', () => {
  it('discards a result for a code revision that is no longer current', () => {
    const state = {
      ...progress,
      practiceCode: 'new edit',
      practiceResult: null,
      activeLesson: null,
    };
    expect(applyPracticeOutcome(state, 'previous code', 'solution')).toBe(state);
  });
  it('completes the originating test lesson only for a matching guided result', () => {
    const state = {
      ...progress,
      practiceCode: 'submitted',
      practiceResult: null,
      activeLesson: 'edge-tests',
    };
    const next = applyPracticeOutcome(state, 'submitted', 'solution');
    expect(next.completed).toContain('edge-tests');
    expect(next.completed).toContain('practice');
  });
});
