import type { RepositorySnapshot } from '../domain/analysisTypes';
import { analysisApi } from './analysisApi';

export type ImpactScenario = 'behavior-change' | 'remove-or-rename';
export type ImpactReference = RepositorySnapshot['references'][number];
export type ImpactEvidenceEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  referenceId: string;
  reference: ImpactReference | null;
};
export type ImpactAffectedComponent = {
  id: string;
  name: string;
  role: string;
  referenceId: string | null;
  reference: ImpactReference | null;
  minDepth: number;
  relationshipTypes: string[];
  evidencePaths: ImpactEvidenceEdge[][];
};
export type ImpactPreviewResult = {
  snapshotId: string;
  commitSha: string;
  selectedComponentId: string;
  scenario: ImpactScenario;
  depth: number;
  limit: number;
  affected: ImpactAffectedComponent[];
  supportedTests: ImpactReference[];
  unresolvedRelationshipCount: number;
  truncated: boolean;
  unsupportedRelationshipTypes: string[];
  limitations: string[];
};
export type ImpactExplanation = {
  snapshotId: string;
  selectedComponentId: string;
  affectedComponentId: string;
  sentences: string[];
  referenceIds: string[];
  mode: 'ai' | 'source-facts';
  notice: string;
};
export type ImpactCodeAnalysis = {
  snapshotId: string;
  commitSha: string;
  selectedComponentId: string;
  scenario: ImpactScenario;
  analysis: {
    summary: string;
    behaviorChanges: string[];
    dependencyImpacts: string[];
    reviewChecks: string[];
    referenceIds: string[];
    mode: 'ai' | 'source-facts';
    notice: string;
  };
};

const ANALYSIS_VERSION = 'impact-preview-v1';
const resultCache = new Map<string, ImpactPreviewResult>();
const explanationCache = new Map<string, ImpactExplanation>();

function resultKey(
  snapshotId: string,
  componentId: string,
  scenario: ImpactScenario,
  depth: number,
  limit: number,
) {
  return JSON.stringify([snapshotId, componentId, scenario, depth, limit, ANALYSIS_VERSION]);
}

export async function fetchImpactPreview(
  snapshotId: string,
  componentId: string,
  scenario: ImpactScenario,
  signal: AbortSignal,
): Promise<ImpactPreviewResult> {
  const key = resultKey(snapshotId, componentId, scenario, 2, 30);
  const cached = resultCache.get(key);
  if (cached) return cached;
  const query = new URLSearchParams({ scenario, depth: '2', limit: '30' });
  const result = await analysisApi<ImpactPreviewResult>(
    `/api/snapshots/${encodeURIComponent(snapshotId)}/components/${encodeURIComponent(componentId)}/impact-preview?${query}`,
    { signal },
  );
  if (result.snapshotId !== snapshotId || result.selectedComponentId !== componentId)
    throw new Error('Impact preview snapshot or component mismatch');
  resultCache.set(key, result);
  return result;
}

export async function fetchImpactExplanation(
  snapshotId: string,
  componentId: string,
  affectedComponentId: string,
  scenario: ImpactScenario,
  path: ImpactEvidenceEdge[],
  signal: AbortSignal,
): Promise<ImpactExplanation> {
  const key = JSON.stringify([
    snapshotId,
    componentId,
    affectedComponentId,
    scenario,
    path.map((edge) => [edge.id, edge.referenceId]),
    ANALYSIS_VERSION,
  ]);
  const cached = explanationCache.get(key);
  if (cached) return cached;
  const query = new URLSearchParams({
    scenario,
    affectedComponentId,
  });
  path.forEach((edge) => query.append('evidencePathEdgeIds', edge.id));
  const explanation = await analysisApi<ImpactExplanation>(
    `/api/snapshots/${encodeURIComponent(snapshotId)}/components/${encodeURIComponent(componentId)}/impact-explanations?${query}`,
    { signal },
  );
  if (
    explanation.snapshotId !== snapshotId ||
    explanation.selectedComponentId !== componentId ||
    explanation.affectedComponentId !== affectedComponentId
  )
    throw new Error('Impact explanation snapshot or component mismatch');
  explanationCache.set(key, explanation);
  return explanation;
}

export async function analyzeImpactCodeChange(
  snapshotId: string,
  componentId: string,
  scenario: ImpactScenario,
  proposedCode: string,
  signal: AbortSignal,
): Promise<ImpactCodeAnalysis> {
  const result = await analysisApi<ImpactCodeAnalysis>(
    `/api/snapshots/${encodeURIComponent(snapshotId)}/components/${encodeURIComponent(componentId)}/impact-analysis`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario, proposedCode }),
      signal,
    },
  );
  if (
    result.snapshotId !== snapshotId ||
    result.selectedComponentId !== componentId ||
    result.scenario !== scenario
  )
    throw new Error('Impact analysis snapshot, component, or scenario mismatch');
  return result;
}
