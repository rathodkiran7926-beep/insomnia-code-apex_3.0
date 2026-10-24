import { useEffect, useState } from 'react';
import { useCollaboration } from './CollaborationContext';
import { handoffApi } from '../services/handoffApi';
import { readGuestProgress, saveGuestProgress } from '../services/journeyProgress';
import type { JourneyCheckpoint } from '../domain/codeJourney';
export function useJourneyProgress() {
  const { account } = useCollaboration();
  const [progress, setProgress] = useState<Record<string, JourneyCheckpoint>>({});
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!account) {
      setProgress(readGuestProgress());
      setReady(true);
      return;
    }
    handoffApi<{ checkpoints: JourneyCheckpoint[] }>('/api/codejourneys/progress')
      .then((r) => {
        if (!cancelled) setProgress(Object.fromEntries(r.checkpoints.map((p) => [p.journeyId, p])));
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [account?.user.id]);
  async function save(value: JourneyCheckpoint) {
    let stored: JourneyCheckpoint;
    if (account) {
      const {
        journeyId,
        scenarioId: _scenario,
        updatedAt: _updated,
        completedScenarios: _completedScenarios,
        ...body
      } = value;
      stored = await handoffApi<JourneyCheckpoint>(
        `/api/codejourneys/${journeyId}/checkpoint`,
        body,
        'PUT',
      );
    } else stored = saveGuestProgress(value);
    setProgress((old) => ({ ...old, [value.journeyId]: stored }));
  }
  return { progress, ready, error, save };
}
