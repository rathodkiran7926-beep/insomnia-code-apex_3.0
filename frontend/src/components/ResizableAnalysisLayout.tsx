import { useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { GripVertical, RotateCcw } from 'lucide-react';

const preferenceKey = 'mentor-analysis-panel-size';
const clamp = (value: number) => Math.min(70, Math.max(20, value));

export function ResizableAnalysisLayout({
  children,
  enabled,
}: {
  children: ReactNode[];
  enabled: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const activeDrag = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [share, setShare] = useState(() => {
    try {
      const saved = localStorage.getItem(preferenceKey);
      const value = Number(saved);
      return saved !== null && Number.isFinite(value) ? clamp(value) : 35;
    } catch {
      return 35;
    }
  });
  function resize(value: number) {
    const next = clamp(value);
    setShare(next);
    try {
      localStorage.setItem(preferenceKey, String(next));
    } catch {
      /* Resizing still works without storage. */
    }
  }
  return (
    <div
      ref={container}
      className={`analysis-layout ${enabled ? 'analysis-resizable' : ''} ${dragging ? 'analysis-resizing' : ''}`}
      style={
        {
          '--analysis-map-share': `${share}fr`,
          '--analysis-code-share': `${100 - share}fr`,
        } as CSSProperties
      }
    >
      {enabled && (
        <div className="analysis-resize-hint">
          <span>Drag the divider to resize diagram and code</span>
          <button onClick={() => resize(35)}>
            <RotateCcw size={12} />
            Reset sizes
          </button>
        </div>
      )}
      {children[0]}
      {enabled && (
        <div
          className="analysis-panel-divider"
          role="separator"
          tabIndex={0}
          aria-label="Resize diagram and code panels"
          aria-orientation="vertical"
          aria-valuemin={20}
          aria-valuemax={70}
          aria-valuenow={Math.round(share)}
          aria-valuetext={`Diagram ${Math.round(share)}%, code ${Math.round(100 - share)}%`}
          title="Drag to resize. Arrow keys adjust size. Double-click or Home resets."
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            activeDrag.current = true;
            setDragging(true);
          }}
          onPointerMove={(e) => {
            if (!activeDrag.current || !container.current) return;
            const bounds = container.current.getBoundingClientRect();
            const available = bounds.width - 16;
            const position = Math.min(available - 320, Math.max(240, e.clientX - bounds.left - 8));
            resize((position / available) * 100);
          }}
          onPointerUp={(e) => {
            activeDrag.current = false;
            setDragging(false);
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            activeDrag.current = false;
            setDragging(false);
          }}
          onLostPointerCapture={() => {
            activeDrag.current = false;
            setDragging(false);
          }}
          onDoubleClick={() => resize(35)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              resize(share + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 2));
            } else if (e.key === 'Home') {
              e.preventDefault();
              resize(35);
            }
          }}
        >
          <GripVertical size={15} />
        </div>
      )}
      {children[1]}
    </div>
  );
}
