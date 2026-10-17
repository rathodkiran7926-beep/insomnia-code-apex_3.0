import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { analysisApi } from '../services/analysisApi';
import type { RepositorySnapshot } from '../domain/analysisTypes';
import { RepositorySource } from './RepositorySource';

type Reference = RepositorySnapshot['references'][number];
type CompleteSource = Omit<Reference, 'id'> & { complete: boolean };

export function RepositoryFileSource({
  source,
  snapshotId,
  commit,
}: {
  source?: Reference;
  snapshotId: string;
  commit: string;
}) {
  const [file, setFile] = useState<CompleteSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setError('');
    setLoading(true);
    if (!source) {
      setLoading(false);
      return;
    }
    analysisApi<CompleteSource>(
      `/api/snapshots/${snapshotId}/source?referenceId=${encodeURIComponent(source.id)}`,
    )
      .then((result) => {
        if (cancelled) return;
        if (result.snapshotId !== snapshotId || result.file !== source.file || !result.complete)
          throw new Error('Complete source does not match the selected analysis.');
        setFile(result);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, snapshotId]);
  return (
    <div className="repository-file-source">
      {loading && (
        <div className="repository-file-loading" role="status">
          <LoaderCircle size={14} />
          Loading complete file…
        </div>
      )}
      {error && (
        <p className="repository-file-error" role="status">
          Could not load the complete file: {error} Showing the saved excerpt below.
        </p>
      )}
      <RepositorySource source={file || source} commit={commit} focusRange={source} />
    </div>
  );
}
