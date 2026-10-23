import { useEffect, useMemo, useRef } from 'react';
import { Background, Controls, MarkerType, Panel, Position, ReactFlow } from '@xyflow/react';
import type { Node, Edge, ReactFlowInstance } from '@xyflow/react';
import { Crosshair, Code2 } from 'lucide-react';
import type { RepositorySnapshot } from '../domain/analysisTypes';
import { workspaceGraphPositions } from '../domain/workspaceGraph';

export function WorkspaceConnectionMap({
  selectedId,
  snapshot,
  onSelect,
}: {
  selectedId: string;
  snapshot: RepositorySnapshot;
  onSelect: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const instance = useRef<ReactFlowInstance | null>(null);
  const refs = useMemo(() => new Map(snapshot.references.map((ref) => [ref.id, ref])), [snapshot]);
  const { nodes, edges, total } = useMemo(() => {
    const connected = snapshot.relationships.filter(
      (edge) => edge.source === selectedId || edge.target === selectedId,
    );
    const known = new Set(snapshot.components.map((component) => component.id));
    const neighbors = [...new Set(connected.flatMap((edge) => [edge.source, edge.target]))].filter(
      (id) => id !== selectedId && known.has(id),
    );
    const visible = new Set([selectedId, ...neighbors.slice(0, 24)]);
    const positions = workspaceGraphPositions(
      selectedId,
      connected
        .filter((edge) => edge.target === selectedId && visible.has(edge.source))
        .map((edge) => edge.source),
      connected
        .filter((edge) => edge.source === selectedId && visible.has(edge.target))
        .map((edge) => edge.target),
    );
    const nodes: Node[] = snapshot.components
      .filter((component) => visible.has(component.id))
      .map((component) => {
        const ref = refs.get(component.referenceId);
        const description = snapshot.documentation.ai.explanations.find(
          (item) => item.componentId === component.id,
        )?.explanation;
        const types = [
          ...new Set(
            connected
              .filter((edge) => edge.source === component.id || edge.target === component.id)
              .map((edge) => edge.type.replaceAll('_', ' ')),
          ),
        ].join(' / ');
        return {
          id: component.id,
          position: positions.get(component.id) || { x: 310, y: 0 },
          selected: component.id === selectedId,
          focusable: true,
          ariaLabel: `${component.name}, ${component.id === selectedId ? 'selected component' : types}${component.inferred ? ', inferred component' : ''}`,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          className: component.id === selectedId ? 'workspace-node-selected' : '',
          style: { width: 220, height: description ? 118 : 96, borderRadius: 9 },
          data: {
            label: (
              <div className="mentor-map-component">
                <div className="workspace-node-name">
                  <Code2 size={14} />
                  <strong title={component.name}>
                    {component.role === 'module' ? component.name.split('/').pop() : component.name}
                  </strong>
                </div>
                <span className="workspace-node-file" title={ref?.file}>
                  {ref?.file.split('/').pop() || 'Source unavailable'}
                </span>
                <small title={types}>
                  {component.id === selectedId ? 'Selected component' : types}
                  {component.inferred ? ' / inferred' : ''}
                </small>
                {description && (
                  <span className="workspace-node-description" title={description}>
                    {description}
                  </span>
                )}
              </div>
            ),
          },
        };
      });
    const pairs = new Map<string, Edge>();
    for (const edge of connected.filter(
      (edge) => visible.has(edge.source) && visible.has(edge.target),
    )) {
      const key = `${edge.source}:${edge.target}`;
      const existing = pairs.get(key);
      const label = edge.type.replaceAll('_', ' ');
      if (existing) {
        if (!String(existing.label).split(' / ').includes(label)) existing.label += ' / ' + label;
        continue;
      }
      const outgoing = edge.source === selectedId;
      pairs.set(key, {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: outgoing ? '#7561df' : '#9b8ab6' },
        style: {
          stroke: outgoing ? '#7561df' : '#9b8ab6',
          strokeWidth: 1.5,
          strokeDasharray: refs.has(edge.referenceId) ? undefined : '4 4',
        },
        labelStyle: { fill: '#625b72', fontSize: 11 },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.95 },
      });
    }
    return { nodes, edges: [...pairs.values()], total: neighbors.length };
  }, [snapshot, selectedId, refs]);

  useEffect(() => {
    if (!root.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void instance.current?.fitView({ padding: 0.14, minZoom: 0.8, maxZoom: 1 });
      }, 100);
    });
    observer.observe(root.current);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [selectedId]);

  return (
    <>
      <div
        ref={root}
        className="mentor-connection-map"
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          const node = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node');
          if (node?.dataset.id) {
            event.preventDefault();
            onSelect(node.dataset.id);
          }
        }}
      >
        <ReactFlow
          key={selectedId}
          nodes={nodes}
          edges={edges}
          onInit={(flow) => {
            instance.current = flow;
          }}
          fitView
          fitViewOptions={{ padding: 0.14, minZoom: 0.8, maxZoom: 1 }}
          onNodeClick={(_, node) => onSelect(node.id)}
          nodesDraggable={false}
          minZoom={0.15}
          maxZoom={1.8}
        >
          <Background gap={22} color="#e9e5f2" />
          <Controls
            showInteractive={false}
            fitViewOptions={{ padding: 0.14, minZoom: 0.15, maxZoom: 1 }}
          />
          <Panel position="top-right">
            <button
              className="workspace-graph-focus"
              aria-label="Focus selected component"
              title="Focus selected component"
              onClick={() => {
                void instance.current?.fitView({
                  nodes: [{ id: selectedId }],
                  minZoom: 0.9,
                  maxZoom: 1,
                });
              }}
            >
              <Crosshair size={16} />
            </button>
          </Panel>
        </ReactFlow>
      </div>
      {total > 24 && (
        <p className="workspace-graph-limit">
          Showing 24 nearby components. Use the explorer to navigate further.
        </p>
      )}
    </>
  );
}
