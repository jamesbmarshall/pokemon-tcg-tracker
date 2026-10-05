import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Gain, PaidInput, parseAmount } from './Paid';
import { renderWithProviders } from '../test/render';
import { resetStores } from '../test/ui-helpers';
import { useSettings } from '../store/settingsStore';
import type { Paid } from '../api/types';

beforeEach(() => resetStores());

describe('parseAmount', () => {
  it.each([
    ['4.5', 4.5],
    ['£4.50', 4.5],
    [' 4,50 ', 4.5],
    ['1,234.5', 1234.5],
    ['3.333', 3.33],
    ['', ''],
    ['  ', ''],
    ['abc', null],
    ['-2', null],
  ])('%j → %j', (raw, out) => expect(parseAmount(raw)).toBe(out));
});

describe('PaidInput', () => {
  const setup = (value?: Paid) => {
    const onCommit = vi.fn();
    const r = renderWithProviders(<PaidInput value={value} onCommit={onCommit} label="Paid each" />);
    return { onCommit, box: screen.getByRole('textbox', { name: 'Paid each' }), ...r };
  };

  it('commits a new amount in the display currency on Enter', async () => {
    const { onCommit, box } = setup();
    expect(screen.getByText('£')).toBeInTheDocument();
    await userEvent.type(box, '4.5{Enter}');
    expect(onCommit).toHaveBeenCalledWith({ amount: 4.5, currency: 'GBP' });
  });

  it('keeps the original currency when editing, clears when emptied, and ignores no-ops', async () => {
    useSettings.setState({ currency: 'EUR' });
    const { onCommit, box } = setup({ amount: 10, currency: 'USD' });
    expect(box).toHaveValue('10.00');
    expect(screen.getByText('$')).toBeInTheDocument();
    fireEvent.blur(box);
    expect(onCommit).not.toHaveBeenCalled();
    await userEvent.clear(box);
    await userEvent.type(box, '12{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith({ amount: 12, currency: 'USD' });
    await userEvent.clear(box);
    fireEvent.blur(box);
    expect(onCommit).toHaveBeenLastCalledWith(undefined);
  });

  it('reverts invalid input and Escape without committing', async () => {
    const { onCommit, box } = setup({ amount: 3, currency: 'GBP' });
    await userEvent.clear(box);
    await userEvent.type(box, 'lots{Enter}');
    expect(box).toHaveValue('3.00');
    await userEvent.type(box, '9{Escape}');
    expect(box).toHaveValue('3.00');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('follows the saved value when it changes', async () => {
    function Host() {
      const [v, setV] = useState<Paid | undefined>({ amount: 3, currency: 'GBP' });
      return (
        <>
          <PaidInput value={v} onCommit={() => {}} label="Paid each" />
          <button onClick={() => setV({ amount: 7, currency: 'GBP' })}>bump</button>
        </>
      );
    }
    renderWithProviders(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'bump' }));
    expect(screen.getByRole('textbox', { name: 'Paid each' })).toHaveValue('7.00');
  });
});

describe('Gain', () => {
  // Test FX: GBP = 0.5 × USD
  it('shows a gain with percentage', () => {
    renderWithProviders(<Gain valueUsd={30} costUsd={20} />);
    expect(screen.getByText(/\+£5\.00/)).toHaveClass('text-gain');
    expect(screen.getByText('(+50%)')).toBeInTheDocument();
  });

  it('shows a loss', () => {
    renderWithProviders(<Gain valueUsd={10} costUsd={20} />);
    expect(screen.getByText(/−£5\.00/)).toHaveClass('text-loss');
    expect(screen.getByText('(−50%)')).toBeInTheDocument();
  });

  it('shows break-even and omits the percentage when nothing was paid', () => {
    const { unmount } = renderWithProviders(<Gain valueUsd={5} costUsd={5} />);
    expect(screen.getByText('±£0.00')).toHaveClass('text-muted');
    unmount();
    renderWithProviders(<Gain valueUsd={4} costUsd={0} />);
    expect(screen.getByText('+£2.00')).toBeInTheDocument();
  });
});
