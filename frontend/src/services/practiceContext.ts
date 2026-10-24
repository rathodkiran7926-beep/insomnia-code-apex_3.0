import type { Goal, Profile } from '../data/types';
import type { PracticeContext } from './practiceApi';

export function buildPracticeContext(input: {
  goal: Goal;
  profile: Profile;
  journeyId: string | null;
  activeLesson: string | null;
  completed: string[];
}): PracticeContext {
  return {
    goal: input.goal,
    profile: input.profile,
    ...(input.journeyId ? { journey: input.journeyId } : {}),
    ...(input.activeLesson ? { lesson: input.activeLesson } : {}),
    studiedConcepts: input.completed.slice(-30),
  };
}
