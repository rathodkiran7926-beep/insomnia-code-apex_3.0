import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, Handle, Position, ReactFlow, MarkerType } from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import { clearConnections, clearEdgeTypes, withConnectionBounds } from './GraphConnections';
import { directedLayout } from '../domain/graphLayout';
import { ArrowRight, ChevronRight, Code2, GitBranch, Network, Search, Server } from 'lucide-react';
import {
  architectureLayers,
  architectureRelationLabels,
  backendArchitecture,
  requestArchitecture,
} from '../domain/backendArchitecture';
import type { ArchitectureSnapshot } from '../domain/backendArchitecture';
import '../styles/backend-architecture.css';

function SystemNode({
  data,
}: {
  data: {
    title: string;
    subtitle: string;
    count?: number;
    examples?: string;
    color: string;
    inferred?: boolean;
  };
}) {
  return (
    <div
      className={`system-architecture-node ${data.count === undefined ? 'system-component-node' : ''} ${data.inferred ? 'system-inferred' : ''}`}
      style={{ borderTopColor: data.color }}
    >
      <Handle type="target" position={Position.Left} />
      <span className="system-node-icon" style={{ background: data.color }}>
        <Server size={18} />
      </span>
      <strong title={data.title}>{data.title}</strong>
      <span>{data.subtitle}</span>
      {data.count !== undefined && (
        <b>
          {data.count.toLocaleString()} <small>components</small>
        </b>
      )}
      {data.examples && <p>{data.examples}</p>}
      <small className="system-node-action">
        {data.count !== undefined ? 'Explore this section' : 'Inspect source'}{' '}
        <ChevronRight size={12} />
      </small>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { system: SystemNode };
export function BackendArchitecture({
  snapshot,
  mode,
  onInspect,
  onModeChange,
}: {
  snapshot: ArchitectureSnapshot;
  mode: 'system' | 'request' | 'services';
  onInspect: (id: string) => void;
  onModeChange: (mode: string) => void;
}) {
  const backend = useMemo(() => backendArchitecture(snapshot), [snapshot]);
  const canvas = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(1100);
  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver(([entry]) => setCanvasWidth(entry.contentRect.width));
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [mode, backend]);
  const routes = backend.components.filter((c) => c.role === 'route');
  const [route, setRoute] = useState(routes[0]?.id || '');
  const [section, setSection] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(12);
  useEffect(() => {
    setSection('');
    setQuery('');
    setLimit(12);
  }, [mode]);
  const refs = new Map(snapshot.references.map((r) => [r.id, r]));
  const graph = useMemo(() => {
    const nodes: Node[] = [],
      edges: Edge[] = [];
    if (mode === 'request') {
      const detail = requestArchitecture(snapshot, route);
      const layout = directedLayout(
        detail.components.map((c) => c.id),
        detail.relationships,
        { width: 260, height: 210, gapX: 170, gapY: 65, maxRows: 5 },
      );
      for (const c of detail.components) {
        const layer = architectureLayers.find((l) =>
          (l.roles as readonly string[]).includes(c.role),
        );
        nodes.push({
          id: c.id,
          type: 'system',
          position: layout.positions.get(c.id)!,
          data: {
            title: c.name,
            subtitle: c.role.replaceAll('_', ' ') + (c.inferred ? ' · inferred' : ''),
            color: layer?.color || '#e9eaf3',
            inferred: c.inferred,
          },
          style: { width: 260 },
        });
      }
      for (const e of detail.relationships)
        edges.push({
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'smoothstep',
          label: architectureRelationLabels[e.type] || e.type,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#9b94b6' },
          style: { stroke: '#a29bb8' },
        });
      const routed = clearConnections(edges, nodes);
      return { nodes: withConnectionBounds(nodes, routed), edges: routed, total: detail.total };
    }
    const layers = backend.layers.filter(
      (l) =>
        l.components.length &&
        (mode !== 'services' || ['handlers', 'services', 'database'].includes(l.id)),
    );
    const cardWidth = Math.max(
      160,
      Math.min(
        260,
        (canvasWidth - 40 - Math.max(0, layers.length - 1) * 110) / Math.max(1, layers.length),
      ),
    );
    layers.forEach((l, i) =>
      nodes.push({
        id: `layer:${l.id}`,
        type: 'system',
        position: { x: i * (cardWidth + 110), y: 90 },
        data: {
          title: l.name,
          subtitle: l.description,
          count: l.components.length,
          examples: l.components
            .slice(0, 2)
            .map((c) => c.name)
            .join(' · '),
          color: l.color,
          inferred: l.id === 'services',
        },
        style: { width: cardWidth },
      }),
    );
    const ids = new Set(layers.map((l) => l.id));
    for (const e of backend.aggregated.filter(
      (e) =>
        ids.has(e.source as (typeof layers)[number]['id']) &&
        ids.has(e.target as (typeof layers)[number]['id']),
    ))
      edges.push({
        id: e.id,
        source: `layer:${e.source}`,
        target: `layer:${e.target}`,
        type: 'architectureLink',
        data: {
          detour:
            Math.abs(
              layers.findIndex((l) => l.id === e.source) -
                layers.findIndex((l) => l.id === e.target),
            ) > 1,
          lane: backend.aggregated.indexOf(e) % 3,
        },
        label: e.types.map((t) => architectureRelationLabels[t] || t).join(' / '),
        markerEnd: { type: MarkerType.ArrowClosed, color: '#9b94b6' },
        style: { stroke: '#a29bb8' },
      });
    const routed = clearConnections(edges, nodes);
    return {
      nodes: withConnectionBounds(nodes, routed),
      edges: routed,
      total: backend.components.length,
    };
  }, [snapshot, backend, mode, route, canvasWidth]);
  const focused = backend.layers.find((l) => l.id === section);
  const catalog = (
    focused?.components ||
    (mode === 'services'
      ? backend.layers
          .filter((l) => ['services', 'database'].includes(l.id))
          .flatMap((l) => l.components)
      : routes)
  ).filter((c) =>
    `${c.name} ${refs.get(c.referenceId)?.file}`.toLowerCase().includes(query.toLowerCase()),
  );
  const missing = backend.layers.filter((l) => !l.components.length).map((l) => l.name);
  return (
    <section className="backend-system-view">
      <div className="system-intro">
        <span className="analysis-kicker">
          <Network size={13} /> BACKEND ARCHITECTURE
        </span>
        <h2>
          {mode === 'request'
            ? 'Follow one request through the code'
            : mode === 'services'
              ? 'Business logic & database connections'
              : 'Your backend, from left to right'}
        </h2>
        <p>
          {mode === 'system'
            ? 'Start with the complete source-backed backend map. Each card groups a part of the application. Select a card to explore its components.'
            : mode === 'request'
              ? 'Choose a route to see only its registered handler, connected calls and resolvable application mounts.'
              : 'A focused view of handlers, inferred services, supporting functions and supported database operations.'}
        </p>
      </div>
      {mode === 'request' && (
        <label className="system-route-selector">
          <GitBranch size={16} />
          <span>Choose an HTTP route</span>
          <select
            aria-label="Choose request route"
            value={route}
            onChange={(e) => {
              setRoute(e.target.value);
              setSection('');
            }}
          >
            {routes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.fullPaths?.length ? ` · ${c.fullPaths.join(', ')}` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {graph.nodes.length ? (
        <>
          <div className="system-map-caption">
            <span>
              <i />
              Source-backed connections
            </span>
            <span>Arrows show code relationships, not runtime order</span>
          </div>
          <div className="system-architecture-canvas" ref={canvas}>
            <ReactFlow
              key={`${mode}:${route}:${Math.round(canvasWidth / 50)}`}
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              edgeTypes={clearEdgeTypes}
              fitView
              fitViewOptions={{ padding: 0.04, maxZoom: 1 }}
              minZoom={0.25}
              maxZoom={1.8}
              nodesDraggable={false}
              onNodeClick={(_event, node) => {
                if (node.id.startsWith('layer:')) {
                  setSection(node.id.slice(6));
                  setQuery('');
                  setLimit(12);
                } else onInspect(node.id);
              }}
            >
              <Background gap={22} color="#e5e5f0" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </>
      ) : (
        <div className="system-no-results">
          <Network size={28} />
          <h3>
            No supported {mode === 'request' ? 'request connections' : 'backend architecture'}{' '}
            identified
          </h3>
          <p>
            We could not build this view from the available Express evidence. Source files and
            unresolved patterns are still available.
          </p>
          <button onClick={() => onModeChange('overview')}>
            Explore source folders <ArrowRight size={14} />
          </button>
        </div>
      )}
      <div className="system-coverage">
        <Code2 size={15} />
        <p>
          {mode === 'request' && graph.total > 40
            ? `Showing 40 of ${graph.total} connected components. Narrow the selection using the source map. `
            : ''}
          {mode === 'request'
            ? 'Middleware is shown only for matching recorded mount paths; registration order and runtime execution are not verified. '
            : ''}
          {missing.length ? `Not identified: ${missing.join(', ')}. ` : ''}Missing layers are not
          invented. {backend.unconnectedCount.toLocaleString()} other declarations are available in
          Source folders.
        </p>
      </div>
      <div className="system-explorer">
        <div className="system-explorer-heading">
          <div>
            <h3>
              {focused
                ? focused.name
                : mode === 'services'
                  ? 'Services and connected logic'
                  : 'Explore an API route'}
            </h3>
            <p>
              {focused
                ? 'Choose a component to read its code in the source map.'
                : 'Select a route to open its smaller request diagram.'}
            </p>
          </div>
          <label>
            <Search size={14} />
            <input
              aria-label="Search backend components"
              placeholder="Search this section…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(12);
              }}
            />
          </label>
        </div>
        <div className="system-component-list">
          {catalog.slice(0, limit).map((c) => (
            <button
              key={c.id}
              onClick={() => {
                if (c.role === 'route') {
                  setRoute(c.id);
                  setSection('');
                  onModeChange('request');
                } else onInspect(c.id);
              }}
            >
              <span className="system-component-role">{c.role.replaceAll('_', ' ')}</span>
              <strong>{c.name}</strong>
              <small>{refs.get(c.referenceId)?.file}</small>
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
        {!catalog.length && (
          <p className="system-catalog-empty">
            {section
              ? 'No matching components in this section. Select another card.'
              : 'No API routes identified. Select a section in the diagram to explore its source.'}
          </p>
        )}
        {catalog.length > limit && (
          <button className="system-show-more" onClick={() => setLimit((v) => v + 20)}>
            Show more ({catalog.length - limit} remaining)
          </button>
        )}
      </div>
    </section>
  );
}
