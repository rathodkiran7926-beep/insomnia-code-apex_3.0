import { files, journeys } from '../data/fixtures';
import type {
  DecisionAction,
  DecisionStatus,
  Goal,
  JourneyStep,
  Lesson,
  Prediction,
  Profile,
  Scenario,
  Snapshot,
  SourceRef,
} from '../data/types';

export function resolveSource(snapshot: Snapshot, ref: SourceRef) {
  const content = files[snapshot]?.[ref.path];
  if (
    content === undefined ||
    !Number.isInteger(ref.start) ||
    !Number.isInteger(ref.end) ||
    ref.start < 1 ||
    ref.end < ref.start ||
    ref.end > content.split('\n').length
  )
    return null;
  return {
    content,
    lines: content.split('\n'),
    selected: content
      .split('\n')
      .slice(ref.start - 1, ref.end)
      .join('\n'),
  };
}

export function canAdvance(isDecision: boolean, prediction?: Prediction) {
  return !isDecision || Boolean(prediction);
}

export function recordPrediction(previous: Prediction | undefined, answer: string): Prediction {
  return {
    first: previous?.first ?? answer,
    latest: answer,
    attempts: (previous?.attempts ?? 0) + 1,
  };
}

const lessons: Record<string, Lesson> = {
  architecture: {
    id: 'architecture',
    title: 'Find your way around',
    description: 'Map the API boundaries and the responsibilities of each module.',
    duration: '5 min',
  },
  routing: {
    id: 'routing',
    title: 'Routes, middleware, and the order that matters',
    description: 'Learn why validation runs before account creation.',
    duration: '6 min',
    journey: 'signup',
  },
  signup: {
    id: 'signup',
    title: 'Follow an account from request to database',
    description: 'Trace signup and predict what happens to a duplicate email.',
    duration: '8 min',
    journey: 'signup',
  },
  login: {
    id: 'login',
    title: 'Understand the authentication boundary',
    description: 'Find the condition that decides whether a token is created.',
    duration: '6 min',
    journey: 'login',
  },
  practice: {
    id: 'practice',
    title: 'Make your first small contribution',
    description: 'Add a password rule and verify it with local schema assertions.',
    duration: '12 min',
  },
  'edge-tests': {
    id: 'edge-tests',
    title: 'Turn failure branches into regression tests',
    description: 'Compare the duplicate-email and invalid-input test expectations.',
    duration: '10 min',
  },
  verification: {
    id: 'verification',
    title: 'Relearn the new account lifecycle',
    description: 'Explore the verification step introduced by PR #402.',
    duration: '4 min',
  },
};

export function getRoute(profile: Profile, goal: Goal): Lesson[] {
  const ids = ['architecture', ...(profile === 'beginner' ? ['routing'] : []), 'signup'];
  if (goal === 'understand') ids.push('login');
  if (goal === 'contribute') ids.push('practice');
  if (goal === 'testing') ids.push('login', 'edge-tests');
  return ids.map((id) => lessons[id]);
}

export function affectedConcepts(completed: string[], changed: string[]) {
  return completed.filter((id) => changed.includes(id));
}

export function conceptsNeedingReview(
  studied: Record<string, Snapshot[]>,
  changed: string[],
  target: Snapshot,
) {
  return changed.filter((id) => Boolean(studied[id]?.length) && !studied[id].includes(target));
}

export function relearningTarget(studied: Record<string, Snapshot[]>): 'signup' | 'login' {
  return conceptsNeedingReview(studied, ['signup', 'login'], 'head')[0] === 'login'
    ? 'login'
    : 'signup';
}

export function reachableStep(
  steps: JourneyStep[],
  requested: number,
  predictions: Record<string, Prediction>,
  prefix: string,
) {
  const bounded = Math.max(0, Math.min(requested, steps.length - 1));
  const unanswered = steps.findIndex(
    (step, index) => index < bounded && step.check && !predictions[`${prefix}:${step.id}`],
  );
  return unanswered >= 0 ? unanswered : bounded;
}

export function transitionDecision(status: DecisionStatus, action: DecisionAction): DecisionStatus {
  const transitions: Partial<
    Record<DecisionStatus, Partial<Record<DecisionAction, DecisionStatus>>>
  > = {
    open: { draft: 'draft' },
    draft: { review: 'awaiting_review' },
    awaiting_review: { approve: 'approved', draft: 'draft' },
    approved: { publish: 'published', invalidate: 'needs_review' },
    published: { invalidate: 'needs_review', supersede: 'superseded' },
    needs_review: { draft: 'draft', supersede: 'superseded' },
  };
  const next = transitions[status]?.[action];
  if (!next) throw new Error(`Cannot ${action} a ${status} decision.`);
  return next;
}

export function getJourneySteps(
  id: 'signup' | 'login',
  scenario: Scenario,
  snapshot: Snapshot,
): JourneyStep[] {
  let steps = journeys.find((x) => x.id === id)!.steps.map((step) => ({ ...step }));
  if (id === 'signup' && scenario === 'invalid') steps = steps.slice(0, 2);
  if (id === 'signup' && scenario === 'duplicate') steps = steps.slice(0, 4);
  if (id === 'login' && scenario === 'invalid') steps = steps.slice(0, 3);
  if (snapshot === 'head') {
    steps = steps.map((step) => {
      if (step.id === 'login-check')
        return { ...step, source: { ...step.source, start: 26, end: 30 } };
      if (step.id === 'persist')
        return {
          ...step,
          explanation:
            'The repository creates an unverified account. The service then requests a verification message and returns a pending status.',
          technical:
            'users.create() receives emailVerified: false. The service awaits verification.send(user), then returns id, email, and status: pending. Database effects and provider delivery remain unverified.',
          source: { path: 'src/services/user.service.ts', start: 16, end: 24 },
        };
      return step;
    });
    if (id === 'signup' && scenario === 'success')
      steps.push({
        id: 'verification',
        nodeId: 'email',
        title: 'Request email verification',
        short: 'Request verification',
        explanation:
          'The new account starts unverified. The service requests a verification message before returning a pending response. Actual email delivery is outside this source path.',
        technical:
          'await verification.send(user) delegates to mailer.send(). This source-described integration does not establish provider delivery or successful execution.',
        source: { path: 'src/services/verification.service.ts', start: 5, end: 12 },
      });
    if (id === 'login' && scenario === 'success')
      steps.splice(3, 0, {
        id: 'verified-check',
        nodeId: 'user-service',
        title: 'Require a verified account',
        short: 'Check verification',
        explanation:
          'Correct credentials are no longer enough: an unverified account throws before token signing.',
        technical:
          'if (!user.emailVerified) throws UnauthorizedError before tokens.sign(). This is a direct behavior change in the head snapshot.',
        source: { path: 'src/services/user.service.ts', start: 31, end: 34 },
        check: {
          question: 'Can correct credentials sign in before email verification?',
          options: [
            { id: 'yes', text: 'Yes, the password check is sufficient' },
            { id: 'no', text: 'No, verified email is now required' },
          ],
          correct: 'no',
          explanation:
            'The new emailVerified guard throws before token signing. This is the additional condition introduced by PR #402.',
        },
      });
  }
  return steps;
}
