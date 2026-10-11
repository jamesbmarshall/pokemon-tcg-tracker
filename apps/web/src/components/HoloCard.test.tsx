import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import HoloCard from './HoloCard';
import { resetStores } from '../test/ui-helpers';

beforeEach(async () => {
  await resetStores();
});

const renderCard = (foil?: boolean) => {
  render(<HoloCard id="zzz-1" src="https://img/high.webp" name="Mew" number="151" setName="151" types={['Psychic']} foil={foil} />);
  const img = screen.getByRole('img', { name: 'Mew' });
  const tilt = img.parentElement!;
  vi.spyOn(tilt, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 200, right: 100, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  return { img, tilt };
};

describe('HoloCard', () => {
  it('loads the hi-res image eagerly and fades it in once loaded', () => {
    const { img, tilt } = renderCard();
    expect(img).toHaveAttribute('src', 'https://img/high.webp');
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveClass('opacity-0');
    expect(tilt.querySelector('.animate-pulse')).not.toBeNull();
    fireEvent.load(img);
    expect(img).toHaveClass('opacity-100');
    expect(tilt.querySelector('.animate-pulse')).toBeNull();
  });

  it('treats the placeholder as loaded when there is no image', () => {
    render(<HoloCard id="zzz-1" src="" name="Mew" />);
    expect(screen.getByRole('img', { name: 'Mew' })).toHaveTextContent('No scan yet');
    expect(document.querySelector('.animate-pulse')).toBeNull();
  });

  it('tilts towards the pointer and resets on leave', async () => {
    const { tilt } = renderCard();
    fireEvent.pointerMove(tilt, { clientX: 100, clientY: 0 });
    await waitFor(() => expect(tilt.style.getPropertyValue('--ry')).toBe('11deg'));
    expect(tilt.style.getPropertyValue('--rx')).toBe('9deg');
    expect(tilt.style.getPropertyValue('--mx')).toBe('100%');
    expect(tilt.style.getPropertyValue('--foil-o')).toBe('1');
    fireEvent.pointerLeave(tilt);
    expect(tilt.style.getPropertyValue('--rx')).toBe('0deg');
    expect(tilt.style.getPropertyValue('--ry')).toBe('0deg');
    expect(tilt.style.getPropertyValue('--foil-o')).toBe('0');
  });

  it('does no tilt or foil work for touch swipes', () => {
    const { tilt } = renderCard();
    const request = vi.spyOn(window, 'requestAnimationFrame');
    const event = new Event('pointermove', { bubbles: true });
    Object.assign(event, { pointerType: 'touch', clientX: 100, clientY: 0 });
    fireEvent(tilt, event);
    expect(tilt.getBoundingClientRect).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('cancels pending frames each time a card unmounts', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frame) => { frames.delete(frame); });
    for (let i = 0; i < 100; i++) {
      const { container, unmount } = render(<HoloCard id={`test-${i}`} src="https://img/high.webp" name="Test" />);
      fireEvent.pointerMove(container.querySelector('img')!.parentElement!, { clientX: 10, clientY: 20 });
      expect(frames.size).toBe(1);
      unmount();
      expect(frames.size).toBe(0);
    }
    act(() => { frames.forEach((callback) => callback(0)); });
  });

  it('uses a softer sheen for non-foil cards', async () => {
    const { tilt } = renderCard(false);
    fireEvent.pointerMove(tilt, { clientX: 50, clientY: 100 });
    await waitFor(() => expect(tilt.style.getPropertyValue('--foil-o')).toBe('0.5'));
    expect(tilt.style.getPropertyValue('--rx')).toBe('0deg');
  });
});
