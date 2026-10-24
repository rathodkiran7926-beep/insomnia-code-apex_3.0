import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react';
import type { Edge, EdgeProps, Node } from '@xyflow/react';
import '../styles/graph-connections.css';

function ClearConnection({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
  data,
  selected,
}: EdgeProps) {
  const detour = Boolean(data?.detour);
  const lane = Number(data?.lane || 0);
  const laneY = Number(data?.laneY ?? -50 - lane * 34);
  const exit = 20 + (lane % 4) * 9;
  const [smooth, x, y] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
    offset: 24,
  });
  const path = detour
    ? `M ${sourceX},${sourceY} L ${sourceX + exit},${sourceY} L ${sourceX + exit},${laneY} L ${targetX - exit},${laneY} L ${targetX - exit},${targetY} L ${targetX},${targetY}`
    : smooth;
  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        style={{ ...style, strokeWidth: selected ? 2 : 1.3 }}
        interactionWidth={18}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="clear-connection-label"
            style={{
              transform: `translate(-50%, -50%) translate(${detour ? (sourceX + targetX) / 2 : x}px, ${detour ? laneY : y}px)`,
            }}
            title={String(data?.description || label)}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
export const clearEdgeTypes = { clear: ClearConnection };
export function withConnectionBounds(nodes: Node[], edges: Edge[]): Node[] {
  const lanes = edges.filter((e) => e.data?.detour).map((e) => Number(e.data?.laneY));
  if (!lanes.length) return nodes;
  return [
    ...nodes,
    {
      id: '__connection-bounds__',
      position: { x: 0, y: Math.min(...lanes) - 24 },
      data: { label: '' },
      style: { width: 1, height: 1, opacity: 0, pointerEvents: 'none' },
      selectable: false,
      focusable: false,
      draggable: false,
    },
  ];
}
// Parallel relationships share one visual arrow; their labels and evidence remain available.
export function clearConnections(edges: Edge[], nodes: Node[]): Edge[] {
  const positions = new Map(
    nodes.map((n) => {
      const parent = nodes.find((p) => p.id === n.parentId);
      return [
        n.id,
        {
          x: n.position.x + (parent?.position.x || 0),
          y: n.position.y + (parent?.position.y || 0),
          width: Number(n.style?.width || 250),
        },
      ] as const;
    }),
  );
  const pairs = new Map<string, Edge & { labels: string[]; evidenceIds: string[] }>();
  for (const edge of edges) {
    if (!positions.has(edge.source) || !positions.has(edge.target)) continue;
    const key = `${edge.source}|${edge.target}`;
    const existing = pairs.get(key);
    const label = String(edge.label || 'connected');
    if (existing) {
      if (!existing.labels.includes(label)) existing.labels.push(label);
      existing.evidenceIds.push(edge.id);
    } else pairs.set(key, { ...edge, labels: [label], evidenceIds: [edge.id] });
  }
  const top = Math.min(0, ...[...positions.values()].map((p) => p.y));
  let lane = 0;
  return [...pairs.values()].map(({ labels, evidenceIds, ...edge }) => {
    const from = positions.get(edge.source)!,
      to = positions.get(edge.target)!;
    const gap = to.x - from.x - from.width;
    const detour = gap < 50 || gap > 230;
    const slot = detour ? lane++ : 0;
    return {
      ...edge,
      type: 'clear',
      label: labels.join(' · '),
      data: {
        ...edge.data,
        detour,
        lane: slot,
        laneY: top - 45 - slot * 34,
        evidenceIds,
        description: labels.join(' · '),
      },
      labelStyle: undefined,
    };
  });
}
