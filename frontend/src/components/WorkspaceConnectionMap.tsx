import { useEffect, useMemo, useRef } from 'react';
import { Background, Controls, MarkerType, Panel, Position, ReactFlow } from '@xyflow/react';
import type { Node, Edge, ReactFlowInstance } from '@xyflow/react';
import { Crosshair, Code2 } from 'lucide-react';
import type { RepositorySnapshot } from '../domain/analysisTypes';
import type { ArchitectureSnapshot } from '../domain/backendArchitecture';
import { workspaceGraphPositions } from '../domain/workspaceGraph';

type ImpactMapState = {
  targetId: string;
  affected: { id: string; minDepth: number }[];
  evidencePathIds: string[];
  focusedId: string | null;
  activation: number;
  fitToken: number;
};

export function WorkspaceConnectionMap({
  selectedId,
  snapshot,
  onSelect,
  impact,
}: {
  selectedId: string;
  snapshot: ArchitectureSnapshot & { documentation?: RepositorySnapshot['documentation'] };
  onSelect: (id: string) => void;
  impact?: ImpactMapState;
}) {
  const root = useRef<HTMLDivElement>(null);
  const instance = useRef<ReactFlowInstance | null>(null);
  const refs = useMemo(() => new Map(snapshot.references.map((ref) => [ref.id, ref])), [snapshot]);
  const pivotId = impact?.targetId || selectedId;
  const affected = useMemo(
    () => new Map((impact?.affected || []).map((item) => [item.id, item.minDepth])),
    [impact?.affected],
  );
  const evidencePathIds = useMemo(
    () => new Set(impact?.evidencePathIds || []),
    [impact?.evidencePathIds],
  );

  const { nodes, edges, total } = useMemo(() => {
    const connected = snapshot.relationships.filter(
      (edge) => edge.source === pivotId || edge.target === pivotId,
    );
    const known = new Set(snapshot.components.map((component) => component.id));
    const neighbors = [...new Set(connected.flatMap((edge) => [edge.source, edge.target]))].filter(
      (id) => id !== pivotId && known.has(id),
    );
    const impactIds = [...affected.keys()].slice(0, 30);
    const pathEdges = snapshot.relationships.filter((edge) => evidencePathIds.has(edge.id));
    const visible = new Set([
      pivotId,
      ...neighbors.slice(0, 24),
      ...impactIds,
      ...pathEdges.flatMap((edge) => [edge.source, edge.target]),
    ]);
    const positions = workspaceGraphPositions(
      pivotId,
      connected
        .filter((edge) => edge.target === pivotId && visible.has(edge.source))
        .map((edge) => edge.source),
      connected
        .filter((edge) => edge.source === pivotId && visible.has(edge.target))
        .map((edge) => edge.target),
    );
    const indirect = impactIds.filter((id) => (affected.get(id) || 0) > 1);
    indirect.forEach((id, index) =>
      positions.set(id, { x: -310, y: (index - (indirect.length - 1) / 2) * 140 }),
    );

    const nodes: Node[] = snapshot.components
      .filter((component) => visible.has(component.id))
      .map((component) => {
        const ref = refs.get(component.referenceId);
        const description = snapshot.documentation?.ai.explanations.find(
          (item) => item.componentId === component.id,
        )?.explanation;
        const connectedTypes = snapshot.relationships
          .filter(
            (edge) =>
              evidencePathIds.has(edge.id) &&
              (edge.source === component.id || edge.target === component.id),
          )
          .map((edge) => edge.type.replaceAll('_', ' '));
        const types = [...new Set(connectedTypes)].join(' / ');
        const depth = affected.get(component.id);
        const isTarget = component.id === pivotId;
        const animateClass = impact?.activation
          ? impact.activation % 2
            ? ' impact-animate-a'
            : ' impact-animate-b'
          : '';
        return {
          id: component.id,
          position: positions.get(component.id) || { x: 310, y: 0 },
          selected: isTarget || component.id === impact?.focusedId,
          focusable: true,
          ariaLabel: `${component.name}, ${isTarget ? 'analysis target' : depth === 1 ? 'direct dependent' : depth ? 'indirect dependent' : types}${component.inferred ? ', inferred component' : ''}`,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          className: `${isTarget ? 'workspace-node-selected' : ''}${depth === 1 ? ' workspace-impact-direct' : depth ? ' workspace-impact-indirect' : ''}${component.id === impact?.focusedId ? ' workspace-impact-focused' : ''}${depth ? animateClass : ''}`,
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
                  {isTarget
                    ? 'Analysis target'
                    : depth === 1
                      ? 'Direct dependent · source path'
                      : depth
                        ? 'Indirect dependent · source path'
                        : types}
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
    for (const edge of snapshot.relationships.filter(
      (item) =>
        visible.has(item.source) &&
        visible.has(item.target) &&
        (item.source === pivotId || item.target === pivotId || evidencePathIds.has(item.id)),
    )) {
      const key = `${edge.source}:${edge.target}`;
      const existing = pairs.get(key);
      const label = edge.type.replaceAll('_', ' ');
      if (existing) {
        if (!String(existing.label).split(' / ').includes(label)) existing.label += ' / ' + label;
        if (evidencePathIds.has(edge.id) && !evidencePathIds.has(String(existing.id))) {
          const directPath = affected.get(edge.source) === 1 || affected.get(edge.target) === 1;
          const stroke = directPath ? '#bd7817' : '#d8ad68';
          existing.id = edge.id;
          existing.className = 'workspace-impact-edge';
          existing.markerEnd = { type: MarkerType.ArrowClosed, color: stroke };
          existing.style = {
            ...existing.style,
            stroke,
            strokeWidth: 2.5,
          };
        }
        continue;
      }
      const highlighted = evidencePathIds.has(edge.id);
      const directPath = affected.get(edge.source) === 1 || affected.get(edge.target) === 1;
      const stroke = highlighted
        ? directPath
          ? '#bd7817'
          : '#d8ad68'
        : edge.source === pivotId
          ? '#7561df'
          : '#9b8ab6';
      pairs.set(key, {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label,
        type: 'smoothstep',
        className: highlighted ? 'workspace-impact-edge' : '',
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        style: {
          stroke,
          strokeWidth: highlighted ? 2.5 : 1.5,
          strokeDasharray: refs.has(edge.referenceId) ? undefined : '4 4',
        },
        labelStyle: { fill: '#625b72', fontSize: 11 },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.95 },
      });
    }
    return { nodes, edges: [...pairs.values()], total: neighbors.length };
  }, [snapshot, pivotId, refs, affected, evidencePathIds, impact]);

  useEffect(() => {
    if (!impact?.fitToken) return;
    void instance.current?.fitView({
      padding: 0.22,
      minZoom: 0.6,
      maxZoom: 1,
      duration: 250,
    });
  }, [impact?.fitToken]);

  useEffect(() => {
    if (!impact?.focusedId) return;
    void instance.current?.fitView({
      nodes: [{ id: impact.focusedId }],
      padding: 0.32,
      minZoom: 0.65,
      maxZoom: 1.2,
      duration: 250,
    });
  }, [impact?.focusedId]);

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
          key={pivotId}
          nodes={nodes}
          edges={edges}
          onInit={(flow) => {
            instance.current = flow;
          }}
          fitView
          fitViewOptions={{ padding: 0.22, minZoom: 0.6, maxZoom: 1 }}
          onNodeClick={(_, node) => onSelect(node.id)}
          nodesDraggable={false}
          minZoom={0.15}
          maxZoom={1.8}
        >
          <Background gap={22} color="#e9e5f2" />
          <Controls
            showInteractive={false}
            fitViewOptions={{ padding: 0.22, minZoom: 0.15, maxZoom: 1 }}
          />
          <Panel position="top-right">
            <button
              className="workspace-graph-focus"
              aria-label="Focus analysis target"
              title="Focus analysis target"
              onClick={() => {
                void instance.current?.fitView({
                  nodes: [{ id: pivotId }],
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
