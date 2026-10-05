import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ValueChart from './ValueChart';
import type { ValuePoint } from '../api/types';

const fmt = (n: number) => `$${n.toFixed(2)}`;
const pt = (date: string, valueUsd: number): ValuePoint => ({ date, valueUsd, cards: 1, unique: 1 });

describe('ValueChart', () => {
  it('shows an explanatory message with fewer than two points', () => {
    const { container } = render(<ValueChart points={[pt('2025-01-01', 10)]} format={fmt} height={120} />);
    expect(screen.getByText(/Come back tomorrow to see the trend line/)).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.firstChild).toHaveStyle({ height: '120px' });
  });

  it('shows the message for no points at all', () => {
    render(<ValueChart points={[]} format={fmt} />);
    expect(screen.getByText(/value history builds up/)).toBeInTheDocument();
  });

  it('plots points sorted by date and labels the range and latest value', () => {
    const { container } = render(<ValueChart points={[pt('2025-01-03', 30), pt('2025-01-01', 10), pt('2025-01-02', 20)]} format={fmt} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('1 Jan 2025')).toBeInTheDocument();
    expect(screen.getByText('3 Jan 2025')).toBeInTheDocument();
    expect(screen.getByText(/3 Jan 2025 ·/)).toBeInTheDocument();
    expect(screen.getByText('$30.00')).toBeInTheDocument();
    const line = container.querySelectorAll('path')[1];
    expect(line.getAttribute('d')).toMatch(/^M0\.0,/);
    expect(line).toHaveAttribute('stroke', 'var(--color-gain)');
  });

  it('uses the loss colour when value fell', () => {
    const { container } = render(<ValueChart points={[pt('2025-01-01', 50), pt('2025-01-02', 20)]} format={fmt} />);
    expect(container.querySelectorAll('path')[1]).toHaveAttribute('stroke', 'var(--color-loss)');
  });

  it('only plots the last 90 days', () => {
    const points = Array.from({ length: 100 }, (_, i) => pt(`2025-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, i));
    const { container } = render(<ValueChart points={points} format={fmt} />);
    const d = container.querySelectorAll('path')[1].getAttribute('d')!;
    expect(d.split(/[ML]/).filter(Boolean)).toHaveLength(90);
    expect(screen.getByText(formatLike('2025-01-11'))).toBeInTheDocument();
  });

  it('follows the pointer to show the hovered value, and resets on leave', () => {
    const { container } = render(<ValueChart points={[pt('2025-01-01', 10), pt('2025-01-02', 20), pt('2025-01-03', 30)]} format={fmt} />);
    const svg = container.querySelector('svg')!;
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 600, height: 160, right: 600, bottom: 160, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerMove(svg, { clientX: 0, clientY: 10 });
    expect(screen.getByText('$10.00')).toBeInTheDocument();
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 10 });
    expect(screen.getByText('$20.00')).toBeInTheDocument();
    fireEvent.pointerLeave(svg);
    expect(screen.getByText('$30.00')).toBeInTheDocument();
  });

  it('handles a flat line without dividing by zero', () => {
    const { container } = render(<ValueChart points={[pt('2025-01-01', 0), pt('2025-01-02', 0)]} format={fmt} />);
    expect(container.querySelectorAll('path')[1].getAttribute('d')).not.toMatch(/NaN|Infinity/);
  });

  describe('gain metric', () => {
    const cpt = (date: string, valueUsd: number, costUsd?: number, costedValueUsd?: number): ValuePoint => ({ ...pt(date, valueUsd), costUsd, costedValueUsd });

    it('plots gain only from points with a cost, with a zero line and signed labels', () => {
      render(<ValueChart metric="gain" points={[cpt('2025-01-01', 50), cpt('2025-01-02', 50, 10, 12), cpt('2025-01-03', 50, 10, 7)]} format={fmt} />);
      expect(screen.getByTestId('zero-line')).toBeInTheDocument();
      expect(screen.queryByText('1 Jan 2025')).not.toBeInTheDocument();
      expect(screen.getByText('2 Jan 2025')).toBeInTheDocument();
      expect(screen.getByText('−$3.00')).toBeInTheDocument();
      expect(document.querySelectorAll('path[stroke]')[0]).toHaveAttribute('stroke', 'var(--color-loss)');
    });

    it('is green when ahead, even if the gain shrank', () => {
      render(<ValueChart metric="gain" points={[cpt('2025-01-01', 1, 10, 20), cpt('2025-01-02', 1, 10, 15)]} format={fmt} />);
      expect(screen.getByText('+$5.00')).toBeInTheDocument();
      expect(document.querySelectorAll('path[stroke]')[0]).toHaveAttribute('stroke', 'var(--color-gain)');
    });

    it('explains when there is not enough cost history yet', () => {
      render(<ValueChart metric="gain" points={[pt('2025-01-01', 1), pt('2025-01-02', 2), cpt('2025-01-03', 3, 1, 2)]} format={fmt} />);
      expect(screen.getByText(/tracked daily from the first day you record what you paid/)).toBeInTheDocument();
      expect(screen.queryByTestId('zero-line')).not.toBeInTheDocument();
    });
  });

});

function formatLike(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
