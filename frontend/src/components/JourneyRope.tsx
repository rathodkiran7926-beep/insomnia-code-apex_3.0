import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import type { CodeJourney, JourneyTrace, Playback } from '../domain/codeJourney';

type StopData = {
  label: string;
  caption: string;
  index?: number;
  scenarioId?: string;
  current?: boolean;
  visited?: boolean;
};
type StopNode = Node<StopData, 'journeyStop'>;
function JourneyStop({ data }: NodeProps<StopNode>) {
  return (
    <div
      className={`journey-canvas-stop ${data.current ? 'is-current' : ''} ${data.visited ? 'is-visited' : ''} ${data.scenarioId ? 'is-alternative' : ''}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="journey-canvas-step" aria-hidden="true">
        {data.current ? (
          <span className="journey-canvas-dot" />
        ) : data.index !== undefined ? (
          data.index + 1
        ) : (
          '↗'
        )}
      </span>
      <div>
        <small>{data.caption}</small>
        <strong>{data.label}</strong>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
const nodeTypes = { journeyStop: JourneyStop };
export function JourneyRope({
  journey,
  trace,
  playback,
  onJump,
  onChoose,
  drawerOpen = false,
}: {
  journey: CodeJourney;
  trace: JourneyTrace;
  playback: Playback;
  onJump: (index: number) => void;
  onChoose: (scenario: string) => void;
  drawerOpen?: boolean;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [instance, setInstance] = useState<ReactFlowInstance<StopNode, Edge> | null>(null);
  const graph = useMemo(() => {
    const current = journey.scenarios.find((s) => s.id === trace.scenarioId)!;
    const alternatives =
      trace.mode === 'observed_replay' ? [] : journey.scenarios.filter((s) => s.id !== current.id);
    const nodes: StopNode[] = trace.events.map((event, index) => ({
      id: event.id,
      type: 'journeyStop',
      position: { x: index * 280, y: 0 },
      data: {
        label: event.title,
        caption: 'Playback event',
        index,
        current: index === playback.index,
        visited: playback.visited.includes(event.id),
      },
      ariaLabel: `${event.title}${index === playback.index ? ', current event' : ''}`,
    }));
    const edges: Edge[] = trace.events.slice(1).map((event, index) => ({
      id: `path-${event.id}`,
      source: trace.events[index].id,
      target: event.id,
      type: 'smoothstep',
      style: { stroke: index < playback.index ? 'var(--primary)' : '#c9bde7', strokeWidth: 3 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: index < playback.index ? '#6554df' : '#c9bde7',
      },
    }));
    alternatives.forEach((scenario, index) => {
      let shared = 0;
      while (
        shared < Math.min(scenario.path.length, current.path.length) &&
        scenario.path[shared] === current.path[shared]
      )
        shared++;
      const fork = Math.min(trace.events.length - 1, Math.max(0, shared - 1));
      const id = `alternative-${scenario.id}`;
      nodes.push({
        id,
        type: 'journeyStop',
        position: { x: (fork + 1) * 280, y: 150 + index * 120 },
        data: {
          label: scenario.label,
          caption: 'Alternate explained path',
          scenarioId: scenario.id,
        },
        ariaLabel: `Choose explained path: ${scenario.label}`,
      });
      edges.push({
        id: `fork-${scenario.id}`,
        source: trace.events[fork].id,
        target: id,
        type: 'smoothstep',
        style: { stroke: '#c9bde7', strokeDasharray: '6 5', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#c9bde7' },
      });
    });
    return { nodes, edges };
  }, [journey, trace, playback.index, playback.visited]);
  const [nodes, setNodes, onNodesChange] = useNodesState<StopNode>(graph.nodes);
  useEffect(() => {
    // Playback updates evidence styling, while the learner's dragged positions stay put.
    setNodes((previous) =>
      graph.nodes.map((node) => ({
        ...node,
        position: previous.find((old) => old.id === node.id)?.position || node.position,
      })),
    );
  }, [graph.nodes, setNodes]);
  useEffect(() => {
    if (!instance || !canvas.current) return;
    const ensureVisible = () => {
      const element = canvas.current;
      if (!element) return;
      const node = instance.getNode(trace.events[playback.index].id);
      if (!node) return;
      const rect = element.getBoundingClientRect();
      const point = instance.flowToScreenPosition(node.position);
      const zoom = instance.getZoom();
      if (
        point.x < rect.left + 20 ||
        point.x + 220 * zoom > rect.right - 20 ||
        point.y < rect.top + 35 ||
        point.y + 90 * zoom > rect.bottom - 35
      )
        void instance.setCenter(node.position.x + 110, node.position.y + 45, {
          zoom: Math.min(zoom, 1),
          duration: 0,
        });
    };
    const frame = requestAnimationFrame(ensureVisible);
    const observer = new ResizeObserver(ensureVisible);
    observer.observe(canvas.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [instance, playback.index, trace.id, drawerOpen]);
  return (
    <div
      className="journey-rope journey-canvas"
      ref={canvas}
      role="region"
      aria-label="Branchable journey timeline"
    >
      <ReactFlow<StopNode, Edge>
        onInit={setInstance}
        nodes={nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_event, node) => {
          if (node.data.scenarioId) onChoose(node.data.scenarioId);
          else if (node.data.index !== undefined) onJump(node.data.index);
        }}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable={false}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick
        minZoom={0.2}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
        ariaLabelConfig={{
          'controls.zoomIn.ariaLabel': 'Zoom in journey',
          'controls.zoomOut.ariaLabel': 'Zoom out journey',
          'controls.fitView.ariaLabel': 'Fit journey to view',
        }}
      >
        <Background gap={20} size={1} color="#e0d9f2" />
        <Controls showInteractive={false} position="bottom-left" />
        <Panel position="top-left" className="journey-canvas-hint">
          Drag to move · Scroll to zoom
        </Panel>
      </ReactFlow>
    </div>
  );
}
