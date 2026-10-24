export const emptyMemory = {
  title: '',
  summary: '',
  context: '',
  decision: '',
  rationale: '',
  constraints: '',
  alternatives: '',
  consequences: '',
  observedFailure: '',
  environment: '',
  suspectedCause: '',
  reviewedCause: '',
  causeStatus: 'unknown',
  resolution: '',
  prevention: '',
  resolutionStatus: 'not_verified',
  verificationNote: '',
};
export type MemoryContent = Record<keyof typeof emptyMemory, string>;
export type MemoryEvidence = {
  snapshotId: string;
  commit: string;
  referenceId: string;
  file: string;
  startLine: number;
  endLine: number;
  url: string;
  componentName: string | null;
};
export type MemoryRecord = {
  id: string;
  workspace_id: string;
  repository_id: string;
  type: 'decision' | 'failure_lesson';
  revision: number;
  status: 'draft' | 'awaiting_review' | 'approved' | 'needs_review' | 'superseded' | 'withdrawn';
  created_by: string;
  origin_session_id: string | null;
  origin_resolution_id: string | null;
  superseded_by: string | null;
  content: MemoryContent;
  evidence: MemoryEvidence[];
  approvedBy: string | null;
  approvedAt: string | null;
  authoritative: boolean;
  applicability: { state: string; note: string; files?: string[] };
  publicationNote: string;
};
export const memoryLabels: Record<keyof MemoryContent, string> = {
  title: 'Title',
  summary: 'Summary',
  context: 'Context / problem',
  decision: 'Decision',
  rationale: 'Rationale',
  constraints: 'Constraints / invariants',
  alternatives: 'Alternatives considered',
  consequences: 'Consequences / trade-offs',
  observedFailure: 'Reported failure',
  environment: 'Environment / reproduction context',
  suspectedCause: 'Suspected cause',
  reviewedCause: 'Maintainer-reported cause',
  causeStatus: 'Cause status',
  resolution: 'Resolution',
  prevention: 'Prevention / follow-up',
  resolutionStatus: 'Resolution verification',
  verificationNote: 'Verification / review notes',
};
export function fieldsForMemory(type: MemoryRecord['type']): (keyof MemoryContent)[] {
  return type === 'decision'
    ? ['summary', 'context', 'decision', 'rationale', 'constraints', 'alternatives', 'consequences']
    : [
        'summary',
        'context',
        'observedFailure',
        'environment',
        'suspectedCause',
        'reviewedCause',
        'rationale',
        'resolution',
        'prevention',
        'verificationNote',
      ];
}
