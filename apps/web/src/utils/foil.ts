export function foilMove(e: React.PointerEvent<HTMLElement>) {
  if (e.pointerType === 'touch') return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * 100;
  const y = ((e.clientY - r.top) / r.height) * 100;
  el.style.setProperty('--mx', `${x}%`);
  el.style.setProperty('--my', `${y}%`);
  el.style.setProperty('--bx', `${50 + (x - 50) / 2.5}%`);
  el.style.setProperty('--by', `${50 + (y - 50) / 2.5}%`);
  el.style.setProperty('--foil-o', '1');
}

export function foilLeave(e: React.PointerEvent<HTMLElement>) {
  e.currentTarget.style.setProperty('--foil-o', '0');
}
