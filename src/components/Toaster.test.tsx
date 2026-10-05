import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Toaster from './Toaster';
import { toast, useToasts } from '../store/toastStore';

beforeEach(() => {
  useToasts.setState({ toasts: [] });
});

describe('Toaster', () => {
  it('renders nothing but the live region when empty', () => {
    const { container } = render(<Toaster />);
    expect(container.firstChild).toHaveAttribute('aria-live', 'polite');
    expect(container.firstChild).toBeEmptyDOMElement();
  });

  it('renders toasts from the store', () => {
    useToasts.setState({
      toasts: [
        { id: 1, message: 'Saved', tone: 'success' },
        { id: 2, message: 'Failed', tone: 'error' },
      ],
    });
    render(<Toaster />);
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(2);
  });

  it('runs the action and dismisses the toast', async () => {
    const run = vi.fn();
    useToasts.setState({ toasts: [{ id: 1, message: 'Removed card', action: { label: 'Undo', run } }] });
    render(<Toaster />);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByText('Removed card')).not.toBeInTheDocument();
  });

  it('dismisses a toast', async () => {
    useToasts.setState({ toasts: [{ id: 1, message: 'Hello' }] });
    render(<Toaster />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Hello')).not.toBeInTheDocument();
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it('shows toasts pushed via toast() and auto-dismisses them', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => toast('Quick message'));
    expect(screen.getByText('Quick message')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3200));
    expect(screen.queryByText('Quick message')).not.toBeInTheDocument();
  });

  it('keeps toasts with actions around longer', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => toast('With undo', { action: { label: 'Undo', run: () => {} } }));
    act(() => vi.advanceTimersByTime(3200));
    expect(screen.getByText('With undo')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2800));
    expect(screen.queryByText('With undo')).not.toBeInTheDocument();
  });

  it('shows at most three toasts at once', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      for (const m of ['one', 'two', 'three', 'four']) toast(m);
    });
    expect(screen.queryByText('one')).not.toBeInTheDocument();
    expect(screen.getByText('four')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(3);
  });
});
