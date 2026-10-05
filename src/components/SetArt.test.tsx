import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SetLogo, SetSymbol } from './SetArt';

describe('SetLogo', () => {
  it('renders the logo image with the set name as alt text', () => {
    render(<SetLogo src="https://x/logo.webp" name="Obsidian Flames" className="logo" />);
    const img = screen.getByRole('img', { name: 'Obsidian Flames' });
    expect(img).toHaveAttribute('src', 'https://x/logo.webp');
    expect(img).toHaveClass('logo');
  });

  it('falls back to the set name when there is no logo', () => {
    render(<SetLogo src="" name="Base Set" fallbackClassName="fallback" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Base Set')).toHaveClass('fallback');
  });

  it('falls back to the set name when the logo fails to load', () => {
    render(<SetLogo src="https://x/broken.webp" name="151" />);
    fireEvent.error(screen.getByRole('img', { name: '151' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('151')).toBeInTheDocument();
  });

  it('tries again when given a new src after an error', () => {
    const { rerender } = render(<SetLogo src="https://x/a.webp" name="Set" />);
    fireEvent.error(screen.getByRole('img'));
    rerender(<SetLogo src="https://x/b.webp" name="Set" />);
    expect(screen.getByRole('img', { name: 'Set' })).toHaveAttribute('src', 'https://x/b.webp');
  });
});

describe('SetSymbol', () => {
  it('renders nothing without a src', () => {
    const { container } = render(<SetSymbol src="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a decorative image', () => {
    const { container } = render(<SetSymbol src="https://x/symbol.png" className="sym" />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'https://x/symbol.png');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveClass('sym');
  });

  it('removes itself when the image errors', () => {
    const { container } = render(<SetSymbol src="https://x/symbol.png" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container).toBeEmptyDOMElement();
  });
});
