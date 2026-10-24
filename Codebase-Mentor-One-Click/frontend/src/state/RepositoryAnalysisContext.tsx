import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AnalysisJob, RepositorySnapshot } from '../domain/analysisTypes';
import { analysisApi } from '../services/analysisApi';
const Context = createContext<{
  snapshot: RepositorySnapshot | null;
  job: AnalysisJob | null;
  loading: boolean;
  error: string;
  setActiveJob: (id: string) => void;
  repositoryUrl: string;
  setRepositoryUrl: (url: string) => void;
} | null>(null);
export function RepositoryAnalysisProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState(() => localStorage.getItem('mentor-analysis-job') || '');
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null);
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState('');
  const [repositoryUrl, updateRepositoryUrl] = useState(
    () => localStorage.getItem('mentor-repository-url') || '',
  );
  function setRepositoryUrl(url: string) {
    localStorage.setItem('mentor-repository-url', url);
    updateRepositoryUrl(url);
  }
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await analysisApi<AnalysisJob>(`/api/analyses/${id}`);
        if (cancelled) return;
        setJob(next);
        if (next.status === 'complete' && next.snapshot_id) {
          const result = await analysisApi<RepositorySnapshot>(
            `/api/snapshots/${next.snapshot_id}`,
          );
          if (cancelled) return;
          if (
            result.snapshotId !== next.snapshot_id ||
            result.documentation.snapshotId !== result.snapshotId
          )
            throw new Error(
              'Analysis and documentation versions do not match. Please analyze the repository again.',
            );
          setSnapshot(result);
          updateRepositoryUrl((current) => {
            if (current) return current;
            localStorage.setItem('mentor-repository-url', result.repository);
            return result.repository;
          });
          setError('');
          setLoading(false);
        } else if (next.status === 'failed') {
          setError(next.message);
          setLoading(false);
        } else {
          setLoading(false);
          timer = setTimeout(() => void poll(), 1000);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
          setJob(null);
        }
      }
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);
  function setActiveJob(next: string) {
    localStorage.setItem('mentor-analysis-job', next);
    setSnapshot(null);
    setError('');
    setLoading(true);
    setJob(null);
    setId(next);
  }
  return (
    <Context.Provider
      value={{ snapshot, job, loading, error, setActiveJob, repositoryUrl, setRepositoryUrl }}
    >
      {children}
    </Context.Provider>
  );
}
export function useRepositoryAnalysis() {
  const value = useContext(Context);
  if (!value) throw new Error('RepositoryAnalysisProvider is required');
  return value;
}
