// Collapse cycles before ranking: every directed edge remains source evidence,
// while recursive calls and mutual imports cannot force an endless layout pass.
export function directedLayout(
  ids: string[],
  edges: { source: string; target: string }[],
  options: { width?: number; height?: number; gapX?: number; gapY?: number; maxRows?: number } = {},
) {
  const { width = 250, height = 120, gapX = 140, gapY = 54, maxRows = 6 } = options;
  const known = new Set(ids);
  const adjacency = new Map(ids.map((id) => [id, [] as string[]]));
  for (const e of edges)
    if (known.has(e.source) && known.has(e.target)) adjacency.get(e.source)!.push(e.target);
  const index = new Map<string, number>(),
    low = new Map<string, number>(),
    stack: string[] = [],
    active = new Set<string>(),
    groups: string[][] = [];
  let next = 0;
  function visit(id: string) {
    index.set(id, next);
    low.set(id, next++);
    stack.push(id);
    active.add(id);
    for (const target of adjacency.get(id)!) {
      if (!index.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (active.has(target)) low.set(id, Math.min(low.get(id)!, index.get(target)!));
    }
    if (low.get(id) === index.get(id)) {
      const group: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        active.delete(member);
        group.push(member);
      } while (member !== id);
      groups.push(group);
    }
  }
  ids.forEach((id) => {
    if (!index.has(id)) visit(id);
  });
  const groupOf = new Map(groups.flatMap((g, i) => g.map((id) => [id, i] as const)));
  const outgoing = groups.map(() => new Set<number>()),
    indegree = groups.map(() => 0),
    rank = groups.map(() => 0);
  for (const e of edges) {
    const a = groupOf.get(e.source),
      b = groupOf.get(e.target);
    if (a !== undefined && b !== undefined && a !== b && !outgoing[a].has(b)) {
      outgoing[a].add(b);
      indegree[b]++;
    }
  }
  const queue = indegree.flatMap((n, i) => (n === 0 ? [i] : []));
  for (let i = 0; i < queue.length; i++)
    for (const target of outgoing[queue[i]]) {
      rank[target] = Math.max(rank[target], rank[queue[i]] + 1);
      if (--indegree[target] === 0) queue.push(target);
    }
  const layers = new Map<number, string[]>();
  ids.forEach((id) => {
    const r = rank[groupOf.get(id)!];
    layers.set(r, [...(layers.get(r) || []), id]);
  });
  const positions = new Map<string, { x: number; y: number }>();
  let column = 0,
    rows = 0;
  for (const [, members] of [...layers].sort(([a], [b]) => a - b)) {
    members.forEach((id, i) =>
      positions.set(id, {
        x: (column + Math.floor(i / maxRows)) * (width + gapX),
        y: (i % maxRows) * (height + gapY),
      }),
    );
    column += Math.ceil(members.length / maxRows);
    rows = Math.max(rows, Math.min(maxRows, members.length));
  }
  return {
    positions,
    width: Math.max(width, column * (width + gapX) - gapX),
    height: Math.max(height, rows * (height + gapY) - gapY),
  };
}
