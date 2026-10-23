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
    const element = containerRef.current;
    if (!element || prefersReducedMotion()) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      const eyebrow = element.querySelector('.hero-eyebrow, .eyebrow');
      const title = element.querySelector('.hero-title, h1');
      const desc = element.querySelector('.hero-desc, p');
      const actions = element.querySelector('.hero-actions, .heading-actions');
      const pattern = element.querySelector('.blueprint-pattern, .hero-pattern');

      if (pattern) {
        tl.fromTo(
          pattern,
          { opacity: 0, scale: 0.95 },
          { opacity: 0.85, scale: 1, duration: 1.2, ease: 'power2.out' },
          0,
        );
      }

      if (eyebrow) {
        tl.fromTo(eyebrow, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.6 }, 0.1);
      }

      if (title) {
        tl.fromTo(title, { opacity: 0, y: 25 }, { opacity: 1, y: 0, duration: 0.8 }, 0.2);
      }

      if (desc) {
        tl.fromTo(desc, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.7 }, 0.35);
      }

      if (actions) {
        tl.fromTo(
          actions,
          { opacity: 0, y: 15, scale: 0.98 },
          { opacity: 1, y: 0, scale: 1, duration: 0.6 },
          0.45,
        );
      }
    }, element);

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
    const element = ref.current;
    if (!element || prefersReducedMotion()) return;

    const ctx = gsap.context(() => {
      const targets = options?.selector
        ? element.querySelectorAll(options.selector)
        : Array.from(element.children);

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
            trigger: element,
            start: 'top 88%',
            toggleActions: 'play none none none',
          },
        },
      );
    }, element);

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

/** Reveal major content cards once as they enter view, including async/tab content. */
export function usePageCardReveal(pathname: string) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = ref.current;
    // The landing page has its own choreographed hero and section entrances.
    if (!root || pathname === '/') return;

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let cleanup = () => {};
    const setup = () => {
      cleanup();
      if (media.matches) return;

      const seen = new WeakSet<HTMLElement>();
      const animations = new Map<HTMLElement, gsap.core.Tween>();
      const selector =
        '.panel, .tilt-card, .knowledge-banner, .relearning-card, .pr-card, .pr-empty, .pr-summary-live, .mentor-empty';
      const ctx = gsap.context(() => {}, root);
      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries.filter((entry) => entry.isIntersecting);
          visible.forEach((entry, index) => {
            const card = entry.target as HTMLElement;
            observer.unobserve(card);
            ctx.add(() => {
              const tween = gsap.fromTo(
                card,
                { opacity: 0, y: 24 },
                {
                  opacity: 1,
                  y: 0,
                  duration: 0.6,
                  delay: Math.min(index * 0.07, 0.21),
                  ease: 'power3.out',
                  clearProps: 'opacity,transform',
                  onComplete: () => {
                    animations.delete(card);
                  },
                },
              );
              animations.set(card, tween);
            });
          });
        },
        { threshold: 0, rootMargin: '0px 0px -24px 0px' },
      );

      const scan = () => {
        // Discard animations on removed tab content rather than retaining DOM nodes.
        animations.forEach((tween, card) => {
          if (!root.contains(card)) {
            tween.kill();
            animations.delete(card);
          }
        });
        root.querySelectorAll<HTMLElement>(selector).forEach((card) => {
          if (seen.has(card)) return;
          // Nested panels enter with their containing card, avoiding double motion.
          if (card.parentElement?.closest(selector)) return;
          seen.add(card);
          observer.observe(card);
        });
      };
      scan();
      const mutations = new MutationObserver(scan);
      mutations.observe(root, { childList: true, subtree: true });
      cleanup = () => {
        observer.disconnect();
        mutations.disconnect();
        ctx.revert();
        animations.clear();
      };
    };
    setup();
    media.addEventListener('change', setup);
    return () => {
      media.removeEventListener('change', setup);
      cleanup();
    };
  }, [pathname]);

  return ref;
}
