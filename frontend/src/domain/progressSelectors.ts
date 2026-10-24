import { journeys } from '../data/fixtures';
import { getJourneySteps } from './model';
import type { WorkspaceState } from '../state/WorkspaceContext';
import type { LearningEvent } from './learningEvents';

export type SkillState = 'Not assessed' | 'Learning' | 'Demonstrated' | 'Review suggested';
export const skillNames = [
  'Code Navigation',
  'Architecture Understanding',
  'Control-flow Reasoning',
  'Testing/Debugging',
  'Practical Contribution',
] as const;

export function buildProgressSummary(state: WorkspaceState) {
  const assessed = Object.entries(state.predictions).flatMap(([key, prediction]) => {
    const [id, scenario, snapshot, stepId] = key.split(':');
    if ((id !== 'signup' && id !== 'login') || (snapshot !== 'base' && snapshot !== 'head')) return [];
    const step = getJourneySteps(id, scenario as 'success' | 'duplicate' | 'invalid', snapshot).find((item) => item.id === stepId);
    return step?.check ? [{ prediction, correctAnswer: step.check.correct }] : [];
  });
  const checkpointCount = assessed.length;
  const localPractice = state.practiceResult;
  return {
    journeysCompleted: state.completed.filter((id) => journeys.some((journey) => journey.id === id)).length,
    journeyTotal: journeys.length,
    checkpointCount,
    checkpointFirstCorrect: assessed.filter(({ prediction, correctAnswer }) => prediction.first === correctAnswer).length,
    practice: localPractice === 'solution' ? 'Local assertions passed' : localPractice === 'baseline' ? 'Assertions not passed' : localPractice === 'unsupported' ? 'Unsupported syntax' : 'Not assessed',
    reviewCount: state.review.length,
  };
}

export function buildSkillStates(state: WorkspaceState, events: LearningEvent[]) {
  const skills: Record<(typeof skillNames)[number], { state: SkillState; evidenceCount: number; evidence: string[] }> = {
    'Code Navigation': { state: 'Not assessed', evidenceCount: 0, evidence: [] },
    'Architecture Understanding': { state: 'Not assessed', evidenceCount: 0, evidence: [] },
    'Control-flow Reasoning': { state: 'Not assessed', evidenceCount: 0, evidence: [] },
    'Testing/Debugging': { state: 'Not assessed', evidenceCount: 0, evidence: [] },
    'Practical Contribution': { state: 'Not assessed', evidenceCount: 0, evidence: [] },
  };
  const journeyEvents = events.filter((event) => ['journey_started', 'journey_completed'].includes(event.type));
  const checkpointEvents = events.filter((event) => event.type === 'checkpoint_answered');
  const assertionEvents = events.filter((event) => event.type === 'practice_verified');
  const setLearning = (name: (typeof skillNames)[number], evidence: string[], demonstrated = false, reviewRelated = false) => {
    skills[name] = {
      state: reviewRelated && state.review.length ? 'Review suggested' : demonstrated ? 'Demonstrated' : evidence.length ? 'Learning' : 'Not assessed',
      evidenceCount: evidence.length,
      evidence,
    };
  };
  setLearning('Code Navigation', journeyEvents.map((event) => `${event.type.replace('_', ' ')} · ${event.journeyId ?? 'journey'}`), false, state.review.length > 0);
  setLearning('Architecture Understanding', journeyEvents.filter((event) => event.type === 'journey_completed').map((event) => `Completed ${event.journeyId} journey`), false, state.review.some((id) => ['signup', 'login'].includes(id)));
  setLearning('Control-flow Reasoning', checkpointEvents.map((event) => `${event.outcome} checkpoint · ${event.reference ?? event.journeyId ?? ''}`), checkpointEvents.some((event) => event.outcome === 'correct'), state.review.some((id) => ['signup', 'login'].includes(id)));
  setLearning('Testing/Debugging', assertionEvents.map((event) => event.outcome), assertionEvents.length > 0);
  setLearning('Practical Contribution', events.filter((event) => event.type === 'practice_submitted').map((event) => `Practice submitted · ${event.outcome}`));
  return skills;
}

export function buildLearningTimeline(events: LearningEvent[]) {
  return [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export interface NextStep {
  title: string;
  reason: string;
  destination: string;
  evidenceReference: string;
}

export function buildNextStep(state: WorkspaceState, events: LearningEvent[]): NextStep | null {
  if (state.review.length) return {
    title: 'Review a concept affected by the sample update',
    reason: `${state.review.join(', ')} was studied in an earlier snapshot and is flagged for review in the prepared PR #402 demo.`,
    destination: '/changes', evidenceReference: 'PR #402 · synthetic sample update',
  };
  const needsRetry = Object.entries(state.predictions).find(([key, prediction]) => {
    const [id, scenario, snapshot, stepId] = key.split(':');
    const check = (id === 'signup' || id === 'login') && (snapshot === 'base' || snapshot === 'head')
      ? getJourneySteps(id, scenario as 'success' | 'duplicate' | 'invalid', snapshot).find((step) => step.id === stepId)?.check
      : undefined;
    return Boolean(check && (prediction.attempts > 1 || prediction.first !== check.correct));
  });
  if (needsRetry) return {
    title: 'Revisit the checkpoint before practicing',
    reason: `Checkpoint ${needsRetry[0].split(':').at(-1)} has ${needsRetry[1].attempts} recorded attempt(s).`,
    destination: '/practice', evidenceReference: needsRetry[0],
  };
  const startedIncomplete = journeys.find((journey) =>
    !state.completed.includes(journey.id) && events.some((event) => event.type === 'journey_started' && event.journeyId === journey.id),
  );
  if (startedIncomplete) return {
    title: `Continue the ${startedIncomplete.id} journey`,
    reason: 'A dated start event is recorded, and the journey is not marked complete in the current local workspace.',
    destination: '/demo-workspace', evidenceReference: startedIncomplete.id,
  };
  if (state.practiceResult !== 'solution') return {
    title: 'Try the local contribution practice',
    reason: 'No practice result is recorded yet; the local assertions provide bounded practice evidence.',
    destination: '/practice', evidenceReference: 'practiceResult is not assessed',
  };
  const unassessed = journeys.find((journey) => !events.some((event) => event.type === 'checkpoint_answered' && event.journeyId === journey.id));
  if (unassessed) return {
    title: `Explore a checkpoint in the ${unassessed.id} journey`,
    reason: 'No checkpoint evidence is recorded for this journey in the event history.',
    destination: '/demo-workspace', evidenceReference: unassessed.id,
  };
  return null;
}

export function buildProgressReportSnapshot(state: WorkspaceState, events: LearningEvent[]) {
  const generatedAt = new Date().toISOString();
  return Object.freeze({
    reportVersion: 1,
    generatedAt,
    repository: 'acme/relay-api (synthetic sample)',
    reportingPeriod: events.length
      ? {
          from: events.reduce((earliest, event) => event.timestamp < earliest ? event.timestamp : earliest, events[0].timestamp),
          to: events.reduce((latest, event) => event.timestamp > latest ? event.timestamp : latest, events[0].timestamp),
        }
      : null,
    summary: buildProgressSummary(state),
    skills: buildSkillStates(state, events),
    timeline: buildLearningTimeline(events),
    nextStep: buildNextStep(state, events),
    limitations: ['Local browser evidence only', 'Old workspace state has no historical timestamps', 'Prepared PR #402 is synthetic demo data', 'No mentor review is recorded'],
  });
}
