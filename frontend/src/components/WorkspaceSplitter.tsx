import { useRef } from 'react';

/** Pointer and keyboard resizing share the same clamped value. */
export function WorkspaceSplitter({
  label,
  controls,
  value,
  min,
  max,
  onChange,
  onCollapse,
  horizontal = false,
  reverse = false,
}: {
  label: string;
  controls: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onCollapse: () => void;
  horizontal?: boolean;
  reverse?: boolean;
}) {
  const drag = useRef<{ position: number; value: number; span: number } | null>(null);
  const update = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return (
    <div
      className={`workspace-splitter ${horizontal ? 'horizontal' : ''}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls={controls}
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${Math.round(value)}${horizontal ? ' percent' : ' pixels'}`}
      title={`${label}: drag or use arrow keys; Enter to collapse; Home/End to resize`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          position: horizontal ? event.clientY : event.clientX,
          value,
          span: event.currentTarget.parentElement?.clientHeight || 1,
        };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const delta = (horizontal ? event.clientY : event.clientX) - drag.current.position;
        update(
          drag.current.value +
            delta * (reverse ? -1 : 1) * (horizontal ? 100 / drag.current.span : 1),
        );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const negative = horizontal ? 'ArrowUp' : 'ArrowLeft';
        const positive = horizontal ? 'ArrowDown' : 'ArrowRight';
        if (![negative, positive, 'Home', 'End', 'Enter'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Enter') onCollapse();
        else if (event.key === 'Home') update(min);
        else if (event.key === 'End') update(max);
        else
          update(
            value + (event.key === negative ? -1 : 1) * (reverse ? -1 : 1) * (horizontal ? 3 : 20),
          );
      }}
    />
  );
}
