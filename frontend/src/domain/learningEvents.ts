import { z } from 'zod';

export const LEARNING_EVENTS_KEY = 'codebase-mentor.learning-events.v1';
export const LEARNING_EVENTS_SCHEMA = 1 as const;

export const learningEventSchema = z.object({
  id: z.string().min(1).max(100),
  schemaVersion: z.literal(LEARNING_EVENTS_SCHEMA),
  type: z.enum([
    'journey_started',
    'journey_completed',
    'checkpoint_answered',
    'practice_submitted',
    'practice_verified',
    'review_suggested',
    'review_completed',
  ]),
  timestamp: z.string().datetime(),
  evidence: z.enum(['activity', 'checkpoint', 'local_assertion', 'sandbox_execution', 'mentor_review']),
  outcome: z.string().max(120),
  firstOutcome: z.string().max(120).optional(),
  latestOutcome: z.string().max(120).optional(),
  journeyId: z.string().max(80).optional(),
  scenario: z.string().max(80).optional(),
  snapshot: z.string().max(120).optional(),
  skill: z.string().max(100).optional(),
  reference: z.string().max(240).optional(),
});

export type LearningEvent = z.infer<typeof learningEventSchema>;
const learningEventsSchema = z.array(learningEventSchema).max(2000);

export function readLearningEvents(): LearningEvent[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LEARNING_EVENTS_KEY) ?? 'null');
    const parsed = learningEventsSchema.safeParse(raw);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function recordLearningEvent(
  event: Omit<LearningEvent, 'id' | 'schemaVersion' | 'timestamp'>,
): LearningEvent | null {
  const events = readLearningEvents();
  const signature = JSON.stringify(event);
  const recentDuplicate = [...events].reverse().find((saved) =>
    JSON.stringify({
      type: saved.type, evidence: saved.evidence, outcome: saved.outcome,
      firstOutcome: saved.firstOutcome, latestOutcome: saved.latestOutcome,
      journeyId: saved.journeyId, scenario: saved.scenario, snapshot: saved.snapshot,
      skill: saved.skill, reference: saved.reference,
    }) === signature && Date.now() - Date.parse(saved.timestamp) < 1000,
  );
  if (recentDuplicate) return recentDuplicate;
  const parsed = learningEventSchema.safeParse({
    ...event,
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    schemaVersion: LEARNING_EVENTS_SCHEMA,
    timestamp: new Date().toISOString(),
  });
  if (!parsed.success) return null;
  try {
    if (events.some((saved) => saved.id === parsed.data.id)) return parsed.data;
    localStorage.setItem(LEARNING_EVENTS_KEY, JSON.stringify([...events, parsed.data].slice(-2000)));
  } catch {
    // Event history is an optional local enhancement; progress remains usable without storage.
  }
  return parsed.data;
}

export function clearLearningEvents() {
  try {
    localStorage.removeItem(LEARNING_EVENTS_KEY);
  } catch {
    // Ignore storage restrictions; the next page load will safely read an empty history.
  }
}
