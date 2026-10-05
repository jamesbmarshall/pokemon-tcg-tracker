import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('uses a softer sheen for non-foil cards', async () => {
    const { tilt } = renderCard(false);
    fireEvent.pointerMove(tilt, { clientX: 50, clientY: 100 });
    await waitFor(() => expect(tilt.style.getPropertyValue('--foil-o')).toBe('0.5'));
    expect(tilt.style.getPropertyValue('--rx')).toBe('0deg');
  });
});
