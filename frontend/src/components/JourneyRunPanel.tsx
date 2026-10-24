import { useEffect, useState } from 'react';
import { Button, Modal } from './UI';
import { HandoffAccountGate } from './HandoffAccount';
import { useCollaboration } from '../state/CollaborationContext';
import { handoffApi } from '../services/handoffApi';
import type { CodeJourney, JourneyScenario, JourneyTrace } from '../domain/codeJourney';
export function JourneyRunPanel({
  journey,
  trace,
  scenario,
  onTrace,
  onPause,
}: {
  journey: CodeJourney;
  trace: JourneyTrace;
  scenario: JourneyScenario;
  onTrace: (trace: JourneyTrace) => void;
  onPause: () => void;
}) {
  const { account } = useCollaboration();
  const [open, setOpen] = useState(false),
    [approved, setApproved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [runner, setRunner] = useState<{
      available: boolean;
      message: string;
      setupCommand?: string;
    } | null>(null),
    [runs, setRuns] = useState<JourneyTrace[]>([]),
    [compare, setCompare] = useState<JourneyTrace | null>(null);
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    handoffApi<{ traces: JourneyTrace[] }>(`/api/codejourneys/${journey.id}/runs`)
      .then((r) => {
        if (!cancelled) setRuns(r.traces);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [account?.user.id, journey.id]);
  return (
    <>
      <section className="journey-run-panel">
        <div>
          <h2>Watch what actually happened</h2>
          <p>
            Only signup success and invalid-input scenarios have approved execution hooks. Other
            paths stay explained. Animation alone is never a recording.
          </p>
        </div>
        <Button
          disabled={!scenario.runRecipe || busy}
          onClick={async () => {
            onPause();
            setOpen(true);
            setApproved(false);
            setError('');
            try {
              setRunner(await handoffApi('/api/codejourneys/runner'));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Run approved scenario
        </Button>
        {runs.length > 0 && (
          <label>
            Recorded scenarios
            <select
              aria-label="Open recorded scenario"
              value={trace.mode === 'observed_replay' ? trace.id : ''}
              onChange={(e) => {
                const run = runs.find((r) => r.id === e.target.value);
                if (run) onTrace(run);
              }}
            >
              <option value="">Choose a recorded run</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.scenarioId} · {r.createdAt && new Date(r.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
        )}
        {trace.mode === 'observed_replay' &&
          runs.some((r) => r.id !== trace.id && r.snapshotId === trace.snapshotId) && (
            <label>
              Compare captured outcomes
              <select
                aria-label="Compare captured scenarios"
                value={compare?.id || ''}
                onChange={(e) => setCompare(runs.find((r) => r.id === e.target.value) || null)}
              >
                <option value="">No comparison</option>
                {runs
                  .filter((r) => r.id !== trace.id && r.snapshotId === trace.snapshotId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.scenarioId} · {r.id.slice(0, 8)}
                    </option>
                  ))}
              </select>
            </label>
          )}
        {compare && (
          <p>
            Current capture: {trace.events.map((e) => e.key).join(' → ')}
            <br />
            Other capture: {compare.events.map((e) => e.key).join(' → ')}
            <br />
            This compares only these two captures, not all possible executions.
          </p>
        )}
        {error && (
          <p role="alert" className="journey-alert">
            {error}
          </p>
        )}
      </section>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Approve a controlled scenario"
        description="Runs the fixed teaching recipe, never arbitrary repository code."
      >
        <div className="dialog-body journey-run-dialog">
          <p>{runner?.message || 'Checking the isolated runner…'}</p>
          <p>
            <strong>{scenario.label}</strong> uses a restricted container, in-memory SQLite and
            container-local HTTP. No custom input, host mounts, external network or application
            secrets are supplied.
          </p>
          {runner?.setupCommand && (
            <>
              <p>Operator setup from the project root:</p>
              <code>{runner.setupCommand}</code>
            </>
          )}
          <HandoffAccountGate>
            <label className="journey-approval">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              I approve this fixed isolated scenario.
            </label>
            <Button
              disabled={!approved || busy || !runner?.available}
              variant="primary"
              onClick={async () => {
                if (!scenario.runRecipe || busy) return;
                setBusy(true);
                setError('');
                try {
                  const captured = await handoffApi<JourneyTrace>(
                    `/api/scenarios/${scenario.runRecipe}/runs`,
                    { approved: true },
                  );
                  setOpen(false);
                  onTrace(captured);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Capturing actual events…' : 'Run & capture'}
            </Button>
          </HandoffAccountGate>
          {error && (
            <p role="alert" className="journey-alert">
              {error}
            </p>
          )}
          <Button onClick={() => setOpen(false)}>Keep the explained path</Button>
        </div>
      </Modal>
    </>
  );
}
