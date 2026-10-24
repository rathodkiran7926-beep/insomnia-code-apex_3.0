import type { JourneyCheckpoint } from '../domain/codeJourney';
import { z } from 'zod';
const key = 'mentor-codejourney-progress-v1';
const checkpoint = z.object({
  journeyId: z.string(),
  scenarioId: z.string(),
  traceId: z.string(),
  snapshotId: z.string(),
  eventId: z.string(),
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  visited: z.array(z.string()),
  predictions: z.record(z.string(), z.object({ answer: z.string(), correct: z.boolean() })),
  completed: z.boolean(),
  completedScenarios: z.array(z.string()).optional(),
  updatedAt: z.string(),
});
export function readGuestProgress(): Record<string, JourneyCheckpoint> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) || '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).flatMap(([id, value]) => {
        const parsed = checkpoint.safeParse(value);
        return parsed.success && parsed.data.journeyId === id ? [[id, parsed.data]] : [];
      }),
    );
  } catch {
    return {};
  }
}
export function saveGuestProgress(value: JourneyCheckpoint) {
  const all = readGuestProgress(),
    previous = all[value.journeyId];
  const completedScenarios = new Set(
    previous?.snapshotId === value.snapshotId
      ? [
          ...(previous.completedScenarios || []),
          ...(previous.completed ? [previous.scenarioId] : []),
        ]
      : [],
  );
  if (value.completed) completedScenarios.add(value.scenarioId);
  const stored = { ...value, completedScenarios: [...completedScenarios] };
  try {
    localStorage.setItem(key, JSON.stringify({ ...all, [value.journeyId]: stored }));
  } catch {
    /* Playback remains usable without local persistence. */
  }
  return stored;
}
