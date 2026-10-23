import { useEffect, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';
export function WorkspaceOptions({
  automatic,
  onAuto,
  onReset,
}: {
  automatic: boolean;
  onAuto: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div
      ref={root}
      className="workspace-options"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        aria-label="More workspace options"
        title="More workspace options"
        aria-expanded={open}
        aria-controls="workspace-options-panel"
        onClick={() => setOpen(!open)}
      >
        <Ellipsis size={17} />
      </button>
      {open && (
        <div
          id="workspace-options-panel"
          className="workspace-options-panel"
          role="group"
          aria-label="Workspace options"
        >
          <button
            aria-pressed={automatic}
            onClick={() => {
              onAuto();
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            Auto layout {automatic ? '(on)' : '(off)'}
          </button>
          <button
            onClick={() => {
              onReset();
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            Reset pane sizes
          </button>
          <p>
            Drag pane dividers or use arrow keys when a divider is focused. Enter collapses its
            pane.
          </p>
        </div>
      )}
    </div>
  );
}
