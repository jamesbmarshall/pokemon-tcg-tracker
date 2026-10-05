import { useEffect, useRef, useState } from 'react';

interface Options {
  /** Finger moved right-to-left. */
  onSwipeLeft?: () => void;
  /** Finger moved left-to-right. */
  onSwipeRight?: () => void;
  /** Minimum horizontal travel in px. */
  threshold?: number;
}

const MAX_MS = 700;
// Leave the screen edges to the browser's own back/forward swipe.
const EDGE_PX = 24;
const IGNORE = 'input,textarea,select,[contenteditable="true"],[role="dialog"],[data-no-swipe]';

function scrollsSideways(from: Element | null, root: Element): boolean {
  for (let el = from; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}

/**
 * Horizontal touch swipe on an element. Returns a callback ref to attach.
 * Ignores mostly-vertical drags, multi-touch, form fields, dialogs and anything that scrolls sideways itself.
 */
export function useSwipe<T extends HTMLElement>({ onSwipeLeft, onSwipeRight, threshold = 60 }: Options) {
  const [el, setEl] = useState<T | null>(null);
  const handlers = useRef({ onSwipeLeft, onSwipeRight });
  useEffect(() => {
    handlers.current = { onSwipeLeft, onSwipeRight };
  });

  useEffect(() => {
    if (!el) return;
    let start: { x: number; y: number; t: number } | null = null;

    const onStart = (e: TouchEvent) => {
      start = null;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const target = e.target as Element | null;
      if (target?.closest(IGNORE) || scrollsSideways(target, el)) return;
      if (t.clientX < EDGE_PX || t.clientX > window.innerWidth - EDGE_PX) return;
      start = { x: t.clientX, y: t.clientY, t: Date.now() };
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length > 1) start = null;
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const quick = Date.now() - start.t < MAX_MS;
      start = null;
      if (!quick || Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (window.getSelection()?.toString()) return;
      (dx < 0 ? handlers.current.onSwipeLeft : handlers.current.onSwipeRight)?.();
    };
    const onCancel = () => {
      start = null;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, [el, threshold]);

  return setEl;
}
