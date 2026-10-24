import { useEffect, useState } from 'react';
import { handoffApi } from '../services/handoffApi';
import type { JourneyEvent, JourneyLevel, JourneyTrace } from '../domain/codeJourney';

export type StepExplanation = {
  sentences: string[];
  steps: { title: string; explanation: string; sourceRefId: string }[];
  sourceReferences: {
    sourceRefId: string;
    title: string;
    file: string;
    startLine: number;
    endLine: number;
  }[];
  generated: boolean;
  expression?: 'explaining' | 'thinking' | 'questioning' | 'encouraging';
  notice: string;
  eventId: string;
  traceId: string;
  snapshotId: string;
  sourceRefId: string;
  sourceHash: string;
  componentId: string;
};
const cache = new Map<string, { value: StepExplanation; expires: number }>();
const pending = new Map<string, Promise<StepExplanation>>();
export function explanationCacheKey(trace: JourneyTrace, event: JourneyEvent, level: JourneyLevel) {
  const index = trace.events.findIndex((item) => item.id === event.id);
  return JSON.stringify([
    'walkthrough-v2',
    trace.snapshotId,
    event.key,
    trace.sourceHash,
    level,
    trace.mode,
    trace.events[index - 1]?.key,
    trace.events[index + 1]?.key,
    trace.mode === 'observed_replay' ? trace.id : null,
  ]);
}
export function useJourneyExplanation(
  trace: JourneyTrace,
  event: JourneyEvent,
  level: JourneyLevel,
  enabled: boolean,
) {
  const key = explanationCacheKey(trace, event, level);
  const [state, setState] = useState<{
    key: string;
    value?: StepExplanation;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) {
      setState({ key, value: cached.value });
      return;
    }
    // Avoid starting a model request for each intermediate step during fast navigation.
    const timer = setTimeout(() => {
      let task = pending.get(key);
      if (!task) {
        task = handoffApi<StepExplanation>(
          `/api/traces/${encodeURIComponent(trace.id)}/events/${encodeURIComponent(event.id)}/explanation?level=${level}`,
        )
          .then((value) => {
            if (
              value.snapshotId !== trace.snapshotId ||
              value.sourceHash !== trace.sourceHash ||
              value.componentId !== event.key ||
              value.eventId !== event.id ||
              value.traceId !== trace.id ||
              value.sourceRefId !== event.sourceRefId ||
              value.sentences.length !== 3 ||
              !Array.isArray(value.steps) ||
              value.steps.length < 3 ||
              value.steps.length > 7 ||
              !Array.isArray(value.sourceReferences) ||
              value.steps.some(
                (step) =>
                  !value.sourceReferences.some(
                    (reference) => reference.sourceRefId === step.sourceRefId,
                  ),
              )
            )
              throw new Error('The explanation does not match this source.');
            if (cache.size >= 200) cache.delete(cache.keys().next().value!);
            cache.set(key, { value, expires: Date.now() + (value.generated ? 3600000 : 20000) });
            return value;
          })
          .finally(() => pending.delete(key));
        pending.set(key, task);
      }
      task
        .then((value) => {
          if (active) setState({ key, value });
        })
        .catch(() => {
          if (active)
            setState({
              key,
              error:
                'An explanation is unavailable. Inspect the linked source; unsupported behavior remains unknown.',
            });
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, enabled, trace, event, level]);
  // Guard rendering as well as callbacks: a newly selected step never paints the old text.
  return state?.key === key
    ? { ...state, loading: !state.value && !state.error }
    : { loading: true, value: undefined, error: undefined };
}
