/** Request-specific presentation metadata; never changes immutable snapshot evidence. */
export const ANALYSIS_REVISION_LABEL_KEY = 'mentor-analysis-revision-label.v1';

export function revisionLabelForRequest(revision: string): string {
  return revision.trim() || 'Default branch';
}

export function labelForActiveJob(jobId: string, raw: string | null): string | null {
  if (!jobId || !raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const entry = value as Record<string, unknown>;
    return entry.jobId === jobId && typeof entry.label === 'string' &&
      entry.label.length > 0 && entry.label.length <= 200
      ? entry.label : null;
  } catch {
    return null;
  }
}

export function displayedSnapshotRevision(
  snapshot: { branch?: string | null; revision?: string | null },
  requestLabel: string | null,
): string {
  return requestLabel || snapshot.branch || snapshot.revision || 'Pinned commit';
}
