import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useSwipe } from './useSwipe';

function Harness({ onSwipeLeft, onSwipeRight }: { onSwipeLeft: () => void; onSwipeRight: () => void }) {
  const ref = useSwipe<HTMLDivElement>({ onSwipeLeft, onSwipeRight });
  return (
    <div ref={ref} data-testid="root">
      <p data-testid="text">Card</p>
      <input data-testid="field" />
      <div data-testid="scroller" style={{ overflowX: 'auto' }}>
        <span data-testid="inside">row</span>
      </div>
    </div>
  );
}

function swipe(el: Element, from: [number, number], to: [number, number], fingers = 1) {
  const touches = Array.from({ length: fingers }, () => ({ clientX: from[0], clientY: from[1] }));
  fireEvent.touchStart(el, { touches });
  fireEvent.touchMove(el, { touches });
  fireEvent.touchEnd(el, { touches: [], changedTouches: [{ clientX: to[0], clientY: to[1] }] });
}

function setup() {
  const left = vi.fn();
  const right = vi.fn();
  const utils = render(<Harness onSwipeLeft={left} onSwipeRight={right} />);
  return { left, right, ...utils };
}

afterEach(() => vi.useRealTimers());

describe('useSwipe', () => {
  it('fires left and right for clear horizontal swipes', () => {
    const { left, right, getByTestId } = setup();
    swipe(getByTestId('text'), [300, 200], [150, 210]);
    expect(left).toHaveBeenCalledTimes(1);
    swipe(getByTestId('text'), [150, 200], [300, 190]);
    expect(right).toHaveBeenCalledTimes(1);
  });

  it('ignores short, mostly vertical and slow drags', () => {
    const { left, right, getByTestId } = setup();
    swipe(getByTestId('text'), [300, 200], [260, 200]);
    swipe(getByTestId('text'), [300, 200], [200, 400]);
    vi.useFakeTimers();
    fireEvent.touchStart(getByTestId('text'), { touches: [{ clientX: 300, clientY: 200 }] });
    vi.advanceTimersByTime(1000);
    fireEvent.touchEnd(getByTestId('text'), { touches: [], changedTouches: [{ clientX: 100, clientY: 200 }] });
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  it('ignores multi-touch, form fields, sideways scrollers and screen edges', () => {
    const { left, right, getByTestId } = setup();
    swipe(getByTestId('text'), [300, 200], [100, 200], 2);
    swipe(getByTestId('field'), [300, 200], [100, 200]);
    const scroller = getByTestId('scroller');
    Object.defineProperty(scroller, 'scrollWidth', { value: 800 });
    Object.defineProperty(scroller, 'clientWidth', { value: 300 });
    swipe(getByTestId('inside'), [300, 200], [100, 200]);
    swipe(getByTestId('text'), [5, 200], [200, 200]);
    swipe(getByTestId('text'), [window.innerWidth - 5, 200], [window.innerWidth - 200, 200]);
    fireEvent.touchStart(getByTestId('text'), { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchCancel(getByTestId('text'));
    fireEvent.touchEnd(getByTestId('text'), { touches: [], changedTouches: [{ clientX: 100, clientY: 200 }] });
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  it('stops listening once unmounted', () => {
    const { left, getByTestId, unmount } = setup();
    const text = getByTestId('text');
    unmount();
    swipe(text, [300, 200], [100, 200]);
    expect(left).not.toHaveBeenCalled();
  });
});
