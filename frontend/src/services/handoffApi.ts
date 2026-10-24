import type { ArchitectureSnapshot } from '../domain/backendArchitecture';
export type SharedRepository = {
  graph: Omit<ArchitectureSnapshot, 'references'> & {
    snapshotId: string;
    repository: string;
    commit: string;
    references: Omit<Evidence, 'excerpt'>[];
  };
  files: { path: string; redacted: number }[];
  coverage: {
    analyzedFiles: number;
    capturedFiles: number;
    unavailable: string[];
    limited: boolean;
    note: string;
  };
};
export type SharedRepositorySource = {
  file: string;
  excerpt: string;
  startLine: number;
  endLine: number;
  complete: boolean;
  redacted: boolean;
  commit: string;
  snapshotId: string;
  url: string;
};
export type TeamUser = { id: string; name: string; email: string };
export type TeamWorkspace = {
  id: string;
  name: string;
  role: 'maintainer' | 'reviewer' | 'developer';
};
export type TeamMember = TeamUser & { role: TeamWorkspace['role'] };
export type HandoffSession = {
  id: string;
  workspace_id: string;
  repository_id: string;
  created_by: string;
  assigned_to: string | null;
  title: string;
  question: string;
  expected_behavior: string;
  actual_behavior: string;
  attempted_solutions: string;
  status: 'OPEN' | 'IN_REVIEW' | 'NEEDS_CONTEXT' | 'RESOLVED' | 'CLOSED';
  created_at: string;
  updated_at: string;
  author_name: string;
  assignee_name?: string;
  file_path?: string;
  commit_sha?: string;
};
type Evidence = {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  url: string;
};
type Finding = { text: string; referenceIds: string[] };
export type Briefing = {
  state: string;
  notice: string;
  purpose?: Finding;
  findings?: Finding[];
  hypotheses?: string[];
  unresolved?: string[];
  review?: string[];
};
export type HandoffComment = {
  id: string;
  author_id: string;
  author_name: string;
  content: string;
  line_start: number | null;
  line_end: number | null;
  kind: string;
  created_at: string;
};
export type HandoffDetail = {
  session: HandoffSession;
  role?: TeamWorkspace['role'];
  snapshot: {
    id: string;
    analysis_snapshot_id: string;
    component_id: string | null;
    reference_id: string;
    file_path: string;
    function_name: string | null;
    start_line: number;
    end_line: number;
    source_code: string;
    commit_sha: string;
    branch_name: string | null;
    source_url: string;
    briefing: Briefing | null;
    context: {
      facts: string[];
      references: Evidence[];
      relationships: { source: string; target: string; type: string; referenceId: string }[];
      connected: { id: string; name: string; role: string; referenceId: string }[];
      tests: Evidence[];
      limitations: string[];
      documentation: string | null;
    };
  };
  comments: HandoffComment[];
  commentCount: number;
  resolutions: {
    id: string;
    proposed_by: string;
    author_name: string;
    confirmed_by: string | null;
    solution: string;
    explanation: string;
    approved_for_knowledge: number;
    created_at: string;
    confirmed_at: string | null;
  }[];
  activity: { id: string; actor_name: string; event_type: string; created_at: string }[];
};
export class HandoffError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function handoffApi<T>(
  url: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new HandoffError('Start the backend and retry.', response.status);
  const data = await response.json();
  if (!response.ok) throw new HandoffError(data.error || 'Request failed.', response.status);
  return data;
}
