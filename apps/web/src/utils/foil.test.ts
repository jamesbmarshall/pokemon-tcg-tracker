import { describe, expect, it } from 'vitest';
import type React from 'react';
import { foilLeave, foilMove } from './foil';

function evt(pointerType: string, clientX: number, clientY: number) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 100, top: 200, width: 200, height: 400, right: 300, bottom: 600, x: 100, y: 200, toJSON: () => ({}) });
  return { el, e: { pointerType, clientX, clientY, currentTarget: el } as unknown as React.PointerEvent<HTMLElement> };
}

describe('foil', () => {
  it('sets pointer position variables for mouse input', () => {
    const { el, e } = evt('mouse', 150, 500);
    foilMove(e);
    expect(el.style.getPropertyValue('--mx')).toBe('25%');
    expect(el.style.getPropertyValue('--my')).toBe('75%');
    expect(el.style.getPropertyValue('--bx')).toBe('40%');
    expect(el.style.getPropertyValue('--by')).toBe('60%');
    expect(el.style.getPropertyValue('--foil-o')).toBe('1');
  });
  it('ignores touch so scrolling is not hijacked', () => {
    const { el, e } = evt('touch', 150, 500);
    foilMove(e);
    expect(el.style.getPropertyValue('--mx')).toBe('');
  });
  it('fades the foil out on leave', () => {
    const { el, e } = evt('mouse', 0, 0);
    foilMove(e);
    foilLeave(e);
    expect(el.style.getPropertyValue('--foil-o')).toBe('0');
  });
});
