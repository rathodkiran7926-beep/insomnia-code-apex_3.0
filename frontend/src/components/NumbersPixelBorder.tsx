const silhouettes = {
  top: [2, 4, 3, 5, 2, 4, 6, 5, 3, 4, 6, 5, 2, 3, 2, 3, 4, 4, 2, 3, 2, 5, 6, 3,
    6, 5, 3, 2, 4, 2, 5, 4, 2, 3, 6, 5, 3, 5, 4, 5, 2, 1, 4, 5, 6, 5, 5, 3],
  bottom: [3, 5, 2, 4, 5, 1, 3, 5, 4, 2, 1, 6, 3, 4, 5, 6, 5, 2, 3, 5, 6, 4, 2, 3,
    5, 4, 2, 6, 3, 4, 5, 2, 4, 6, 6, 6, 6, 5, 4, 2, 5, 3, 1, 4, 2, 5, 6, 3],
};
const cutouts = new Set(['2:4', '7:3', '11:4', '13:4', '17:5', '21:3', '24:4', '26:5',
  '29:4', '33:4', '35:3', '38:5', '41:5', '44:3']);

/** Solid pixel silhouettes connect the section background to the page canvas. */
export function NumbersPixelBorder({ edge }: { edge: 'top' | 'bottom' }) {
  return (
    <svg
      className={`numbers-pixel-border numbers-pixel-border--${edge}`}
      viewBox="0 0 48 6"
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {silhouettes[edge].flatMap((height, x) =>
        Array.from({ length: height }, (_, index) => {
          const y = 6 - height + index;
          if (cutouts.has(`${x}:${y}`)) return null;
          return <rect key={`${x}:${y}`} x={x} y={y} width="1.01" height="1.01" fill="currentColor" />;
        }),
      )}
    </svg>
  );
}
