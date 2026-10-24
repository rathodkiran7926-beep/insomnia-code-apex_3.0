export type PracticeDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type PracticeContext = {
  goal?: 'understand' | 'contribute' | 'testing';
  profile?: 'beginner' | 'experienced';
  journey?: string;
  lesson?: string;
  studiedConcepts?: string[];
};
export type PracticeEvidence = {
  snapshotId: string;
  referenceId: string;
  file: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  url: string;
};
export type PracticeTask = {
  id: string;
  snapshotId: string;
  repository: string;
  commit: string;
  component: { id: string; name: string; role: string };
  difficulty: PracticeDifficulty;
  title: string;
  brief: string;
  whyItMatters: string;
  criteria: string[];
  firstHint: string;
  citations: PracticeEvidence[];
  startingCode: string;
  evidence: PracticeEvidence;
  verification: { kind: 'syntax-only'; message: string };
};
export type QuizQuestion = {
  id: string;
  category: 'coding_practice' | 'collaboration';
  concept: string;
  prompt: string;
  options: { id: string; text: string }[];
};
export type QuizSession = {
  id: string;
  difficulty: PracticeDifficulty;
  questions: QuizQuestion[];
  message: string;
};
export type QuizAnswer = {
  correct: boolean;
  correctOption: string;
  explanation: string;
  citations?: PracticeEvidence[];
  progress: { attempts: number; correct: number; dueAt: string };
};
export type PracticeAttemptSummary = {
  id: string;
  taskId: string;
  difficulty: PracticeDifficulty;
  verificationStatus: 'passed' | 'failed' | 'unavailable';
  verificationErrors: string[];
  createdAt: string;
};
export type PracticeRequest = {
  snapshotId: string;
  learnerId: string;
  difficulty: PracticeDifficulty;
  context: PracticeContext;
};

const learnerStorageKey = 'codebase-mentor.practice-learner.v1';
let memoryLearnerId: string | undefined;
export function getPracticeLearnerId() {
  try {
    const saved = localStorage.getItem(learnerStorageKey);
    if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) return saved;
    memoryLearnerId ||= crypto.randomUUID();
    localStorage.setItem(learnerStorageKey, memoryLearnerId);
  } catch { memoryLearnerId ||= crypto.randomUUID(); }
  return memoryLearnerId;
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('Practice API unavailable. Start the backend on port 3001 and retry.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Practice request failed.');
  return data;
}

export function loadPracticeTasks(input: PracticeRequest) {
  return request<{ tasks: PracticeTask[]; snapshotId: string; message: string }>(
    '/api/practice/tasks',
    input,
  );
}

export function submitPracticeAttempt(input: {
  learnerId: string;
  taskId: string;
  code: string;
  reflection: string;
}) {
  return request<{
    id: string;
    verification: {
      status: 'passed' | 'failed' | 'unavailable';
      errors: string[];
      checks: string[];
      message: string;
      scope: 'syntax-only';
      runtimeTestsExecuted: false;
    };
  }>('/api/practice/attempts', input);
}

export async function loadPracticeAttempts(learnerId: string, snapshotId: string) {
  const query = new URLSearchParams({ learnerId, snapshotId });
  const response = await fetch(`/api/practice/attempts?${query}`);
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('Practice API unavailable. Start the backend on port 3001 and retry.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load practice history.');
  return data as { attempts: PracticeAttemptSummary[]; snapshotId: string };
}

export function startQuiz(input: Omit<PracticeRequest, 'snapshotId'>) {
  return request<QuizSession>('/api/practice/quizzes/sessions', input);
}

export function submitQuizAnswer(
  sessionId: string,
  input: { learnerId: string; questionId: string; optionId: string },
) {
  return request<QuizAnswer>(`/api/practice/quizzes/sessions/${sessionId}/answers`, input);
}
