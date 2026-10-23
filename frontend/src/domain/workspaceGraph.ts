export function workspaceGraphPositions(selected: string, incoming: string[], outgoing: string[]) {
  const positions = new Map<string, { x: number; y: number }>();
  const right = [...new Set(outgoing)].filter((id) => id !== selected);
  const left = [...new Set(incoming)].filter((id) => id !== selected && !right.includes(id));
  positions.set(selected, { x: 310, y: 0 });
  for (const [items, x] of [
    [left, 0],
    [right, 620],
  ] as const) {
    items.forEach((id, i) => positions.set(id, { x, y: (i - (items.length - 1) / 2) * 140 }));
  }
  return positions;
}
