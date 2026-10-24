import type { DocumentationSnapshot } from './repositoryDocumentation';
export type RepositorySnapshot = Omit<DocumentationSnapshot, 'relationships' | 'report'> & {
  branch?: string | null;
  revision?: string | null;
  relationships: (DocumentationSnapshot['relationships'][number] & { mountPath?: string })[];
  report: DocumentationSnapshot['report'] & {
    supported: boolean;
    patterns: string[];
    exclusions: { path: string; reason: string }[];
  };
};
export type AnalysisJob = {
  id: string;
  status: string;
  progress: number;
  message: string;
  snapshot_id: string | null;
};
