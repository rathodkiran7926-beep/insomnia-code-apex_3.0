import { describe, expect, it } from 'vitest';
import { buildPracticeContext } from './practiceContext';

describe('repository practice learning context', () => {
  it('sends the active learning route and recent completed concepts', () => {
    expect(
      buildPracticeContext({
        goal: 'testing',
        profile: 'experienced',
        journeyId: 'signup',
        activeLesson: 'edge-tests',
        completed: ['routing', 'validation'],
      }),
    ).toEqual({
      goal: 'testing',
      profile: 'experienced',
      journey: 'signup',
      lesson: 'edge-tests',
      studiedConcepts: ['routing', 'validation'],
    });
  });

  it('omits journey fields when the learner has no active lesson', () => {
    expect(
      buildPracticeContext({
        goal: 'contribute',
        profile: 'beginner',
        journeyId: null,
        activeLesson: null,
        completed: [],
      }),
    ).toEqual({
      goal: 'contribute',
      profile: 'beginner',
      studiedConcepts: [],
    });
  });
});
