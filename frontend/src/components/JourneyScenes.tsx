import {
  ArrowRight,
  Braces,
  CheckCheck,
  CircleHelp,
  Database,
  GitBranch,
  HardDrive,
  Layers,
  ListOrdered,
  Network,
  Send,
  ShieldCheck,
  Timer,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { CodeJourney, JourneyEvent, JourneyLevel } from '../domain/codeJourney';
const scenes: Record<string, { icon: LucideIcon; label: string; metaphor: string }> = {
  http_request: { icon: Send, label: 'Request', metaphor: 'A visitor arrives at the front desk.' },
  validation: {
    icon: ShieldCheck,
    label: 'Validation',
    metaphor: 'Check the form before opening the next door.',
  },
  function_call: { icon: Braces, label: 'Function call', metaphor: 'Hand a task to a helper.' },
  database_read: {
    icon: Database,
    label: 'Database read',
    metaphor: 'Find an entry in a register.',
  },
  database_write: {
    icon: Database,
    label: 'Database write',
    metaphor: 'Write an entry in the register.',
  },
  branch: { icon: GitBranch, label: 'Decision', metaphor: 'A signpost chooses the next road.' },
  queue: { icon: ListOrdered, label: 'Queue', metaphor: 'A job waits its turn on a work list.' },
  cache: {
    icon: HardDrive,
    label: 'Cache',
    metaphor: 'Look in the nearby drawer before visiting the store.',
  },
  error: {
    icon: TriangleAlert,
    label: 'Error boundary',
    metaphor: 'Take the marked exit and explain the problem.',
  },
  async: {
    icon: Timer,
    label: 'Promise / async',
    metaphor: 'Wait for a helper’s result; other work may proceed.',
  },
  response: { icon: CheckCheck, label: 'Response', metaphor: 'Return a receipt to the caller.' },
};
export function sceneFor(kind: string) {
  return (
    scenes[kind] || {
      icon: CircleHelp,
      label: 'Source operation',
      metaphor: 'Read the highlighted source for this operation.',
    }
  );
}
export function JourneyScene({
  event,
  journey,
  level,
  alternative,
}: {
  event: JourneyEvent;
  journey: CodeJourney;
  level: JourneyLevel;
  alternative: boolean;
}) {
  const scene = sceneFor(event.kind),
    Icon = scene.icon;
  const DiagramIcon =
    journey.visualization === 'tree'
      ? Layers
      : journey.visualization === 'array'
        ? ListOrdered
        : journey.visualization === 'async'
          ? Timer
          : Network;
  return (
    <div className={`journey-scene scene-${event.kind}`} aria-label={`${scene.label} illustration`}>
      <span className="journey-scene-caption">
        REVIEWED VISUAL METAPHOR · illustration, not telemetry
      </span>
      {journey.visualization === 'array' ? (
        <div className="journey-array-scene">
          <span>
            low
            <br />
            <b>unknown</b>
          </span>
          <span className="scene-array-middle">
            middle
            <br />
            <b>unknown</b>
          </span>
          <span>
            high
            <br />
            <b>unknown</b>
          </span>
          <small>Schematic index boundaries; array length and values are unknown.</small>
        </div>
      ) : journey.visualization === 'tree' ? (
        <div className="journey-tree-scene">
          <span>
            <Layers size={18} />
            Counter
          </span>
          <i />
          <span>
            <Braces size={18} />
            button description
          </span>
          <small>State setter requests a later render. React internals are not captured.</small>
        </div>
      ) : journey.visualization === 'database' ? (
        <div className="journey-transaction-scene">
          <span>BEGIN</span>
          <ArrowRight size={18} />
          <span className="scene-active-object">
            <Database size={22} />
            query
          </span>
          <div>
            <span>COMMIT</span>
            <span>ROLLBACK</span>
          </div>
          <small>Illustrated source stages; actual transaction state is unknown.</small>
        </div>
      ) : (
        <div className="journey-scene-objects">
          <span>
            <DiagramIcon size={25} />
            <small>
              {journey.visualization === 'queue'
                ? 'Job'
                : journey.visualization === 'async'
                  ? 'Call stack'
                  : journey.visualization === 'cache'
                    ? 'Caller'
                    : 'Caller'}
            </small>
          </span>
          <ArrowRight className="scene-packet" size={24} />
          <span className="scene-active-object">
            <Icon size={34} />
            <small>{scene.label}</small>
          </span>
          {event.kind === 'branch' ? (
            <div className="scene-branch-arms">
              <span>condition true</span>
              <span>condition false</span>
            </div>
          ) : (
            <>
              <ArrowRight className="scene-packet" size={24} />
              <span>
                <CheckCheck size={25} />
                <small>
                  {journey.visualization === 'async'
                    ? 'Continuation'
                    : journey.visualization === 'queue'
                      ? 'Worker boundary'
                      : 'Next boundary'}
                </small>
              </span>
            </>
          )}
        </div>
      )}
      <p>
        {level === 'beginner' || alternative
          ? scene.metaphor
          : `${event.title}: ${event.condition}`}
      </p>
      {level === 'advanced' && (
        <code>
          sourceRefId: {event.sourceRefId} · coverage: {event.observationCoverage}
        </code>
      )}
    </div>
  );
}
