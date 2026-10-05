import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CardImage from './CardImage';
import { resetStores, seedCollection } from '../test/ui-helpers';
import { makeEntry, makeSnapshot } from '../test/fixtures';
import { db } from '../db/dexie';

beforeEach(async () => {
  await resetStores();
});

describe('CardImage', () => {
  it('renders the primary source', () => {
    render(<CardImage id="zzz-1" src="https://img/a.webp" name="Pikachu" alt="Pikachu" />);
    const img = screen.getByRole('img', { name: 'Pikachu' });
    expect(img).toHaveAttribute('src', 'https://img/a.webp');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('falls back to the legacy CDN, then to a placeholder', () => {
    render(<CardImage id="sv03-007" src="https://img/a.webp" name="Charmander" alt="Charmander" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://images.pokemontcg.io/sv3/7.png');
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img', { name: 'Charmander' }).tagName).toBe('DIV');
    expect(screen.getByText('No scan yet')).toBeInTheDocument();
  });

  it('asks the legacy CDN for the hi-res image when hires', () => {
    render(<CardImage id="sv03-007" src="https://img/a.webp" name="Charmander" hires loading="eager" />);
    const img = document.querySelector('img')!;
    expect(img).toHaveAttribute('loading', 'eager');
    fireEvent.error(img);
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://images.pokemontcg.io/sv3/7_hires.png');
  });

  it('shows a printed-style placeholder with name, set and number when there is no source', () => {
    const onLoad = vi.fn();
    render(<CardImage id="zzz-1" src="" name="Missingno" number="0" setName="Glitch Set" types={['Psychic']} onLoad={onLoad} />);
    const ph = screen.getByRole('img', { name: 'Missingno' });
    expect(ph).toHaveTextContent('Missingno');
    expect(ph).toHaveTextContent('Glitch Set');
    expect(ph).toHaveTextContent('#0');
    expect(ph).toHaveTextContent('No scan yet');
    expect(onLoad).toHaveBeenCalled();
  });

  it('prefers alt over name for the placeholder label', () => {
    render(<CardImage id="zzz-1" src="" name="Name" alt="Alt text" />);
    expect(screen.getByRole('img', { name: 'Alt text' })).toBeInTheDocument();
  });

  it('forwards onLoad from the image', () => {
    const onLoad = vi.fn();
    render(<CardImage id="zzz-1" src="https://img/a.webp" name="P" onLoad={onLoad} />);
    fireEvent.load(document.querySelector('img')!);
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it('resets the fallback chain when the sources change', () => {
    const { rerender } = render(<CardImage id="zzz-1" src="https://img/a.webp" name="P" />);
    fireEvent.error(document.querySelector('img')!);
    expect(screen.getByText('No scan yet')).toBeInTheDocument();
    rerender(<CardImage id="zzz-1" src="https://img/b.webp" name="P" />);
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://img/b.webp');
  });

  it('uses the locally cached copy first for owned cards', async () => {
    seedCollection({ entries: [makeEntry({ cardId: 'zzz-9' })], cards: [makeSnapshot({ id: 'zzz-9' })] });
    await db.images.put({ id: 'zzz-9', blob: new Blob(['x'], { type: 'image/png' }), savedAt: '2025-01-01' });
    const spy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cached-zzz-9');
    render(<CardImage id="zzz-9" src="https://img/a.webp" name="P" />);
    await vi.waitFor(() => expect(document.querySelector('img')).toHaveAttribute('src', 'blob:cached-zzz-9'));
    expect(spy).toHaveBeenCalled();
    fireEvent.error(document.querySelector('img')!);
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://img/a.webp');
  });
});
