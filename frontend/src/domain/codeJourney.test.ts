import { describe, it, expect } from 'vitest';
import {
  initialPlayback,
  playbackTransition,
  filterJourneys,
  type JourneyTrace,
  type JourneyEvent,
  type CodeJourney,
  type JourneyCheckpoint,
} from './codeJourney';
const events = ['start', 'decision', 'end'].map((key, i) => ({
  id: key,
  key,
  title: key,
  snapshotId: 's1',
  observedFields: null,
  sourceRefId: key,
  source: { file: 'x.ts', startLine: i + 1, endLine: i + 1 },
  explanations: { beginner: 'simple', intermediate: 'detail', advanced: 'technical' },
  ...(i === 1
    ? {
        prediction: {
          question: 'Continue?',
          options: [
            { id: 'yes', text: 'yes' },
            { id: 'no', text: 'no' },
          ],
          correct: 'yes',
        },
      }
    : {}),
})) as JourneyEvent[];
const trace: JourneyTrace = {
  id: 'trace-a',
  journeyId: 'signup',
  scenarioId: 'success',
  snapshotId: 's1',
  sourceHash: 'h1',
  mode: 'explained_path',
  createdAt: null,
  coverage: [],
  events,
};
describe('CodeJourney playback evidence boundaries', () => {
  it('pauses at predictions, keeps the cursor when asking, then resumes from the same event', () => {
    let state = initialPlayback(trace);
    state = playbackTransition(state, { type: 'play' }, trace);
    state = playbackTransition(state, { type: 'next' }, trace);
    expect(state.index).toBe(1);
    expect(state.playing).toBe(false);
    expect(playbackTransition(state, { type: 'next' }, trace).index).toBe(1);
    const paused = playbackTransition(state, { type: 'pause' }, trace);
    expect(paused.index).toBe(1);
    state = playbackTransition(paused, { type: 'answer', answer: 'yes' }, trace);
    state = playbackTransition(state, { type: 'play' }, trace);
    expect(state.index).toBe(1);
    expect(playbackTransition(state, { type: 'next' }, trace).index).toBe(2);
  });
  it('does not skip unvisited events or complete a path with an unanswered checkpoint', () => {
    let state = initialPlayback(trace);
    expect(playbackTransition(state, { type: 'jump', index: 2 }, trace)).toEqual(state);
    expect(playbackTransition(state, { type: 'complete' }, trace).completed).toBe(false);
    state = playbackTransition(state, { type: 'next' }, trace);
    state = playbackTransition(state, { type: 'answer', answer: 'no' }, trace);
    state = playbackTransition(state, { type: 'next' }, trace);
    expect(playbackTransition(state, { type: 'complete' }, trace).completed).toBe(true);
    expect(state.predictions.decision.correct).toBe(false);
  });
  it('a new trace or branch never inherits visited events or predictions from another path', () => {
    const checkpoint = {
      journeyId: 'signup',
      scenarioId: 'success',
      traceId: trace.id,
      snapshotId: 's1',
      eventId: 'end',
      visited: events.map((e) => e.id),
      predictions: { decision: { answer: 'yes', correct: true } },
      completed: true,
      level: 'beginner',
      updatedAt: '',
    } as JourneyCheckpoint;
    expect(initialPlayback(trace, checkpoint).completed).toBe(true);
    const alternate = { ...trace, id: 'other-trace', scenarioId: 'invalid' };
    const state = initialPlayback(alternate, checkpoint);
    expect(state.visited).toEqual(['start']);
    expect(state.predictions).toEqual({});
    expect(state.completed).toBe(false);
    expect(
      playbackTransition(initialPlayback(trace, checkpoint), { type: 'next' }, alternate).traceId,
    ).toBe('other-trace');
  });
  it('back, restart and invalid predictions preserve deterministic event evidence', () => {
    let state = playbackTransition(initialPlayback(trace), { type: 'next' }, trace);
    expect(playbackTransition(state, { type: 'answer', answer: 'invented' }, trace)).toBe(state);
    state = playbackTransition(state, { type: 'back' }, trace);
    expect(state.index).toBe(0);
    state = playbackTransition(state, { type: 'restart' }, trace);
    expect(state.visited).toEqual(['start']);
    expect(state.playing).toBe(false);
    expect(trace.events[1].observedFields).toBeNull();
  });
  it('search, topic, difficulty and completion filters compose with real counts', () => {
    const list = [
      {
        id: 'signup',
        title: 'Signup',
        description: 'Express',
        topic: 'Backend',
        difficulty: 'beginner',
        tags: ['TypeScript'],
        minutes: 6,
      },
      {
        id: 'react',
        title: 'React state',
        description: 'Render',
        topic: 'React',
        difficulty: 'intermediate',
        tags: ['TypeScript'],
        minutes: 4,
      },
    ] as CodeJourney[];
    const options = {
      search: 'typescript',
      topic: 'Backend',
      difficulty: 'beginner',
      status: 'all',
      sort: 'duration',
    };
    expect(filterJourneys(list, {}, options).map((j) => j.id)).toEqual(['signup']);
    expect(
      filterJourneys(
        list,
        { signup: { completed: true, scenarioId: 'success' } as JourneyCheckpoint },
        { ...options, status: 'new' },
      ),
    ).toHaveLength(0);
  });
});
