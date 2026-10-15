import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { graphNodes, initialPractice } from '../data/fixtures';
import type {
  DecisionAction,
  DecisionStatus,
  Goal,
  Prediction,
  Profile,
  Scenario,
  Snapshot,
  SourceRef,
} from '../data/types';
import {
  canAdvance,
  conceptsNeedingReview,
  getJourneySteps,
  reachableStep,
  recordPrediction,
  resolveSource,
  transitionDecision,
} from '../domain/model';
import { applyPracticeOutcome, finishScenario } from '../domain/progress';

export interface WorkspaceState {
  schema: 1;
  connected: boolean;
  snapshot: Snapshot;
  selectedNode: string;
  source: SourceRef;
  sourceFocusKey: number;
  journeyId: 'signup' | 'login' | null;
  step: number;
  scenario: Scenario;
  playing: boolean;
  profile: Profile;
  goal: Goal;
  detail: 'beginner' | 'technical';
  predictions: Record<string, Prediction>;
  completed: string[];
  studied: Record<string, Snapshot[]>;
  review: string[];
  completedRuns: string[];
  activeLesson: string | null;
  practiceCode: string;
  practiceResult: 'baseline' | 'solution' | 'unsupported' | null;
  hints: number;
  decision: DecisionStatus;
  decisionSnapshot: Snapshot;
  rationale: string;
  personalized: boolean;
}
export const initialState: WorkspaceState = {
  schema: 1,
  connected: true,
  snapshot: 'base',
  selectedNode: 'user-service',
  source: graphNodes.find((x) => x.id === 'user-service')!.source!,
  sourceFocusKey: 0,
  journeyId: null,
  step: 0,
  scenario: 'success',
  playing: false,
  profile: 'beginner',
  goal: 'contribute',
  detail: 'beginner',
  predictions: {},
  completed: [],
  studied: {},
  review: [],
  completedRuns: [],
  activeLesson: null,
  practiceCode: initialPractice,
  practiceResult: null,
  hints: 0,
  decision: 'open',
  decisionSnapshot: 'base',
  rationale: '',
  personalized: true,
};

const STORAGE_KEY = 'codebase-mentor.workspace.v1';
function loadState(): WorkspaceState {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return initialState;
    const value = raw as Partial<WorkspaceState>;
    if (value.schema !== 1) return initialState;
    const snapshot = value.snapshot === 'head' ? 'head' : 'base';
    const journeyId =
      value.journeyId === 'signup' || value.journeyId === 'login' ? value.journeyId : null;
    const scenario =
      value.scenario === 'duplicate' || value.scenario === 'invalid' ? value.scenario : 'success';
    const steps = journeyId ? getJourneySteps(journeyId, scenario, snapshot) : [];
    const step =
      typeof value.step === 'number' && Number.isInteger(value.step)
        ? Math.min(Math.max(0, value.step), Math.max(0, steps.length - 1))
        : 0;
    const source =
      value.source && typeof value.source.path === 'string' && resolveSource(snapshot, value.source)
        ? value.source
        : (steps[step]?.source ?? initialState.source);
    return {
      ...initialState,
      snapshot,
      journeyId,
      scenario,
      step,
      source,
      selectedNode:
        steps[step]?.nodeId ??
        (graphNodes.some((n) => n.id === value.selectedNode)
          ? value.selectedNode!
          : initialState.selectedNode),
      profile: value.profile === 'experienced' ? 'experienced' : 'beginner',
      detail: value.detail === 'technical' ? 'technical' : 'beginner',
      goal: ['understand', 'contribute', 'testing'].includes(value.goal ?? '')
        ? value.goal!
        : 'contribute',
      completed: Array.isArray(value.completed)
        ? value.completed.filter((x): x is string => typeof x === 'string')
        : [],
      completedRuns: Array.isArray(value.completedRuns)
        ? value.completedRuns.filter((x): x is string => typeof x === 'string')
        : [],
      activeLesson: typeof value.activeLesson === 'string' ? value.activeLesson : null,
      studied:
        value.studied && typeof value.studied === 'object'
          ? Object.fromEntries(
              Object.entries(value.studied)
                .filter(([, x]) => Array.isArray(x))
                .map(([id, snapshots]) => [
                  id,
                  snapshots.filter((x) => x === 'base' || x === 'head'),
                ]),
            )
          : {},
      review: Array.isArray(value.review)
        ? value.review.filter((x): x is string => typeof x === 'string')
        : [],
      predictions:
        value.predictions && typeof value.predictions === 'object'
          ? Object.fromEntries(
              Object.entries(value.predictions).filter(
                ([, x]) =>
                  x &&
                  typeof x.first === 'string' &&
                  typeof x.latest === 'string' &&
                  Number.isInteger(x.attempts),
              ),
            )
          : {},
      rationale: typeof value.rationale === 'string' ? value.rationale : '',
      decision: [
        'open',
        'draft',
        'awaiting_review',
        'approved',
        'published',
        'needs_review',
        'superseded',
      ].includes(value.decision ?? '')
        ? value.decision!
        : 'open',
      decisionSnapshot: value.decisionSnapshot === 'head' ? 'head' : 'base',
      personalized: value.personalized !== false,
      practiceCode: typeof value.practiceCode === 'string' ? value.practiceCode : initialPractice,
      practiceResult: ['baseline', 'solution', 'unsupported'].includes(value.practiceResult ?? '')
        ? value.practiceResult!
        : null,
      hints: typeof value.hints === 'number' ? Math.min(3, Math.max(0, value.hints)) : 0,
    };
  } catch {
    return initialState;
  }
}

function useWorkspaceValue() {
  const [state, setState] = useState<WorkspaceState>(loadState);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, playing: false }));
    } catch {
      /* In-memory use remains available. */
    }
  }, [state]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  function patch(value: Partial<WorkspaceState>) {
    setState((s) => ({ ...s, ...value }));
  }
  function selectNode(id: string) {
    const node = graphNodes.find((x) => x.id === id);
    if (!node) return;
    setState((s) => {
      const steps = s.journeyId ? getJourneySteps(s.journeyId, s.scenario, s.snapshot) : [];
      const requested = steps.findIndex((step) => step.nodeId === id);
      const index =
        requested >= 0
          ? reachableStep(
              steps,
              requested,
              s.predictions,
              `${s.journeyId}:${s.scenario}:${s.snapshot}`,
            )
          : -1;
      return {
        ...s,
        selectedNode: index >= 0 ? steps[index].nodeId : id,
        playing: false,
        journeyId: index >= 0 ? s.journeyId : null,
        step: index >= 0 ? index : s.step,
        source:
          index >= 0
            ? steps[index].source
            : id === 'email' && s.snapshot === 'head'
              ? { path: 'src/services/verification.service.ts', start: 5, end: 12 }
              : (node.source ?? s.source),
      };
    });
  }
  function openSource(source: SourceRef, snapshot?: Snapshot) {
    if (snapshot) setSnapshot(snapshot);
    setState((s) => {
      const current = s.journeyId
        ? getJourneySteps(s.journeyId, s.scenario, s.snapshot)[s.step]
        : null;
      const compatible =
        current &&
        current.source.path === source.path &&
        source.start >= current.source.start &&
        source.end <= current.source.end;
      const owner =
        graphNodes.find((n) => n.source?.path === source.path)?.id ??
        (source.path.includes('verification')
          ? 'email'
          : source.path.includes('controller')
            ? 'user-service'
            : s.selectedNode);
      return {
        ...s,
        source,
        sourceFocusKey: s.sourceFocusKey + 1,
        playing: false,
        selectedNode: compatible ? s.selectedNode : owner,
        journeyId: compatible ? s.journeyId : null,
      };
    });
  }
  function startJourney(
    id: 'signup' | 'login',
    scenario: Scenario = 'success',
    lessonId: string | null = null,
  ) {
    setState((s) => {
      const first = getJourneySteps(id, scenario, s.snapshot)[0];
      return {
        ...s,
        journeyId: id,
        scenario,
        step: 0,
        selectedNode: first.nodeId,
        source: first.source,
        playing: false,
        activeLesson: lessonId,
      };
    });
  }
  function goStep(index: number) {
    setState((s) => {
      if (!s.journeyId) return s;
      const steps = getJourneySteps(s.journeyId, s.scenario, s.snapshot);
      const bounded = reachableStep(
        steps,
        index,
        s.predictions,
        `${s.journeyId}:${s.scenario}:${s.snapshot}`,
      );
      const target = steps[bounded];
      return {
        ...s,
        step: bounded,
        selectedNode: target.nodeId,
        source: target.source,
        playing: false,
      };
    });
  }
  function next() {
    setState((s) => {
      if (!s.journeyId) return s;
      const steps = getJourneySteps(s.journeyId, s.scenario, s.snapshot);
      const active = steps[s.step];
      const key = `${s.journeyId}:${s.scenario}:${s.snapshot}:${active.id}`;
      if (!canAdvance(Boolean(active.check), s.predictions[key])) return { ...s, playing: false };
      if (s.step === steps.length - 1)
        return {
          ...s,
          ...finishScenario(s, s.journeyId, s.scenario, s.snapshot, s.activeLesson),
          playing: false,
          activeLesson: null,
        };
      const target = steps[s.step + 1];
      return {
        ...s,
        step: s.step + 1,
        selectedNode: target.nodeId,
        source: target.source,
        playing: target.check ? false : s.playing,
      };
    });
  }
  function predict(answer: string) {
    setState((s) => {
      if (!s.journeyId) return s;
      const step = getJourneySteps(s.journeyId, s.scenario, s.snapshot)[s.step];
      if (!step.check?.options.some((x) => x.id === answer)) return s;
      const key = `${s.journeyId}:${s.scenario}:${s.snapshot}:${step.id}`;
      return {
        ...s,
        predictions: { ...s.predictions, [key]: recordPrediction(s.predictions[key], answer) },
        playing: false,
      };
    });
  }
  function setSnapshot(snapshot: Snapshot) {
    setState((s) => {
      const steps = s.journeyId ? getJourneySteps(s.journeyId, s.scenario, snapshot) : [];
      const oldSteps = s.journeyId ? getJourneySteps(s.journeyId, s.scenario, s.snapshot) : [];
      const logicalIndex = steps.findIndex((x) => x.id === oldSteps[s.step]?.id);
      const requested =
        logicalIndex >= 0 ? logicalIndex : Math.min(s.step, Math.max(0, steps.length - 1));
      const step = steps.length
        ? reachableStep(steps, requested, s.predictions, `${s.journeyId}:${s.scenario}:${snapshot}`)
        : 0;
      const source =
        steps[step]?.source ??
        (resolveSource(snapshot, s.source)
          ? s.source
          : (graphNodes.find((n) => n.id === s.selectedNode)?.source ?? initialState.source));
      return {
        ...s,
        snapshot,
        step,
        selectedNode: steps[step]?.nodeId ?? s.selectedNode,
        source,
        playing: false,
        review:
          snapshot === 'head'
            ? [
                ...new Set([
                  ...s.review,
                  ...conceptsNeedingReview(s.studied, ['signup', 'login', 'setup'], 'head'),
                ]),
              ]
            : s.review,
        decision:
          snapshot !== s.decisionSnapshot
            ? ['published', 'approved'].includes(s.decision)
              ? 'needs_review'
              : s.decision === 'awaiting_review'
                ? 'draft'
                : s.decision
            : s.decision,
      };
    });
  }
  function complete(id: string) {
    setState((s) => ({
      ...s,
      completed: [...new Set([...s.completed, id])],
      studied: { ...s.studied, [id]: [...new Set([...(s.studied[id] ?? []), s.snapshot])] },
      review: s.snapshot === 'head' ? s.review.filter((x) => x !== id) : s.review,
    }));
  }
  function decisionAction(action: DecisionAction) {
    setState((s) => {
      if (action === 'approve' && s.decisionSnapshot !== s.snapshot)
        return { ...s, decision: 'draft' };
      return {
        ...s,
        decision: transitionDecision(s.decision, action),
        decisionSnapshot:
          action === 'review' || action === 'draft' ? s.snapshot : s.decisionSnapshot,
      };
    });
  }
  function applyPracticeResult(
    submittedCode: string,
    result: 'baseline' | 'solution' | 'unsupported',
  ) {
    setState((s) => applyPracticeOutcome(s, submittedCode, result));
  }
  function reset() {
    setState(initialState);
    setNotice('Local learning data reset.');
  }
  return {
    state,
    patch,
    notice,
    notify: setNotice,
    selectNode,
    openSource,
    startJourney,
    goStep,
    next,
    predict,
    setSnapshot,
    complete,
    decisionAction,
    applyPracticeResult,
    reset,
  };
}
type WorkspaceValue = ReturnType<typeof useWorkspaceValue>;
const WorkspaceContext = createContext<WorkspaceValue | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const value = useWorkspaceValue();
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('WorkspaceProvider is required');
  return value;
}
