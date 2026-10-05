import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CardImage from './CardImage';
import { configureForServer, resetServerConfig } from '../api/client';
import { resetStores } from '../test/ui-helpers';

beforeEach(async () => {
  await resetStores();
});

afterEach(() => resetServerConfig());

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

  it('routes CDN images through the server cache when hosted', () => {
    configureForServer();
    render(<CardImage id="sv03-007" src="https://assets.tcgdex.net/en/sv/sv03/007/high.webp" name="Charmander" />);
    expect(document.querySelector('img')).toHaveAttribute('src', `/api/img?u=${encodeURIComponent('https://assets.tcgdex.net/en/sv/sv03/007/high.webp')}`);
    fireEvent.error(document.querySelector('img')!);
    expect(document.querySelector('img')).toHaveAttribute('src', `/api/img?u=${encodeURIComponent('https://images.pokemontcg.io/sv3/7.png')}`);
  });

  it('leaves unknown hosts alone even when hosted', () => {
    configureForServer();
    render(<CardImage id="zzz-1" src="https://img/a.webp" name="P" />);
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://img/a.webp');
  });
});
