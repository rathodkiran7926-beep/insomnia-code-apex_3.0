import { useEffect, useState } from 'react';
import { analysisApi } from './analysisApi';

export type GeneratedGuide = {
  snapshotId: string;
  componentId: string | null;
  scope: string;
  generatedAt: string;
  contextLimited: boolean;
  sections: { title: string; content: string; referenceIds: string[] }[];
  citations: { id: string; file: string; startLine: number; endLine: number; url: string }[];
};
type Selection = {
  snapshotId: string;
  componentId?: string;
  scope?: 'all' | 'frontend' | 'backend';
};
const requests = new Map<string, Promise<GeneratedGuide>>();
export function useGeneratedGuide(selection: Selection, active = true) {
  const { snapshotId, componentId, scope = 'all' } = selection;
  const key = JSON.stringify([snapshotId, componentId || null, scope]);
  const [state, setState] = useState<{
    key: string;
    guide: GeneratedGuide | null;
    error: string;
    loading: boolean;
  }>({ key, guide: null, error: '', loading: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setState({ key, guide: null, error: '', loading: true });
    const timer = setTimeout(() => {
      let request = requests.get(key);
      if (!request) {
        request = analysisApi<GeneratedGuide>(
          `/api/snapshots/${snapshotId}/generated-documentation`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...(componentId ? { componentId } : {}), scope }),
          },
        ).then((result) => {
          if (
            result.snapshotId !== snapshotId ||
            result.componentId !== (componentId || null) ||
            result.scope !== scope
          )
            throw new Error('Documentation does not match this selection.');
          return result;
        });
        requests.set(key, request);
        request.catch(() => {
          requests.delete(key);
        });
      }
      request
        .then((guide) => {
          if (!cancelled) setState({ key, guide, error: '', loading: false });
        })
        .catch((e) => {
          if (!cancelled)
            setState({ key, guide: null, error: (e as Error).message, loading: false });
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, snapshotId, componentId, scope, active, attempt]);
  return {
    guide: state.key === key ? state.guide : null,
    error: state.key === key ? state.error : '',
    loading: active && (state.key !== key || state.loading),
    retry: () => setAttempt((n) => n + 1),
  };
}
export function generatedGuideMarkdown(guide: GeneratedGuide) {
  return [
    '## AI source-based documentation',
    '',
    ...guide.sections.flatMap((s) => [
      `### ${s.title}`,
      '',
      s.content,
      '',
      ...s.referenceIds.map((id) => {
        const r = guide.citations.find((c) => c.id === id);
        return r ? `- [${r.file}:${r.startLine}-${r.endLine}](${r.url})` : '';
      }),
      '',
    ]),
    'Inferred from captured source; verify interpretations against the implementation.',
    '',
  ].join('\n');
}
