export type Snapshot = 'base' | 'head';
export type Scenario = 'success' | 'duplicate' | 'invalid';
export type Profile = 'beginner' | 'experienced';
export type Goal = 'understand' | 'contribute' | 'testing';
export type DecisionStatus =
  'open' | 'draft' | 'awaiting_review' | 'approved' | 'published' | 'needs_review' | 'superseded';
export type DecisionAction =
  'draft' | 'review' | 'approve' | 'publish' | 'invalidate' | 'supersede';
export interface SourceRef {
  path: string;
  start: number;
  end: number;
}
export interface Prediction {
  first: string;
  latest: string;
  attempts: number;
}
export interface GraphNode {
  id: string;
  label: string;
  subtitle: string;
  category: 'interface' | 'service' | 'storage' | 'external';
  icon: 'globe' | 'route' | 'shield' | 'layers' | 'key' | 'database' | 'mail' | 'box';
  source?: SourceRef;
  description: string;
  technical: string;
  position: { x: number; y: number };
}
export interface GraphRelation {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: string;
  status: 'supported' | 'inferred' | 'unresolved';
  source?: SourceRef;
  headOnly?: boolean;
}
export interface JourneyStep {
  id: string;
  nodeId: string;
  title: string;
  short: string;
  explanation: string;
  technical: string;
  source: SourceRef;
  check?: {
    question: string;
    options: { id: string; text: string }[];
    correct: string;
    explanation: string;
  };
}
export interface Journey {
  id: 'signup' | 'login';
  title: string;
  description: string;
  duration: string;
  steps: JourneyStep[];
  tags: string[];
}
export interface Lesson {
  id: string;
  title: string;
  description: string;
  duration: string;
  journey?: 'signup' | 'login';
}
export interface PullRequest {
  id: string;
  number: number;
  title: string;
  branch: string;
  description: string;
  files: { path: string; additions: number; deletions: number }[];
  concepts: string[];
}
