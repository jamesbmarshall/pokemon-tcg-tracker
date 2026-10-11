import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCardArtworkSize } from './useCardArtworkSize';

function Harness() {
  const ref = useCardArtworkSize();
  return <div ref={ref} data-testid="art"><p data-artwork-hint style={{ marginTop: 16 }}>Swipe</p></div>;
}

it('fits artwork above navigation and hints and tracks viewport resizing', () => {
  let height = 700;
  const viewport = new EventTarget();
  Object.defineProperty(viewport, 'height', { get: () => height });
  vi.stubGlobal('visualViewport', viewport);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 180 } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.matches('[data-mobile-nav]') ? 64 : this.matches('[data-artwork-hint]') ? 16 : 0;
  });
  const nav = document.createElement('nav');
  nav.dataset.mobileNav = '';
  document.body.append(nav);
  const { getByTestId, unmount } = render(<Harness />);
  const width = () => parseFloat(getByTestId('art').style.getPropertyValue('--card-artwork-width'));
  expect(width() * 88 / 63 + 180 + 64 + 32 + 16).toBeCloseTo(700);
  height = 500;
  viewport.dispatchEvent(new Event('resize'));
  expect(width() * 88 / 63 + 180 + 64 + 32 + 16).toBeCloseTo(500);
  const remove = vi.spyOn(viewport, 'removeEventListener');
  unmount();
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  nav.remove();
});

describe('observer lifecycle', () => {
  it('disconnects all observers on unmount', () => {
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
    const { unmount } = render(<Harness />);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
