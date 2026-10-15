import { memo, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Database,
  Globe2,
  KeyRound,
  Layers3,
  List,
  Mail,
  Maximize2,
  Route,
  Search,
  ShieldCheck,
  Waypoints,
  X,
} from 'lucide-react';
import { graphNodes, graphRelations } from '../data/fixtures';
import type { GraphNode, GraphRelation } from '../data/types';
import { getJourneySteps } from '../domain/model';
import { useWorkspace } from '../state/WorkspaceContext';
import { Badge, Button, IconButton, SourceLink } from './UI';

const icons = {
  globe: Globe2,
  route: Route,
  shield: ShieldCheck,
  layers: Layers3,
  key: KeyRound,
  database: Database,
  mail: Mail,
  box: Box,
};
type AtlasNode = Node<
  {
    info: GraphNode;
    active: boolean;
    onPath: boolean;
    label: string;
    upcoming: boolean;
    functions: boolean;
  },
  'atlas'
>;
const ArchitectureNode = memo(function ArchitectureNode({ data }: NodeProps<AtlasNode>) {
  const Icon = icons[data.info.icon];
  return (
    <div
      className={`architecture-node category-${data.info.category} ${data.active ? 'node-active' : ''} ${data.onPath ? 'node-on-path' : ''} ${data.upcoming ? 'node-upcoming' : ''}`}
    >
      <Handle type="target" position={Position.Left} id="in-left" />
      <Handle type="target" position={Position.Top} id="in-top" />
      <Handle type="target" position={Position.Right} id="in-right" />
      <div className="node-content">
        <span className="node-icon">
          <Icon size={19} strokeWidth={1.7} />
        </span>
        <div>
          <strong className={data.functions ? 'node-function' : ''}>{data.label}</strong>
          <span>{data.upcoming ? 'PR #42 · not in base' : data.info.subtitle}</span>
        </div>
      </div>
      <div className="node-bottom">
        <span>
          {data.info.category === 'external' || data.info.id === 'client'
            ? 'External boundary'
            : data.info.category === 'storage'
              ? 'Data layer'
              : data.info.category === 'interface'
                ? 'Request layer'
                : 'Application layer'}
        </span>
        <span className={`node-status ${data.active ? 'active' : ''}`}>
          {data.active ? 'Selected' : data.info.source ? 'Source-linked' : 'Conceptual'}
        </span>
      </div>
      <Handle type="source" position={Position.Right} id="out-right" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" />
      <Handle type="source" position={Position.Left} id="out-left" />
    </div>
  );
});
const nodeTypes = { atlas: ArchitectureNode };
const functionLabels: Record<string, string> = {
  client: 'POST /api/auth',
  router: 'authRouter.post()',
  validation: 'validateSignup()',
  'user-service': 'userService.signup()',
  tokens: 'tokens.sign()',
  repository: 'users.create()',
  database: 'PrismaClient',
  email: 'verification.send()',
};

export function Atlas() {
  const { state, selectNode } = useWorkspace();
  const [scope, setScope] = useState<'system' | 'components' | 'functions'>('components');
  const [focused, setFocused] = useState(false);
  const [query, setQuery] = useState('');
  const [presentation, setPresentation] = useState<'map' | 'list'>(() =>
    window.matchMedia('(max-width: 620px)').matches ? 'list' : 'map',
  );
  useEffect(() => {
    const media = window.matchMedia('(max-width: 620px)');
    const change = () => setPresentation(media.matches ? 'list' : 'map');
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const [instance, setInstance] = useState<ReactFlowInstance<AtlasNode, Edge> | null>(null);
  const [edge, setEdge] = useState<GraphRelation | null>(null);
  const activeSteps = state.journeyId
    ? getJourneySteps(state.journeyId, state.scenario, state.snapshot)
    : [];
  const activeIds = activeSteps.map((x) => x.nodeId);
  const { nodes, edges } = useMemo(() => {
    const systemIds = ['client', 'router', 'user-service', 'database', 'email'];
    const visible = graphNodes.filter(
      (n) =>
        (scope !== 'system' || systemIds.includes(n.id)) &&
        (!focused ||
          (activeIds.length
            ? activeIds.includes(n.id)
            : ['router', 'validation', 'user-service', 'repository', 'database'].includes(n.id))),
    );
    const visibleIds = new Set(visible.map((n) => n.id));
    const nodeList: AtlasNode[] = visible.map((info) => ({
      id: info.id,
      type: 'atlas',
      position: info.position,
      selectable: true,
      draggable: false,
      ariaLabel: `${info.label}: ${info.description}`,
      data: {
        info,
        active: state.selectedNode === info.id,
        onPath: activeIds.includes(info.id),
        label: scope === 'functions' ? functionLabels[info.id] : info.label,
        upcoming: info.id === 'email' && state.snapshot === 'base',
        functions: scope === 'functions',
      },
    }));
    let relations = graphRelations
      .filter((r) => !r.headOnly || state.snapshot === 'head')
      .map((r) =>
        r.id === 'service-token' && state.snapshot === 'head'
          ? { ...r, source: { path: 'src/services/user.service.ts', start: 26, end: 34 } }
          : r,
      );
    if (scope === 'system')
      relations = [
        ...relations,
        {
          id: 'group-controller',
          from: 'router',
          to: 'user-service',
          label: 'via validation',
          kind: 'Grouped path',
          status: 'supported',
          source: { path: 'src/controllers/auth.controller.ts', start: 5, end: 8 },
        },
        {
          id: 'group-data',
          from: 'user-service',
          to: 'database',
          label: 'via repository',
          kind: 'Grouped data dependency',
          status: 'inferred',
          source: { path: 'src/repositories/user.repository.ts', start: 3, end: 10 },
        },
      ];
    const edgeList: Edge[] = relations
      .filter((r) => visibleIds.has(r.from) && visibleIds.has(r.to))
      .map((r) => {
        const from = visible.find((n) => n.id === r.from)!;
        const to = visible.find((n) => n.id === r.to)!;
        const vertical = to.position.y > from.position.y;
        const backwards = to.position.x < from.position.x && !vertical;
        const active = activeIds.includes(r.from) && activeIds.includes(r.to);
        const selected = edge?.id === r.id;
        const color =
          selected || active ? '#7772e0' : r.status === 'unresolved' ? '#b59a69' : '#bac2cf';
        return {
          id: r.id,
          source: r.from,
          target: r.to,
          sourceHandle: vertical ? 'out-bottom' : backwards ? 'out-left' : 'out-right',
          targetHandle: vertical ? 'in-top' : backwards ? 'in-right' : 'in-left',
          type: 'smoothstep',
          label: r.label,
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 15, height: 15 },
          style: {
            stroke: color,
            strokeWidth: selected || active ? 2 : 1.4,
            strokeDasharray:
              r.status === 'supported' ? undefined : r.status === 'inferred' ? '5 4' : '2 5',
          },
          labelStyle: { fontFamily: 'Geist', fill: '#657186', fontSize: 11, fontWeight: 450 },
          labelBgStyle: { fill: '#fcfdff', fillOpacity: 0.97 },
          labelBgPadding: [4, 5] as [number, number],
          data: { relation: r },
          ariaLabel: `${from.label} to ${to.label}: ${r.kind}, ${r.status}`,
          interactionWidth: 24,
        };
      });
    return { nodes: nodeList, edges: edgeList };
    // activeIds is derived from the versioned journey, and changes with its context.
  }, [
    scope,
    focused,
    state.snapshot,
    state.selectedNode,
    state.journeyId,
    state.scenario,
    edge?.id,
  ]);
  function focusSearch(value: string) {
    setQuery(value);
    const match = nodes.find((n) =>
      `${n.data.info.label} ${n.data.info.subtitle}`.toLowerCase().includes(value.toLowerCase()),
    );
    if (value && match) {
      selectNode(match.id);
      instance?.fitView({ nodes: [{ id: match.id }], padding: 1, duration: 200, maxZoom: 1.1 });
    }
  }
  return (
    <section className="panel atlas-panel">
      <div className="atlas-toolbar">
        <div className="row gap-8">
          <Waypoints size={16} className="violet-text" />
          <h2>Architecture atlas</h2>
          <Badge>{nodes.length} components</Badge>
        </div>
        <div className="row gap-8">
          <label className="scope-select">
            <select
              aria-label="Architecture detail level"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as typeof scope);
                setTimeout(() => instance?.fitView({ padding: 0.18, duration: 200 }), 50);
              }}
            >
              <option value="system">System overview</option>
              <option value="components">Component view</option>
              <option value="functions">Function view</option>
            </select>
            <ChevronDown size={12} />
          </label>
          <IconButton
            icon={Maximize2}
            label="Fit architecture to view"
            onClick={() => instance?.fitView({ padding: 0.16, duration: 200 })}
          />
        </div>
      </div>
      <div className="atlas-mobile-controls">
        <button
          className={presentation === 'list' ? 'active' : ''}
          onClick={() => setPresentation('list')}
        >
          <List size={13} />
          Components
        </button>
        <button
          className={presentation === 'map' ? 'active' : ''}
          onClick={() => setPresentation('map')}
        >
          <Waypoints size={13} />
          Interactive map
        </button>
      </div>
      {presentation === 'list' && (
        <div className="atlas-text-list">
          {nodes.map((item) => {
            const Icon = icons[item.data.info.icon];
            return (
              <button
                className={item.data.active ? 'selected' : ''}
                key={item.id}
                onClick={() => selectNode(item.id)}
              >
                <span className={`list-node-icon category-${item.data.info.category}`}>
                  <Icon size={18} />
                </span>
                <span>
                  <strong>{item.data.label}</strong>
                  <small>
                    {item.data.upcoming ? 'PR #42 · not in base' : item.data.info.subtitle}
                  </small>
                </span>
                <Badge tone={item.data.active ? 'violet' : 'neutral'}>
                  {item.data.active ? 'Selected' : item.data.info.source ? 'Source' : 'Boundary'}
                </Badge>
                <ChevronRight size={12} />
              </button>
            );
          })}
        </div>
      )}
      <div
        className="atlas-canvas"
        style={presentation === 'list' ? { display: 'none' } : undefined}
      >
        <ReactFlow<AtlasNode, Edge>
          key={`${scope}:${focused}:${presentation}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={setInstance}
          onNodeClick={(_, node) => {
            selectNode(node.id);
            setEdge(null);
          }}
          onEdgeClick={(_, item) => setEdge(item.data?.relation as GraphRelation)}
          onPaneClick={() => setEdge(null)}
          fitView
          fitViewOptions={{ padding: 0.12, minZoom: 0.4, maxZoom: 0.96 }}
          minZoom={0.3}
          maxZoom={1.8}
          nodesConnectable={false}
          nodesDraggable={false}
          elementsSelectable
          zoomOnDoubleClick={false}
          panOnScroll={false}
          deleteKeyCode={null}
          selectionOnDrag={false}
          aria-label="Interactive architecture atlas"
          defaultEdgeOptions={{ focusable: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#dce1ed" />
          <Controls position="bottom-left" showInteractive={false} />
        </ReactFlow>
        <div className="atlas-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(e) => focusSearch(e.target.value)}
            placeholder="Find a component..."
            aria-label="Find architecture component"
          />
          {query && (
            <button
              aria-label="Clear graph search"
              onClick={() => {
                setQuery('');
                instance?.fitView({ padding: 0.17 });
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
        {query &&
          !nodes.some((n) =>
            `${n.data.info.label} ${n.data.info.subtitle}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          ) && <div className="graph-no-match">No component matches “{query}”.</div>}
        <button
          className={`graph-focus ${focused ? 'active' : ''}`}
          onClick={() => setFocused((x) => !x)}
        >
          <Crosshair size={13} />
          {focused ? 'Show full system' : state.journeyId ? 'Focus journey' : 'Focus signup'}
        </button>
        {edge && (
          <div className="edge-inspector">
            <div className="row between">
              <strong>{edge.kind}</strong>
              <IconButton
                icon={X}
                label="Close relationship details"
                onClick={() => setEdge(null)}
              />
            </div>
            <div className="row gap-8">
              <Badge tone={edge.status === 'supported' ? 'green' : 'amber'}>{edge.status}</Badge>
              <span>{edge.label}</span>
            </div>
            <p>
              {edge.status === 'supported'
                ? 'Linked to prepared source. This relationship describes the sample code, not an executed call.'
                : edge.status === 'inferred'
                  ? 'A conceptual or grouped connection. It is not a resolved function call.'
                  : 'The source delegates to this external boundary. Delivery and execution remain unverified.'}
            </p>
            {edge.source && <SourceLink source={edge.source} />}
          </div>
        )}
        {!state.journeyId && !edge && (
          <div className="atlas-tip">
            <span className="tiny-dot" /> Click a component. Follow the connection.
          </div>
        )}
      </div>
      <div className="atlas-footer">
        <div className="graph-legend">
          <span>
            <i className="legend-line" />
            Source-linked
          </span>
          <span>
            <i className="legend-line dashed" />
            Inferred
          </span>
          <span>
            <i className="legend-line dotted" />
            Unresolved
          </span>
        </div>
        <span className="graph-footnote">Source map · not a runtime trace</span>
      </div>
      <div className="sr-only">
        <Button onClick={() => setScope('functions')}>Show function details</Button>
      </div>
    </section>
  );
}
