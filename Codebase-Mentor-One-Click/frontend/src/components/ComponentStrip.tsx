import { useEffect, useRef } from 'react';
import { ArrowUpRight, FileCode2, Globe2, Waypoints } from 'lucide-react';
import { graphNodes } from '../data/fixtures';
import { getJourneySteps } from '../domain/model';
import { useWorkspace } from '../state/WorkspaceContext';

/** A readable component picker for the compact editor; the full map has its own view. */
export function ComponentStrip({ onOpenMap }: { onOpenMap: () => void }) {
  const { state, selectNode } = useWorkspace();
  const list = useRef<HTMLDivElement>(null);
  const steps = state.journeyId
    ? getJourneySteps(state.journeyId, state.scenario, state.snapshot)
    : [];
  const ids = [...new Set(steps.map((step) => step.nodeId))];
  const nodes = ids.length
    ? ids.map((id) => graphNodes.find((node) => node.id === id)!).filter(Boolean)
    : graphNodes.filter((node) => node.id !== 'email' || state.snapshot === 'head');

  useEffect(() => {
    const selected = list.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!selected || !list.current) return;
    const container = list.current;
    if (
      selected.offsetLeft < container.scrollLeft ||
      selected.offsetLeft + selected.offsetWidth > container.scrollLeft + container.clientWidth
    ) {
      container.scrollLeft =
        selected.offsetLeft - (container.clientWidth - selected.offsetWidth) / 2;
    }
  }, [state.selectedNode, state.journeyId, state.scenario, state.snapshot]);

  return (
    <section className="component-strip" aria-label="Code components">
      <div className="component-strip-heading">
        <span>
          <Waypoints size={14} />
          {state.journeyId ? 'Request steps' : 'Components'}
        </span>
        <button onClick={onOpenMap}>
          Open map <ArrowUpRight size={13} />
        </button>
      </div>
      <div className="component-strip-items" ref={list}>
        {nodes.map((node, index) => (
          <button
            key={node.id}
            aria-pressed={state.selectedNode === node.id}
            onClick={() => selectNode(node.id)}
          >
            <span className="component-strip-icon">
              {state.journeyId ? (
                index + 1
              ) : node.source ? (
                <FileCode2 size={16} />
              ) : (
                <Globe2 size={16} />
              )}
            </span>
            <span>
              <strong>{node.label}</strong>
              <small>{node.subtitle}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
