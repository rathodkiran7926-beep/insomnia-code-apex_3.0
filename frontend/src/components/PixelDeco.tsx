const leftPixels = [
  [65, 0], [0, 65], [0, 130], [65, 195], [0, 260], [65, 260],
  [130, 260], [0, 325], [195, 325], [0, 390], [65, 390],
  [0, 455], [65, 455], [130, 455],
];
const rightPixels = [
  [195, 0], [65, 65], [130, 130], [65, 195], [130, 195], [195, 195],
  [130, 260], [195, 260], [65, 325], [195, 325], [0, 455],
  [130, 455], [65, 520], [130, 520], [195, 520],
];

/** Flat, edge-aligned pixel silhouettes framing the home hero. */
export function PixelDeco() {
  return (
    <div className="sym-pixel-hero-wrap" aria-hidden="true">
      {[
        { side: 'left', height: 520, pixels: leftPixels },
        { side: 'right', height: 585, pixels: rightPixels },
      ].map(({ side, height, pixels }) => (
        <svg
          key={side}
          className={`hero-pixel-pattern hero-pixel-pattern--${side}`}
          width="260"
          height={height}
          viewBox={`0 0 260 ${height}`}
          fill="currentColor"
          shapeRendering="crispEdges"
          focusable="false"
        >
          {pixels.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="66" height="66" />)}
        </svg>
      ))}
    </div>
  );
}
