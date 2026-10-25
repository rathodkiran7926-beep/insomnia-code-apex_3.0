import { useCallback, useEffect, useRef, useState } from 'react';

/** One delayed, focusable popup shared by all triggers in a source viewer. */
export function useDelayedHover<T>(identity: string) {
  const [active, setActive] = useState<{ value: T; trigger: HTMLElement } | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismiss = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keep = useCallback(() => { clearTimeout(dismiss.current); }, []);
  const close = useCallback(() => {
    clearTimeout(pending.current); clearTimeout(dismiss.current); setActive(null);
  }, []);
  const enter = useCallback((value: T, trigger: HTMLElement) => {
    clearTimeout(pending.current); keep();
    setActive(previous => previous?.trigger === trigger ? previous : null);
    pending.current = setTimeout(() => setActive({ value, trigger }), 500);
  }, [keep]);
  const leave = useCallback(() => {
    clearTimeout(pending.current); clearTimeout(dismiss.current);
    dismiss.current = setTimeout(() => setActive(null), 180);
  }, []);
  useEffect(() => {
    close();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const scrolled = () => close();
    document.addEventListener('keydown', escape);
    document.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', scrolled);
    return () => {
      clearTimeout(pending.current); clearTimeout(dismiss.current);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', scrolled);
    };
  }, [identity, close]);
  return { active, enter, leave, keep, close };
}
