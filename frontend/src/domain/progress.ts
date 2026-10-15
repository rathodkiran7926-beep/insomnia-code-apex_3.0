import type { Scenario, Snapshot } from '../data/types';

export interface LearningProgress {
  completed: string[];
  studied: Record<string, Snapshot[]>;
  review: string[];
  completedRuns: string[];
}
export function finishScenario(
  progress: LearningProgress,
  id: string,
  scenario: Scenario,
  snapshot: Snapshot,
  lessonId?: string | null,
): LearningProgress {
  const completedRuns = [...new Set([...progress.completedRuns, `${id}:${scenario}:${snapshot}`])];
  if (scenario !== 'success') return { ...progress, completedRuns };
  const relatedLesson =
    (id === 'signup' && (lessonId === 'routing' || lessonId === 'signup')) ||
    (id === 'login' && lessonId === 'login')
      ? lessonId
      : null;
  const concepts = [id, ...(relatedLesson ? [relatedLesson] : [])];
  const studied = { ...progress.studied };
  for (const concept of concepts)
    studied[concept] = [...new Set([...(studied[concept] ?? []), snapshot])];
  return {
    completedRuns,
    completed: [...new Set([...progress.completed, ...concepts])],
    studied,
    review:
      snapshot === 'head' ? progress.review.filter((x) => !concepts.includes(x)) : progress.review,
  };
}

interface PracticeProgress extends LearningProgress {
  practiceCode: string;
  practiceResult: 'baseline' | 'solution' | 'unsupported' | null;
  activeLesson: string | null;
}
export function applyPracticeOutcome<T extends PracticeProgress>(
  state: T,
  submittedCode: string,
  result: 'baseline' | 'solution' | 'unsupported',
): T {
  if (state.practiceCode !== submittedCode) return state;
  const completed =
    result === 'solution'
      ? [
          ...new Set([
            ...state.completed,
            'practice',
            ...(state.activeLesson === 'edge-tests' ? ['edge-tests'] : []),
          ]),
        ]
      : state.completed;
  return {
    ...state,
    practiceResult: result,
    completed,
    activeLesson: result === 'solution' ? null : state.activeLesson,
  };
}
