export type JourneyLevel = 'beginner' | 'intermediate' | 'advanced';
export type JourneyEvent = {
  id: string;
  key: string;
  title: string;
  kind: string;
  explanations: Record<JourneyLevel, string>;
  condition: string;
  sourceRefId: string;
  snapshotId: string;
  source: { file: string; startLine: number; endLine: number };
  observedFields: Record<string, string | number | boolean> | null;
  observationCoverage: string;
  inputs: string;
  outputs: string;
  stateChange: string;
  sideEffects: string;
  timestamp?: string | null;
  connections?: {
    target: string;
    type: string;
    referenceId: string;
    source: { file: string; startLine: number; endLine: number; url: string };
  }[];
  prediction?: { question: string; options: { id: string; text: string }[]; correct: string };
};
export type JourneyScenario = {
  id: string;
  label: string;
  assumption: string;
  path: string[];
  outcome: string;
  failure?: boolean;
  runRecipe?: string;
};
export type CodeJourney = {
  origin?: 'repository';
  repository?: string;
  commit?: string;
  id: string;
  title: string;
  description: string;
  topic: string;
  difficulty: string;
  minutes: number | null;
  tags: string[];
  source: string;
  sourceHash: string;
  snapshotId: string;
  events: JourneyEvent[];
  scenarios: JourneyScenario[];
  related: string[];
  visualization: string;
  provenance: string;
  coverage: string[];
};
export type JourneyTrace = {
  id: string;
  journeyId: string;
  scenarioId: string;
  snapshotId: string;
  sourceHash: string;
  mode: 'explained_path' | 'observed_replay';
  events: JourneyEvent[];
  coverage: string[];
  createdAt: string | null;
};
export type JourneyCheckpoint = {
  journeyId: string;
  scenarioId: string;
  traceId: string;
  snapshotId: string;
  eventId: string;
  level: JourneyLevel;
  visited: string[];
  predictions: Record<string, { answer: string; correct: boolean }>;
  completed: boolean;
  completedScenarios?: string[];
  updatedAt: string;
};
export type Playback = {
  traceId: string;
  index: number;
  visited: string[];
  predictions: JourneyCheckpoint['predictions'];
  playing: boolean;
  completed: boolean;
};
export type PlaybackAction =
  | { type: 'next' | 'back' | 'restart' | 'play' | 'pause' | 'complete' }
  | { type: 'jump'; index: number }
  | { type: 'answer'; answer: string };
export function journeyCompleted(journey: CodeJourney, progress?: JourneyCheckpoint) {
  if (!progress) return false;
  return (
    progress?.snapshotId === journey.snapshotId &&
    (progress.completedScenarios?.includes(journey.scenarios?.[0]?.id || 'success') ||
      (progress.completed && progress.scenarioId === (journey.scenarios?.[0]?.id || 'success')))
  );
}
export function initialPlayback(trace: JourneyTrace, saved?: JourneyCheckpoint): Playback {
  if (!trace.events.length) throw new Error('A journey needs at least one evidence event.');
  const matches = saved?.traceId === trace.id && saved.snapshotId === trace.snapshotId;
  const index = matches
    ? Math.max(
        0,
        trace.events.findIndex((e) => e.id === saved.eventId),
      )
    : 0;
  const valid = new Set(trace.events.map((e) => e.id));
  return {
    traceId: trace.id,
    index,
    visited: [
      ...new Set([
        ...(matches ? saved.visited.filter((id) => valid.has(id)) : []),
        trace.events[index].id,
      ]),
    ],
    predictions: matches
      ? Object.fromEntries(
          Object.entries(saved.predictions).filter(([id, p]) => {
            const e = trace.events.find((e) => e.id === id);
            return (
              e?.prediction?.options.some((o) => o.id === p.answer) &&
              p.correct === (p.answer === e.prediction.correct)
            );
          }),
        )
      : {},
    playing: false,
    completed: Boolean(
      matches &&
      saved.completed &&
      trace.events.every(
        (e) => saved.visited.includes(e.id) && (!e.prediction || saved.predictions[e.id]),
      ) &&
      index === trace.events.length - 1,
    ),
  };
}
export function playbackTransition(
  state: Playback,
  action: PlaybackAction,
  trace: JourneyTrace,
): Playback {
  if (state.traceId !== trace.id || !trace.events[state.index]) return initialPlayback(trace);
  const event = trace.events[state.index];
  if (action.type === 'restart') return initialPlayback(trace);
  if (action.type === 'pause') return { ...state, playing: false };
  if (action.type === 'answer') {
    if (
      !event.prediction?.options.some((o) => o.id === action.answer) ||
      state.predictions[event.id]
    )
      return state;
    return {
      ...state,
      predictions: {
        ...state.predictions,
        [event.id]: { answer: action.answer, correct: action.answer === event.prediction.correct },
      },
      playing: false,
    };
  }
  if (
    action.type === 'complete' ||
    (action.type === 'next' && state.index === trace.events.length - 1)
  ) {
    const completed = trace.events.every(
      (e) => state.visited.includes(e.id) && (!e.prediction || state.predictions[e.id]),
    );
    return { ...state, completed, playing: false };
  }
  if (action.type === 'play')
    return {
      ...state,
      playing: !state.completed && (!event.prediction || Boolean(state.predictions[event.id])),
    };
  let index = state.index;
  if (action.type === 'back') index = Math.max(0, index - 1);
  if (action.type === 'next') {
    if (event.prediction && !state.predictions[event.id]) return { ...state, playing: false };
    index = Math.min(index + 1, trace.events.length - 1);
  }
  if (action.type === 'jump') {
    if (
      !Number.isInteger(action.index) ||
      action.index < 0 ||
      action.index >= trace.events.length ||
      !state.visited.includes(trace.events[action.index].id)
    )
      return state;
    index = action.index;
  }
  return {
    ...state,
    index,
    completed: false,
    visited: [...new Set([...state.visited, trace.events[index].id])],
    playing: action.type === 'next' ? state.playing && !trace.events[index].prediction : false,
  };
}
export function filterJourneys(
  journeys: CodeJourney[],
  progress: Record<string, JourneyCheckpoint>,
  options: { search: string; topic: string; difficulty: string; status: string; sort: string },
) {
  return journeys
    .filter((j) => {
      const completed = journeyCompleted(j, progress[j.id]);
      return (
        `${j.id} ${j.title} ${j.description} ${j.tags.join(' ')}`
          .toLowerCase()
          .includes(options.search.toLowerCase()) &&
        (options.topic === 'all' || j.topic === options.topic) &&
        (options.difficulty === 'all' || j.difficulty === options.difficulty) &&
        (options.status === 'all' || (options.status === 'complete' ? completed : !completed))
      );
    })
    .sort((a, b) =>
      options.sort === 'featured'
        ? journeys.indexOf(a) - journeys.indexOf(b)
        : options.sort === 'duration'
          ? (a.minutes ?? a.scenarios[0]?.path.length ?? 0) -
            (b.minutes ?? b.scenarios[0]?.path.length ?? 0)
          : options.sort === 'recent'
            ? (progress[b.id]?.updatedAt || '').localeCompare(progress[a.id]?.updatedAt || '')
            : a.title.localeCompare(b.title),
    );
}
