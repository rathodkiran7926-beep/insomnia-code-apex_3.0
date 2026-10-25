import { useCallback, useEffect, useRef, useState } from 'react';

type HoverTarget<T> = { value: T; trigger: HTMLElement; left: number; top: number; persistent: boolean };
function positioned<T>(value: T, trigger: HTMLElement, persistent = false): HoverTarget<T> {
  const rect = trigger.getBoundingClientRect();
  const height = 48, width = 150, margin = 8;
  return { value, trigger, persistent,
    left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
    top: Math.max(margin, Math.min(rect.bottom + 6 + height <= window.innerHeight - margin ? rect.bottom + 6 : rect.top - height - 6, window.innerHeight - height - margin)),
  };
}
/** One delayed action shared by a viewer's line triggers, including touch/focus. */
export function useDelayedHover<T>(identity: string) {
  const [active, setActive] = useState<HoverTarget<T> | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismiss = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const popover = useRef<HTMLDivElement>(null);
  const currentTrigger = useRef<HTMLElement | null>(null);
  const keep = useCallback(() => { clearTimeout(dismiss.current); clearTimeout(pending.current); }, []);
  const close = useCallback(() => {
    clearTimeout(pending.current); clearTimeout(dismiss.current); setActive(null);
  }, []);
  const show = useCallback((value: T, trigger: HTMLElement, persistent = false) => {
    clearTimeout(pending.current); clearTimeout(dismiss.current);
    currentTrigger.current = trigger;
    if (trigger.isConnected) setActive(positioned(value, trigger, persistent));
  }, []);
  const enter = useCallback((value: T, trigger: HTMLElement) => {
    clearTimeout(pending.current); keep();
    currentTrigger.current = trigger;
    // Keep the existing action reachable while crossing neighboring gutters.
    pending.current = setTimeout(() => show(value, trigger), 500);
  }, [keep, show]);
  const leave = useCallback(() => {
    clearTimeout(pending.current); clearTimeout(dismiss.current);
    dismiss.current = setTimeout(() => setActive(previous => previous &&
      (previous.persistent || popover.current?.contains(document.activeElement)) ? previous : null), 1000);
  }, []);
  useEffect(() => {
    close();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activeRef.current) {
        event.preventDefault(); event.stopPropagation();
        activeRef.current.trigger.focus(); close();
      }
    };
    const reposition = () => setActive(previous => previous && previous.trigger.isConnected ? positioned(previous.value, previous.trigger, previous.persistent) : null);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !currentTrigger.current?.contains(event.target) && !popover.current?.contains(event.target)) close();
    };
    // Run before a containing dialog's document-level Escape listener.
    window.addEventListener('keydown', escape, true);
    document.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      clearTimeout(pending.current); clearTimeout(dismiss.current);
      window.removeEventListener('keydown', escape, true);
      document.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [identity, close]);
  return { active, popover, enter, show, leave, keep, close };
}
