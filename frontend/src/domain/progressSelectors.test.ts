import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../state/WorkspaceContext';
import { getJourneySteps } from './model';
import type { LearningEvent } from './learningEvents';
import { clearLearningEvents, LEARNING_EVENTS_KEY, readLearningEvents, recordLearningEvent } from './learningEvents';
import {
  buildLearningTimeline,
  buildNextStep,
  buildProgressReportSnapshot,
  buildSkillStates,
} from './progressSelectors';

const event = (overrides: Partial<LearningEvent> = {}): LearningEvent => ({
  id: 'event-1', schemaVersion: 1, type: 'journey_completed',
  timestamp: '2026-10-25T10:00:00.000Z', evidence: 'activity', outcome: 'completed',
  journeyId: 'signup', snapshot: 'base', ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('progress evidence selectors', () => {
  it('does not treat journey completion alone as demonstrated skill', () => {
    const skills = buildSkillStates(initialState, [event()]);
    expect(skills['Architecture Understanding'].state).toBe('Learning');
    expect(skills['Control-flow Reasoning'].state).toBe('Not assessed');
  });

  it('limits demonstrated control-flow evidence to a correct checkpoint event', () => {
    const skills = buildSkillStates(initialState, [event({
      type: 'checkpoint_answered', evidence: 'checkpoint', outcome: 'correct', reference: 'guard-check',
    })]);
    expect(skills['Control-flow Reasoning'].state).toBe('Demonstrated');
    expect(skills['Control-flow Reasoning'].evidenceCount).toBe(1);
  });

  it('keeps local assertion evidence distinct from sandbox execution', () => {
    const skills = buildSkillStates(initialState, [event({
      type: 'practice_verified', evidence: 'local_assertion', outcome: 'local assertions passed',
    })]);
    expect(skills['Testing/Debugging'].state).toBe('Demonstrated');
    expect(skills['Testing/Debugging'].evidence[0]).toContain('local assertions');
  });

  it('sorts only real, timestamped event records into the timeline', () => {
    const earlier = event({ id: 'first', timestamp: '2026-10-24T10:00:00.000Z' });
    expect(buildLearningTimeline([event(), earlier]).map((item) => item.id)).toEqual(['first', 'event-1']);
    expect(buildLearningTimeline([])).toEqual([]);
  });

  it('prioritizes an explicit review suggestion and produces a matching report snapshot', () => {
    const state = { ...initialState, review: ['signup'] };
    const recommendation = buildNextStep(state, []);
    const snapshot = buildProgressReportSnapshot(state, []);
    expect(recommendation?.destination).toBe('/changes');
    expect(snapshot.nextStep).toEqual(recommendation);
    expect(snapshot.summary.reviewCount).toBe(1);
    expect(snapshot.repository).toContain('synthetic sample');
  });

  it('ignores malformed or unsupported old event storage without creating history', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{broken json', setItem: vi.fn(), removeItem: vi.fn() });
    expect(readLearningEvents()).toEqual([]);
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify([{ ...event(), schemaVersion: 0 }]) });
    expect(readLearningEvents()).toEqual([]);
  });

  it('records validated events once for a repeated rapid action and clears only the event store', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T10:00:00.000Z'));
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    const first = recordLearningEvent({ type: 'journey_started', evidence: 'activity', outcome: 'started', journeyId: 'signup' });
    const repeated = recordLearningEvent({ type: 'journey_started', evidence: 'activity', outcome: 'started', journeyId: 'signup' });
    expect(repeated?.id).toBe(first?.id);
    expect(readLearningEvents()).toHaveLength(1);
    clearLearningEvents();
    expect(readLearningEvents()).toEqual([]);
    expect(store.has(LEARNING_EVENTS_KEY)).toBe(false);
  });

  it('follows recommendation priority for started journeys, unfinished practice, and unassessed journeys', () => {
    const started = buildNextStep(
      { ...initialState, practiceResult: 'solution' },
      [event({ type: 'journey_started', outcome: 'started' })],
    );
    expect(started?.title).toContain('Continue the signup journey');

    const unfinishedPractice = buildNextStep(initialState, []);
    expect(unfinishedPractice?.destination).toBe('/practice');

    const unassessed = buildNextStep(
      { ...initialState, practiceResult: 'solution' },
      [event({ type: 'checkpoint_answered', outcome: 'correct', journeyId: 'signup' })],
    );
    expect(unassessed?.evidenceReference).toBe('login');
  });

  it('routes a genuinely incorrect recorded checkpoint to the retry recommendation', () => {
    const step = getJourneySteps('signup', 'success', 'base').find((item) => item.check)!;
    const wrong = step.check!.options.find((option) => option.id !== step.check!.correct)!.id;
    const state = {
      ...initialState,
      practiceResult: 'solution' as const,
      predictions: { [`signup:success:base:${step.id}`]: { first: wrong, latest: wrong, attempts: 1 } },
    };
    expect(buildNextStep(state, [])?.destination).toBe('/practice');
  });
});
