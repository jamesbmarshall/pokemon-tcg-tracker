/**
 * Pointer handlers for the holo foil effect on card art. They only set CSS custom properties;
 * the shine itself is drawn in CSS, so no React state changes on pointer move.
 */
export function foilMove(e: React.PointerEvent<HTMLElement>) {
  // On touch, a moving finger is usually scrolling; tracking it would fight the scroll.
  if (e.pointerType === 'touch') return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * 100;
  const y = ((e.clientY - r.top) / r.height) * 100;
  el.style.setProperty('--mx', `${x}%`);
  el.style.setProperty('--my', `${y}%`);
  // The background layer moves at 40% of the pointer offset, for a parallax feel.
  el.style.setProperty('--bx', `${50 + (x - 50) / 2.5}%`);
  el.style.setProperty('--by', `${50 + (y - 50) / 2.5}%`);
  el.style.setProperty('--foil-o', '1');
}

export function foilLeave(e: React.PointerEvent<HTMLElement>) {
  e.currentTarget.style.setProperty('--foil-o', '0');
}
