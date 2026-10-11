import { useLayoutEffect, useState } from 'react';

/** Fits artwork into the first mobile viewport; details remain available below it. */
export function useCardArtworkSize() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const viewport = window.visualViewport;
    const nav = document.querySelector<HTMLElement>('[data-mobile-nav]');
    const hints = Array.from(el.querySelectorAll<HTMLElement>('[data-artwork-hint]'));
    const measure = () => {
      // Use document position so scrolling down to the details doesn't enlarge the card.
      const top = el.getBoundingClientRect().top + window.scrollY;
      const currentHints = Array.from(el.querySelectorAll<HTMLElement>('[data-artwork-hint]'));
      const hintHeight = currentHints.reduce((height, hint) => height + (hint.offsetHeight ? hint.offsetHeight + parseFloat(getComputedStyle(hint).marginTop || '0') : 0), 0);
      const height = Math.max(0, (viewport?.height ?? window.innerHeight) - top - (nav?.offsetHeight ?? 0) - hintHeight - 16);
      el.style.setProperty('--card-artwork-width', `${height * 63 / 88}px`);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined;
    // Font loading, text wrapping and safe-area changes can change the available space.
    [el, el.parentElement?.previousElementSibling, nav, ...hints].forEach((target) => {
      if (target) observer?.observe(target);
    });
    window.addEventListener('resize', measure);
    viewport?.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      viewport?.removeEventListener('resize', measure);
    };
  }, [el]);
  return setEl;
}
