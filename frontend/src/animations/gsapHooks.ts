import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// Register plugins once
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

/**
 * Check if the user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * GSAP hook for hero entrance animations with staggered reveals
 */
export function useHeroAnimation<T extends HTMLElement = HTMLDivElement>() {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!containerRef.current || prefersReducedMotion()) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      const eyebrow = containerRef.current?.querySelector('.hero-eyebrow, .eyebrow');
      const title = containerRef.current?.querySelector('.hero-title, h1');
      const desc = containerRef.current?.querySelector('.hero-desc, p');
      const actions = containerRef.current?.querySelector('.hero-actions, .heading-actions');
      const pattern = containerRef.current?.querySelector('.blueprint-pattern, .hero-pattern');

      if (pattern) {
        tl.fromTo(
          pattern,
          { opacity: 0, scale: 0.95 },
          { opacity: 0.85, scale: 1, duration: 1.2, ease: 'power2.out' },
          0,
        );
      }

      if (eyebrow) {
        tl.fromTo(
          eyebrow,
          { opacity: 0, y: 15 },
          { opacity: 1, y: 0, duration: 0.6 },
          0.1,
        );
      }

      if (title) {
        tl.fromTo(
          title,
          { opacity: 0, y: 25 },
          { opacity: 1, y: 0, duration: 0.8 },
          0.2,
        );
      }

      if (desc) {
        tl.fromTo(
          desc,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.7 },
          0.35,
        );
      }

      if (actions) {
        tl.fromTo(
          actions,
          { opacity: 0, y: 15, scale: 0.98 },
          { opacity: 1, y: 0, scale: 1, duration: 0.6 },
          0.45,
        );
      }
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return containerRef;
}

/**
 * GSAP hook for scroll-triggered section entrance animations
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(options?: {
  stagger?: number;
  selector?: string;
  delay?: number;
}) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!ref.current || prefersReducedMotion()) return;

    const ctx = gsap.context(() => {
      const targets = options?.selector
        ? ref.current?.querySelectorAll(options.selector)
        : ref.current?.children;

      if (!targets || targets.length === 0) return;

      gsap.fromTo(
        targets,
        {
          opacity: 0,
          y: 28,
        },
        {
          opacity: 1,
          y: 0,
          duration: 0.75,
          stagger: options?.stagger ?? 0.1,
          delay: options?.delay ?? 0,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: ref.current,
            start: 'top 88%',
            toggleActions: 'play none none none',
          },
        },
      );
    }, ref);

    return () => ctx.revert();
  }, [options?.selector, options?.stagger, options?.delay]);

  return ref;
}

/**
 * GSAP hook for card references (3D mouse tilt disabled per user request)
 */
export function useCardTilt<T extends HTMLElement = HTMLDivElement>(_maxTilt = 8) {
  const cardRef = useRef<T>(null);
  return cardRef;
}

/**
 * Magnetic button hover effect (disabled per user request - no cursor movement)
 */
export function useMagnetic<T extends HTMLElement = HTMLButtonElement>(_strength = 0.25) {
  const ref = useRef<T>(null);
  return ref;
}
